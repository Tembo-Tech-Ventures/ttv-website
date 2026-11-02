import type { APIContext } from "astro";
import { drizzle } from "drizzle-orm/d1";
import type { z } from "zod";
import { hasMatchingRequestOrigin } from "@/lib/admin/mutation-security";
import * as schema from "@/lib/db/schema";
import { recordError, recordErrorInBackground } from "@/lib/observability/errors";
import { moderationAttention, mentionAttention, temboAnswerAttention } from "@/lib/attention/channel-producers";
import {
  EditMessage, IdParams, MarkChannelRead, MessageListQuery, ModerationAction, ModerationParams, ModerationQueueQuery, PostMessage,
  ReactToMessage, ReportMessage, RequestModerationReview, ROUTES, ShareablesQuery, Success, TemboAsk, TemboFeedback,
  type Channel, type Message,
} from "@/lib/platform/contracts";
import { isFlagEnabled, requireFlag } from "@/lib/platform/server/flags";
import { platformError, platformJson } from "@/lib/platform/server/http";
import type { PersonalAccessTokenScope } from "@/lib/personal-access-tokens";
import type { PlatformCapabilities } from "@/lib/platform/server/capabilities";
import { requestCapabilities } from "@/lib/platform/server/request-capabilities";
import { readBoundedJson, RequestJsonError } from "@/lib/request-json";
import { acceptAsk } from "@/lib/tembo/ask";
import { answerAsk } from "@/lib/tembo/answer";
import { mentionsTembo } from "@/lib/tembo/mention";
import { gatewayModel, type TemboModel } from "@/lib/tembo/model";
import { askTembo, giveTemboFeedback, type TemboRun } from "@/lib/tembo/routes";
import { findChannelById, listChannelsFor, readMarker } from "./access";
import { CursorExpiredError, CursorInvalidError } from "./cursor";
import { listShareables } from "./embeds";
import { ChannelError, listMessages } from "./messages";
import { decideModeration, reportMessage, requestModerationReview } from "./moderation/actions";
import { ClefCheckError, clefScreen, type ClefOutcome } from "./moderation/clef";
import { listModerationQueue } from "./moderation/queue";
import type { MessageScreen } from "./moderation/screen";
import {
  deleteMessage, editMessage, findMessageTarget, markChannelRead, postMessage, reactToMessage, visibleTo,
  type WriteContext,
} from "./mutations";

/**
 * The channel message APIs (README.md beside this file, "APIs"). Every route is 404 while
 * `channels` is off for the caller, and 404 for a channel or message the caller cannot read,
 * whatever the reason. Signed-in sessions, and personal access tokens with a channels scope
 * (B-2.7): channels:read for the reads, channels:write for the writes, each acting as the token's
 * owner with the owner's capabilities, and only while the owner is an admin. Agent sessions act as their person, under the same rules.
 * Browser writes must come from the same origin; a token's need no Origin, but one it sends must
 * match. The moderation routes (B-2.5) follow the same rules, except that no token reaches them
 * (admin tokens triage through MCP, moderation/mcp.ts): the queue is for admins only, and a
 * message's moderators hide it (moderation/actions.ts). The Tembo routes (B-3.1, src/lib/tembo) also need
 * `tembo_channels`, and a post that mentions @tembo asks Tembo after the response when it is on.
 */

type Env = Pick<Cloudflare.Env, "DB" | "DEPLOYMENT_ENVIRONMENT" | "PLATFORM_FLAGS_OVERRIDE" | "DEPLOYMENT_VERSION">
  & Partial<Pick<Cloudflare.Env, "AI" | "AI_GATEWAY_NAME">>;
type Context = Pick<APIContext, "request" | "locals" | "params">;
export type ChannelOperation = Extract<keyof typeof ROUTES,
  "listChannels" | "listMessages" | "listShareables" | "postMessage" | "editMessage" | "deleteMessage" | "reactToMessage"
  | "markChannelRead" | "reportMessage" | "requestModerationReview" | "moderateMessage" | "listModerationQueue"
  | "askTembo" | "temboFeedback">;
/**
 * Test seams: the moderation hook, the clock, the code of conduct version, and work after the response
 * (`defer` receives it instead of the request's waitUntil; `clefTimeoutMs` shortens Clef's limit;
 * `temboModel` answers in place of the AI Gateway).
 */
