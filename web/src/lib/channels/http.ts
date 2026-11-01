import type { APIContext } from "astro";
import { drizzle } from "drizzle-orm/d1";
import type { z } from "zod";
import { hasMatchingRequestOrigin } from "@/lib/admin/mutation-security";
import * as schema from "@/lib/db/schema";
import { recordErrorInBackground } from "@/lib/observability/errors";
import {
  EditMessage, IdParams, MarkChannelRead, MessageListQuery, PostMessage, ReactToMessage, ROUTES, ShareablesQuery, type Channel,
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
import type { MessageScreen } from "./moderation";
import {
  deleteMessage, editMessage, findMessageTarget, markChannelRead, postMessage, reactToMessage,
  type MessageTarget, type WriteContext,
} from "./mutations";

/**
 * The channel message APIs (README.md beside this file, "APIs"). Every route is 404 while
 * `channels` is off for the caller, and 404 for a channel or message the caller cannot read,
 * whatever the reason. Signed-in browser sessions only: personal access tokens are refused until
 * B-2.7 gives them channel scopes. Agent sessions act as their person, under the same rules.
 * Writes must come from the same origin.
 */

type Env = Pick<Cloudflare.Env, "DB" | "DEPLOYMENT_ENVIRONMENT" | "PLATFORM_FLAGS_OVERRIDE" | "DEPLOYMENT_VERSION">;
type Context = Pick<APIContext, "request" | "locals" | "params">;
export type ChannelOperation = Extract<keyof typeof ROUTES,
  "listChannels" | "listMessages" | "listShareables" | "postMessage" | "editMessage" | "deleteMessage" | "reactToMessage"
  | "markChannelRead">;
/** Test seams: the moderation hook, the clock and the code of conduct version. */
export interface ChannelRequestOptions { screen?: MessageScreen; now?: () => number; conductVersion?: number }

const READS: ReadonlySet<ChannelOperation> = new Set(["listChannels", "listMessages", "listShareables"]);
/** The longest legal message (10,000 characters of up to 4 bytes, JSON-escaped) fits; nothing else needs more. */
const MESSAGE_BYTES = 64_000;
const SMALL_BYTES = 1_024;

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
async function channelRoute({ operation, request, id, user, db, capabilities, scope }: Admitted): Promise<Response> {
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
async function messageRoute({ operation, request, id, user, db, capabilities, scope }: Admitted): Promise<Response> {
  const target = await findMessageTarget(db.$client, id);
  const channel = target && await findChannelById(db, user, target.channelId, capabilities);
  if (!target || !channel || !visibleTo(target, user.id, channel)) throw notFound("Message");
  if (operation === "editMessage") {
    const input = parse(EditMessage, await readBody(request, MESSAGE_BYTES));
    return platformJson(ROUTES.editMessage.response.parse(await editMessage(scope(channel), target, input)));
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
    const { screen, conductVersion } = options;
    const now = options.now?.();
    const admitted: Admitted = {
      operation, request: context.request, id: parse(IdParams, { id: context.params.id }).id, user, db, capabilities,
      scope: (channel) => ({ db: env.DB, viewerId: user.id, channel, now, screen, conductVersion }),
    };
    return await (CHANNEL_ROUTES.has(operation) ? channelRoute(admitted) : messageRoute(admitted));
  } catch (error) {
    return failure(error, operation, context, env);
  }
}
