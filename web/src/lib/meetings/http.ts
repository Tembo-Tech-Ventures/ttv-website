import type { APIContext } from "astro";
import { drizzle } from "drizzle-orm/d1";
import type { z } from "zod";
import { hasMatchingRequestOrigin } from "@/lib/admin/mutation-security";
import { ChannelError } from "@/lib/channels/errors";
import * as schema from "@/lib/db/schema";
import { recordErrorInBackground } from "@/lib/observability/errors";
import {
  CreateMeeting, EndMeeting, IdParams, JoinMeeting, LeaveMeeting, RemoveFromMeeting, ROUTES,
} from "@/lib/platform/contracts";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { getFlags } from "@/lib/platform/server/flags";
import { platformError, platformJson } from "@/lib/platform/server/http";
import { readBoundedJson, RequestJsonError } from "@/lib/request-json";
import {
  createMeeting, endMeetingAsHost, getMeeting, joinMeeting, leaveMeeting, removeFromMeeting, type Caller,
} from "./calls";
import type { CallContext } from "./clock";
import { callProviderFor, CallProviderError, type CallProvider } from "./provider";

/**
 * The meeting APIs (README.md beside this file, "The API"). Every refusal is the same 404, with the
 * same body: the `meetings` flag off for the caller (or the purpose's own flag), no session, a personal
 * access token (no token scope covers taking a seat in a call), a write from another origin, a body
 * naming anything the server decides (a role, a seat, a preset, a provider id), and any call, channel
 * or person the caller may not see. Admin rights come from the roles table through capabilitiesFor,
 * never from locals.isAdmin: these routes are outside /admin. Where calls have no provider (production,
 * until slice P4) every route answers 503.
 */

type Env = Pick<Cloudflare.Env, "DB" | "DEPLOYMENT_ENVIRONMENT" | "PLATFORM_FLAGS_OVERRIDE" | "DEPLOYMENT_VERSION">;
type Context = Pick<APIContext, "request" | "locals" | "params">;
export type MeetingOperation = Extract<keyof typeof ROUTES,
  "createMeeting" | "getMeeting" | "joinMeeting" | "leaveMeeting" | "removeFromMeeting" | "endMeeting">;

/** Test seams: the clock, the provider (the shared fake otherwise), and the code of conduct version. */
export interface MeetingRequestOptions {
  now?: () => number;
  provider?: CallProvider | null;
  conductVersion?: number;
}

/** A body is small: a title of up to 120 characters is the most it carries. */
const BODY_BYTES = 4_000;

class Refusal extends Error {
  constructor(readonly response: Response) { super("Refused"); }
}

const NOT_FOUND = () => platformError("not_found", "Not found.", 404);

/** A body that fails its contract is a 400, except one naming a field it must not: that is refused like a forged id. */
function parse<T>(contract: z.ZodType<T>, value: unknown): T {
  const result = contract.safeParse(value);
  if (result.success) return result.data;
  if (result.error.issues.some(({ code }) => code === "unrecognized_keys")) throw new Refusal(NOT_FOUND());
  throw new Refusal(platformError("validation", result.error.issues[0]?.message ?? "Invalid request.", 400));
}

async function readBody(request: Request): Promise<unknown> {
  try { return await readBoundedJson(request, BODY_BYTES); }
  catch (error) {
    if (error instanceof RequestJsonError) throw new Refusal(platformError("validation", error.message, error.status));
    throw error;
  }
}

/** Who is asking, how and from where, then the flag. Null when the request may go on. */
async function admit(operation: MeetingOperation, { locals, request }: Context, env: Env): Promise<Caller | null> {
  const user = locals.user;
  if (!user || locals.personalAccessToken) return null;
  if (operation !== "getMeeting" && !hasMatchingRequestOrigin(request)) return null;
  // No isAdmin from locals: STAFF audiences read the ADMIN role from the database.
  const [flags, capabilities] = await Promise.all([
    getFlags({ db: env.DB, env, user, locals }),
    capabilitiesFor(drizzle(env.DB, { schema }), user),
  ]);
  return flags.meetings ? { userId: user.id, capabilities, flags } : null;
}

async function handle(operation: MeetingOperation, { request, params }: Context, ctx: CallContext, caller: Caller): Promise<Response> {
  const id = () => parse(IdParams, { id: params.id }).id;
  switch (operation) {
    case "createMeeting": {
      const created = await createMeeting(ctx, caller, parse(CreateMeeting, await readBody(request)));
      return platformJson(ROUTES.createMeeting.response.parse(created), 201);
    }
    case "getMeeting":
      return platformJson(ROUTES.getMeeting.response.parse(await getMeeting(ctx, caller, id())));
    case "joinMeeting": {
      const meetingId = id();
      parse(JoinMeeting, await readBody(request));
      return platformJson(ROUTES.joinMeeting.response.parse(await joinMeeting(ctx, caller, meetingId)));
    }
    case "leaveMeeting": {
      const meetingId = id();
      parse(LeaveMeeting, await readBody(request));
      return platformJson(ROUTES.leaveMeeting.response.parse(await leaveMeeting(ctx, caller, meetingId)));
    }
    case "removeFromMeeting": {
      const meetingId = id();
      const { userId } = parse(RemoveFromMeeting, await readBody(request));
      return platformJson(ROUTES.removeFromMeeting.response.parse(await removeFromMeeting(ctx, caller, meetingId, userId)));
    }
    case "endMeeting": {
      const meetingId = id();
      parse(EndMeeting, await readBody(request));
      return platformJson(ROUTES.endMeeting.response.parse(await endMeetingAsHost(ctx, caller, meetingId)));
    }
  }
}

/** Every answer is no-store (platformJson), the join's token above all. */
export async function meetingRequest(
  operation: MeetingOperation, context: Context, env: Env, options: MeetingRequestOptions = {},
): Promise<Response> {
  try {
    const caller = await admit(operation, context, env);
    if (!caller) return NOT_FOUND();
    const provider = options.provider === undefined ? callProviderFor(env) : options.provider;
    if (!provider) return platformError("server", "Calls aren't available here yet.", 503);
    const ctx: CallContext = { db: env.DB, provider, now: options.now?.() ?? Date.now() };
    return await handle(operation, context, ctx, { ...caller, conductVersion: options.conductVersion });
  } catch (error) {
    if (error instanceof Refusal) return error.response;
    if (error instanceof ChannelError) return error.status === 404 ? NOT_FOUND() : platformError(error.code, error.message, error.status);
    if (error instanceof CallProviderError) {
      recordErrorInBackground(context.locals.cfContext, env.DB, {
        source: "request", route: ROUTES[operation].path, error, version: env.DEPLOYMENT_VERSION, level: "warning",
      });
      return platformError("server", "The call service didn't answer. Try again in a moment.", 503);
    }
    recordErrorInBackground(context.locals.cfContext, env.DB, {
      source: "request", route: ROUTES[operation].path, error, version: env.DEPLOYMENT_VERSION,
    });
    return platformError("server", "Could not complete the call request.", 500);
  }
}