export interface ChannelRequestOptions {
  screen?: MessageScreen; now?: () => number; conductVersion?: number;
  defer?: (task: () => Promise<void>) => void; clefTimeoutMs?: number; temboModel?: TemboModel;
}

const READS: ReadonlySet<ChannelOperation> = new Set(["listChannels", "listMessages", "listShareables", "listModerationQueue"]);
/** What a personal access token may do here, and the scope each needs. Moderation decisions are not here. */
const TOKEN_SCOPES: Partial<Record<ChannelOperation, PersonalAccessTokenScope>> = {
  listChannels: "channels:read", listMessages: "channels:read", listShareables: "channels:read",
  postMessage: "channels:write", editMessage: "channels:write", deleteMessage: "channels:write", reactToMessage: "channels:write",
  markChannelRead: "channels:write", reportMessage: "channels:write", requestModerationReview: "channels:write",
  askTembo: "channels:write", temboFeedback: "channels:write",
};
/** Routes that also need `tembo_channels`. */
const TEMBO: ReadonlySet<ChannelOperation> = new Set(["askTembo", "temboFeedback"]);
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
  /** Whether `tembo_channels` is on for the caller (already read with `channels`, so free). */
  temboOn: () => Promise<boolean>;
}

/** The flag, then who is asking, then where from. null when the request may go on. */
async function refusal(operation: ChannelOperation, { locals, request }: Context, env: Env): Promise<Response | null> {
  const flags = { db: env.DB, env, user: locals.user ?? null, isAdmin: locals.isAdmin, locals };
  const denied = await requireFlag(flags, "channels") ?? (TEMBO.has(operation) ? await requireFlag(flags, "tembo_channels") : null);
  if (denied) return denied;
  if (!locals.user) return platformError("forbidden", "Not permitted.", 403);
  const token = locals.personalAccessToken;
  if (token) {
    const scope = TOKEN_SCOPES[operation];
    if (!scope) return platformError("forbidden", "Personal access tokens can't do this.", 403);
    if (!token.scopes.includes(scope)) return platformError("forbidden", `This personal access token does not grant ${scope}.`, 403);
  }
  const originless = Boolean(token) && !request.headers.has("Origin");
  if (!READS.has(operation) && !originless && !hasMatchingRequestOrigin(request)) {
    return platformError("forbidden", "Same-origin request required.", 403);
  }
  return null;
}

/** /api/channels/:id/…: the channel must be one the caller can read. */
async function channelRoute({ operation, request, id, user, db, capabilities, scope, later, temboOn }: Admitted): Promise<Response> {
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
    if (created) {
      later.written(message, channel);
      if (mentionsTembo(message.body) && await temboOn()) later.mentioned(message, channel);
    }
    return platformJson(ROUTES.postMessage.response.parse(message), created ? 201 : 200);
  }
  if (operation === "askTembo") {
    const { messageId } = parse(TemboAsk, await readBody(request, SMALL_BYTES));
    const target = await findMessageTarget(db.$client, messageId);
    if (!target || !visibleTo(target, user.id, channel)) throw notFound("Message");
    const { response, status, run } = await askTembo(scope(channel), target);
    if (run) later.answer(run);
    return platformJson(ROUTES.askTembo.response.parse(response), status);
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
  if (operation === "temboFeedback") {
    const { feedback } = parse(TemboFeedback, await readBody(request, SMALL_BYTES));
    await giveTemboFeedback(scope(channel), target, feedback);
    return platformJson(ROUTES.temboFeedback.response.parse({ ok: true }));
  }
  if (operation === "reactToMessage") {
    const input = parse(ReactToMessage, await readBody(request, SMALL_BYTES));
    return platformJson(ROUTES.reactToMessage.response.parse(await reactToMessage(scope(channel), target, input)));
  }
  return platformJson(ROUTES.deleteMessage.response.parse(await deleteMessage(scope(channel), target)));
}

const CHANNEL_ROUTES: ReadonlySet<ChannelOperation> = new Set(["listMessages", "listShareables", "postMessage", "markChannelRead", "askTembo"]);

