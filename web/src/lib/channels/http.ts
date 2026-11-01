import type { APIContext } from "astro";
import { drizzle } from "drizzle-orm/d1";
import type { z } from "zod";
import { hasMatchingRequestOrigin } from "@/lib/admin/mutation-security";
import * as schema from "@/lib/db/schema";
import { recordError, recordErrorInBackground } from "@/lib/observability/errors";
import { moderationAttention, mentionAttention } from "@/lib/attention/channel-producers";
import {
  EditMessage, IdParams, MarkChannelRead, MessageListQuery, ModerationAction, ModerationParams, ModerationQueueQuery, PostMessage,
  ReactToMessage, ReportMessage, RequestModerationReview, ROUTES, ShareablesQuery, Success, type Channel, type Message,
} from "@/lib/platform/contracts";
import { requireFlag } from "@/lib/platform/server/flags";
import { platformError, platformJson } from "@/lib/platform/server/http";
import type { PlatformCapabilities } from "@/lib/platform/server/capabilities";
import { requestCapabilities } from "@/lib/platform/server/request-capabilities";
import { readBoundedJson, RequestJsonError } from "@/lib/request-json";
import { findChannelById, listChannelsFor, readMarker } from "./access";
import { CursorExpiredError, CursorInvalidError } from "./cursor";
import { listShareables } from "./embeds";
import { ChannelError, listMessages } from "./messages";
import { moderateMessage, reportMessage, requestModerationReview } from "./moderation/actions";
import { ClefCheckError, clefScreen, type ClefOutcome } from "./moderation/clef";
import { listModerationQueue } from "./moderation/queue";
import type { MessageScreen } from "./moderation/screen";
import {
  deleteMessage, editMessage, findMessageTarget, markChannelRead, postMessage, reactToMessage,
  type MessageTarget, type WriteContext,
} from "./mutations";

/**
 * The channel message APIs (README.md beside this file, "APIs"). Every route is 404 while
 * `channels` is off for the caller, and 404 for a channel or message the caller cannot read,
 * whatever the reason. Signed-in browser sessions only: personal access tokens are refused until
 * B-2.7 gives them channel scopes. Agent sessions act as their person, under the same rules.
 * Writes must come from the same origin. The moderation routes (B-2.5) follow the same rules: the
 * queue is for admins only, and a message's moderators hide it (moderation/actions.ts).
 */

type Env = Pick<Cloudflare.Env, "DB" | "DEPLOYMENT_ENVIRONMENT" | "PLATFORM_FLAGS_OVERRIDE" | "DEPLOYMENT_VERSION">
  & Partial<Pick<Cloudflare.Env, "AI" | "AI_GATEWAY_NAME">>;
type Context = Pick<APIContext, "request" | "locals" | "params">;
export type ChannelOperation = Extract<keyof typeof ROUTES,
  "listChannels" | "listMessages" | "listShareables" | "postMessage" | "editMessage" | "deleteMessage" | "reactToMessage"
  | "markChannelRead" | "reportMessage" | "requestModerationReview" | "moderateMessage" | "listModerationQueue">;
/**
 * Test seams: the moderation hook, the clock, the code of conduct version, and work after the response
 * (`defer` receives it instead of the request's waitUntil; `clefTimeoutMs` shortens Clef's limit).
 */
export interface ChannelRequestOptions {
  screen?: MessageScreen; now?: () => number; conductVersion?: number;
  defer?: (task: () => Promise<void>) => void; clefTimeoutMs?: number;
}

const READS: ReadonlySet<ChannelOperation> = new Set(["listChannels", "listMessages", "listShareables", "listModerationQueue"]);
/** The longest legal message (10,000 characters of up to 4 bytes, JSON-escaped) fits; nothing else needs more. */
const MESSAGE_BYTES = 64_000;
const SMALL_BYTES = 1_024;
/** A report, a moderator's reason or a review note: up to 2,000 characters. */
const NOTE_BYTES = 16_000;

class Refusal extends Error {
  constructor(readonly response: Response) { super("Refused"); }
}
const notFound = (what: "Channel" | "Message") => new ChannelError("not_found", `${what} not found.`, 404);

function parse<T>(contract: z.ZodType<T>, value: unknown): T {
  const result = contract.safeParse(value);
  if (!result.success) throw new Refusal(platformError("validation", result.error.issues[0]?.message ?? "Invalid request.", 400));
  return result.data;
}

async function readBody(request: Request, maxBytes: number): Promise<unknown> {
  try { return await readBoundedJson(request, maxBytes); }
  catch (error) {
    if (error instanceof RequestJsonError) throw new Refusal(platformError("validation", error.message, error.status));
    throw error;
  }
}

function readQuery<T>(request: Request, contract: z.ZodType<T>): T {
  const search = new URL(request.url).searchParams;
  if ([...search.keys()].some((key) => search.getAll(key).length !== 1)) {
    throw new Refusal(platformError("validation", "Duplicate query parameter.", 400));
  }
  return parse(contract, Object.fromEntries(search));
}

function failure(error: unknown, operation: ChannelOperation, context: Context, env: Env): Response {
  if (error instanceof Refusal) return error.response;
  if (error instanceof ChannelError) return platformError(error.code, error.message, error.status, error.retryAfterMs);
  if (error instanceof CursorInvalidError) return platformError("validation", error.message, 400);
  // 410 tells the channel store to start again from a fresh latest page.
  if (error instanceof CursorExpiredError) return platformError("validation", error.message, 410);
  recordErrorInBackground(context.locals.cfContext, env.DB, {
    source: "request", route: ROUTES[operation].path, error, version: env.DEPLOYMENT_VERSION,
  });
  return platformError("server", "Could not complete the channel request.", 500);
}

/** Everything a route needs once the caller is admitted. */
interface Admitted {
  operation: ChannelOperation;
  request: Request;
  id: string;
  user: NonNullable<App.Locals["user"]>;
  db: ReturnType<typeof drizzle<typeof schema>>;
  capabilities: PlatformCapabilities;
  scope: (channel: Channel) => WriteContext;
  later: AfterResponse;
}

/** The flag, then who is asking, then where from. null when the request may go on. */
async function refusal(operation: ChannelOperation, { locals, request }: Context, env: Env): Promise<Response | null> {
  const denied = await requireFlag({ db: env.DB, env, user: locals.user ?? null, isAdmin: locals.isAdmin, locals }, "channels");
  if (denied) return denied;
  if (!locals.user) return platformError("forbidden", "Not permitted.", 403);
  if (locals.personalAccessToken) return platformError("forbidden", "Personal access tokens can't use channels yet.", 403);
  if (!READS.has(operation) && !hasMatchingRequestOrigin(request)) {
    return platformError("forbidden", "Same-origin request required.", 403);
  }
  return null;
}

/** /api/channels/:id/…: the channel must be one the caller can read. */
async function channelRoute({ operation, request, id, user, db, capabilities, scope, later }: Admitted): Promise<Response> {
  const channel = await findChannelById(db, user, id, capabilities);
  if (!channel) throw notFound("Channel");
  if (operation === "listMessages") {
    return platformJson(ROUTES.listMessages.response.parse(await listMessages(scope(channel), readQuery(request, MessageListQuery))));
  }
  if (operation === "listShareables") {
    return platformJson(ROUTES.listShareables.response.parse(await listShareables(scope(channel), readQuery(request, ShareablesQuery))));
  }
  if (operation === "postMessage") {
    const { message, created } = await postMessage(scope(channel), parse(PostMessage, await readBody(request, MESSAGE_BYTES)));
    if (created) later.written(message, channel);
    return platformJson(ROUTES.postMessage.response.parse(message), created ? 201 : 200);
  }
  const { messageId } = parse(MarkChannelRead, await readBody(request, SMALL_BYTES));
  await markChannelRead(scope(channel), messageId);
  return platformJson(ROUTES.markChannelRead.response.parse({ channelId: channel.id, ...await readMarker(db, user.id, channel.id) }));
}

/**
 * /api/messages/:id: the message's channel decides, and a hidden message is missing to anyone who
 * could not see it.
 */
async function messageRoute({ operation, request, id, user, db, capabilities, scope, later }: Admitted): Promise<Response> {
  const target = await findMessageTarget(db.$client, id);
  const channel = target && await findChannelById(db, user, target.channelId, capabilities);
  if (!target || !channel || !visibleTo(target, user.id, channel)) throw notFound("Message");
  if (operation === "editMessage") {
    const input = parse(EditMessage, await readBody(request, MESSAGE_BYTES));
    const message = await editMessage(scope(channel), target, input);
    if (input.body !== target.body) later.written(message, channel);
    return platformJson(ROUTES.editMessage.response.parse(message));
  }
  if (operation === "reportMessage") {
    const { created } = await reportMessage(scope(channel), target, parse(ReportMessage, await readBody(request, NOTE_BYTES)));
    if (created) later.moderated(target.id);
    return platformJson(Success.parse({ ok: true }), created ? 201 : 200);
  }
  if (operation === "requestModerationReview") {
    const input = parse(RequestModerationReview, await readBody(request, NOTE_BYTES));
    const { created } = await requestModerationReview(scope(channel), target, input);
    if (created) later.moderated(target.id);
    return platformJson(Success.parse({ ok: true }), created ? 201 : 200);
  }
  if (operation === "moderateMessage") {
    const input = parse(ModerationAction, await readBody(request, NOTE_BYTES));
    const message = await moderateMessage(scope(channel), target, input, { isAdmin: capabilities.isAdmin });
    later.moderated(target.id);
    return platformJson(ROUTES.moderateMessage.response.parse(message));
  }
  if (operation === "reactToMessage") {
    const input = parse(ReactToMessage, await readBody(request, SMALL_BYTES));
    return platformJson(ROUTES.reactToMessage.response.parse(await reactToMessage(scope(channel), target, input)));
  }
  return platformJson(ROUTES.deleteMessage.response.parse(await deleteMessage(scope(channel), target)));
}