/** Work after the response, through the request's waitUntil (or the test seam). */
interface AfterResponse {
  /** A post or edit wrote this text: Clef, then mentions, then the queue notice when it was flagged or hidden. */
  written: (message: Message, channel: Channel) => void;
  /** A moderation change: the author's notice and the admins' queue notice. */
  moderated: (messageId: string) => void;
  /** A new post mentions @tembo: ask, then answer when this run is the one that asked. */
  mentioned: (message: Message, channel: Channel) => void;
  /** Answer an accepted question: Tembo's run, then Clef on the answer and the asker's notice. */
  answer: (run: TemboRun) => void;
}

/**
 * Nothing here fails the request. Clef failing leaves the message as it is and is logged as a warning,
 * without the text (moderation/clef.ts); attention is best effort (src/lib/attention).
 */
function afterResponse(operation: ChannelOperation, context: Context, env: Env, options: ChannelRequestOptions): AfterResponse {
  const run = (task: () => Promise<void>) => options.defer ? options.defer(task) : waitUntil(context.locals.cfContext, task());
  const attention = { db: env.DB, env };
  const screen = async (message: Pick<Message, "id" | "body">, channel: Pick<Channel, "id" | "kind">): Promise<ClefOutcome | null> => {
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
  const answer = async ({ messageId, claim }: TemboRun) => {
    const model = options.temboModel ?? gatewayModel(env);
    const result = await answerAsk({ db: env.DB, model, now: options.now, screen: options.screen }, { messageId, claim });
    if (result.status === "failed") {
      // Never the question, the sources or the model's text: only that it failed.
      await recordError(env.DB, { source: "request", route: ROUTES.askTembo.path, version: env.DEPLOYMENT_VERSION, level: "warning",
        error: new Error("Tembo could not answer a question; it was given back.") });
      return;
    }
    if (result.status !== "answered") return;
    const { answerId, body, channel, flagged } = result;
    const outcome = await screen({ id: answerId, body }, channel);
    await temboAnswerAttention(attention, answerId);
    if (flagged || outcome === "flagged" || outcome === "hidden") await moderationAttention(attention, answerId);
  };
  return {
    mentioned: (message, channel) => run(async () => {
      const userId = message.author.id;
      if (userId === null) return;
      // The same acceptance as the Ask button: idempotent, and counted only if accepted. Out of
      // questions, a mention is not answered; the client learns why by asking (429).
      const asked = await acceptAsk(env.DB, { messageId: message.id, channelId: channel.id, userId, now: options.now?.() ?? Date.now() });
      if (asked.status === "run") await answer({ messageId: message.id, claim: asked.claim });
    }),
    answer: (ask) => run(() => answer(ask)),
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
    // Only the admin token page issues channels tokens, and like admin tokens they die with the role:
    // checked against this request's capabilities, so a demotion takes effect on the very next request.
    if (context.locals.personalAccessToken && !capabilities.isAdmin) {
      return platformError("forbidden", "This personal access token works only while its owner is an admin.", 403);
    }
    if (operation === "listChannels") {
      return platformJson(ROUTES.listChannels.response.parse({ items: await listChannelsFor(db, user, capabilities) }));
    }
    if (operation === "listModerationQueue") {
      const queue = await listModerationQueue(env.DB, { user, capabilities }, readQuery(context.request, ModerationQueueQuery));
      return platformJson(ROUTES.listModerationQueue.response.parse(queue));
    }
    const { screen, conductVersion } = options;
    const now = options.now?.();
    const later = afterResponse(operation, context, env, options);
    if (operation === "moderateMessage") {
      const { messageId } = parse(ModerationParams, { messageId: context.params.messageId });
      const input = parse(ModerationAction, await readBody(context.request, NOTE_BYTES));
      const message = await decideModeration(
        { db: env.DB, env, now, notifyLater: later.moderated }, { user, capabilities }, { ...input, messageId },
      );
      return platformJson(ROUTES.moderateMessage.response.parse(message));
    }
    const id = parse(IdParams, { id: context.params.id }).id;
    const admitted: Admitted = {
      operation, request: context.request, id, user, db, capabilities,
      scope: (channel) => ({ db: env.DB, viewerId: user.id, channel, now, screen, conductVersion }),
      later,
      temboOn: () => isFlagEnabled({ db: env.DB, env, user, isAdmin: context.locals.isAdmin, locals: context.locals }, "tembo_channels"),
    };
    return await (CHANNEL_ROUTES.has(operation) ? channelRoute(admitted) : messageRoute(admitted));
  } catch (error) {
    return failure(error, operation, context, env);
  }
}