function visibleTo(target: MessageTarget, userId: string, channel: Channel): boolean {
  return target.moderationState !== "HIDDEN" || target.authorId === userId || channel.capabilities.canModerate;
}

const CHANNEL_ROUTES: ReadonlySet<ChannelOperation> = new Set(["listMessages", "listShareables", "postMessage", "markChannelRead"]);

/** Work after the response, through the request's waitUntil (or the test seam). */
interface AfterResponse {
  /** A post or edit wrote this text: Clef, then mentions, then the queue notice when it was flagged or hidden. */
  written: (message: Message, channel: Channel) => void;
  /** A moderation change: the author's notice and the admins' queue notice. */
  moderated: (messageId: string) => void;
}

/**
 * Nothing here fails the request. Clef failing leaves the message as it is and is logged as a warning,
 * without the text (moderation/clef.ts); attention is best effort (src/lib/attention).
 */
function afterResponse(operation: ChannelOperation, context: Context, env: Env, options: ChannelRequestOptions): AfterResponse {
  const run = (task: () => Promise<void>) => options.defer ? options.defer(task) : waitUntil(context.locals.cfContext, task());
  const attention = { db: env.DB, env };
  const screen = async (message: Message, channel: Channel): Promise<ClefOutcome | null> => {
    try {
      return await clefScreen(
        { db: env.DB, ai: env.AI, gatewayName: env.AI_GATEWAY_NAME, timeoutMs: options.clefTimeoutMs, now: options.now },
        { id: message.id, channelId: channel.id, channelKind: channel.kind, body: message.body },
      );
    } catch (error) {
      await recordError(env.DB, {
        source: "request", route: ROUTES[operation].path, version: env.DEPLOYMENT_VERSION,
        level: error instanceof ClefCheckError ? "warning" : "error",
        error: error instanceof ClefCheckError ? error : new Error("Channel message check could not be applied."),
      });
      return null;
    }
  };
  return {
    written: (message, channel) => run(async () => {
      const outcome = await screen(message, channel);
      if (message.body.includes("@")) await mentionAttention(attention, message.id);
      if (message.moderation?.state === "FLAGGED" || outcome === "flagged" || outcome === "hidden") {
        await moderationAttention(attention, message.id);
      }
    }),
    moderated: (messageId) => run(() => moderationAttention(attention, messageId)),
  };
}

/** Keeps the Worker alive for work after the response; outside a Worker (dev, tests) it just runs. */
function waitUntil(context: Pick<ExecutionContext, "waitUntil"> | undefined, promise: Promise<void>) {
  if (context) context.waitUntil(promise);
  else void promise;
}

export async function channelRequest(
  operation: ChannelOperation, context: Context, env: Env, options: ChannelRequestOptions = {},
): Promise<Response> {
  try {
    const refused = await refusal(operation, context, env);
    const user = context.locals.user;
    if (refused || !user) return refused ?? platformError("forbidden", "Not permitted.", 403);
    const db = drizzle(env.DB, { schema });
    const capabilities = await requestCapabilities(db, context.locals);
    if (operation === "listChannels") {
      return platformJson(ROUTES.listChannels.response.parse({ items: await listChannelsFor(db, user, capabilities) }));
    }
    if (operation === "listModerationQueue") {
      if (!capabilities.isAdmin) return platformError("forbidden", "Only admins can see the moderation queue.", 403);
      const query = readQuery(context.request, ModerationQueueQuery);
      const queue = await listModerationQueue(env.DB, user.id, await listChannelsFor(db, user, capabilities), query);
      return platformJson(ROUTES.listModerationQueue.response.parse(queue));
    }
    const { screen, conductVersion } = options;
    const now = options.now?.();
    const id = operation === "moderateMessage"
      ? parse(ModerationParams, { messageId: context.params.messageId }).messageId
      : parse(IdParams, { id: context.params.id }).id;
    const admitted: Admitted = {
      operation, request: context.request, id, user, db, capabilities,
      scope: (channel) => ({ db: env.DB, viewerId: user.id, channel, now, screen, conductVersion }),
      later: afterResponse(operation, context, env, options),
    };
    return await (CHANNEL_ROUTES.has(operation) ? channelRoute(admitted) : messageRoute(admitted));
  } catch (error) {
    return failure(error, operation, context, env);
  }
}
