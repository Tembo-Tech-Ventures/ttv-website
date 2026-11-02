import type { APIContext } from "astro";
import type { z } from "zod";
import { hasMatchingRequestOrigin } from "@/lib/admin/mutation-security";
import { mentorRequestAttention, type MentorRequestEvent } from "@/lib/attention/mentor-producers";
import { ChannelError } from "@/lib/channels/errors";
import { ClefCheckError, clefScreen } from "@/lib/channels/moderation/clef";
import { recordError, recordErrorInBackground } from "@/lib/observability/errors";
import {
  AcceptMentorRequest, CreateMentorRequest, DeclineMentorRequest, IdParams, MentorDirectoryQuery, MentorRequestListQuery,
  RedirectMentorRequest, ROUTES, UpdateMentorAvailability, WithdrawMentorRequest,
} from "@/lib/platform/contracts";
import { requireFlag } from "@/lib/platform/server/flags";
import { platformError, platformJson } from "@/lib/platform/server/http";
import { readBoundedJson, RequestJsonError } from "@/lib/request-json";
import { worthAnotherLook } from "./another-look";
import { getAvailability, listMentors, updateAvailability } from "./profiles";
import {
  acceptRequest, createRequest, declineRequest, getRequest, listRequests, redirectRequest, withdrawRequest, type MentoringContext,
} from "./requests";

/**
 * The mentor connection APIs (README.md beside this file). Every route is 404 while `mentor_requests`
 * is off for the caller (it is effective only while `channels` is on). Signed-in sessions only:
 * personal access tokens are refused, channels tokens included (no token scope covers asking a
 * person for their time). Agent sessions act as their person, as on the channel APIs. Writes must
 * come from the same origin.
 */

type Env = Pick<Cloudflare.Env, "DB" | "DEPLOYMENT_ENVIRONMENT" | "PLATFORM_FLAGS_OVERRIDE" | "DEPLOYMENT_VERSION">
  & Partial<Pick<Cloudflare.Env, "AI" | "AI_GATEWAY_NAME">>;
type Context = Pick<APIContext, "request" | "locals" | "params">;
export type MentoringOperation = Extract<keyof typeof ROUTES,
  "listMentors" | "listMentorRequests" | "getMentorRequest" | "createMentorRequest" | "acceptMentorRequest"
  | "redirectMentorRequest" | "declineMentorRequest" | "withdrawMentorRequest" | "getMentorAvailability" | "updateMentorAvailability"
  | "getWorthAnotherLook">;

/** Test seams: the clock, the code of conduct version, work after the response, and Clef's time limit. */
export interface MentoringRequestOptions {
  now?: () => number; conductVersion?: number; defer?: (task: () => Promise<void>) => void; clefTimeoutMs?: number;
}

const READS: ReadonlySet<MentoringOperation> = new Set([
  "listMentors", "listMentorRequests", "getMentorRequest", "getMentorAvailability", "getWorthAnotherLook",
]);
/** A note of up to 2,000 characters of up to 4 bytes, JSON-escaped, with the other fields. */
const BODY_BYTES = 16_000;

class Refusal extends Error {
  constructor(readonly response: Response) { super("Refused"); }
}

function parse<T>(contract: z.ZodType<T>, value: unknown): T {
  const result = contract.safeParse(value);
  if (!result.success) throw new Refusal(platformError("validation", result.error.issues[0]?.message ?? "Invalid request.", 400));
  return result.data;
}

async function readBody(request: Request): Promise<unknown> {
  try { return await readBoundedJson(request, BODY_BYTES); }
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

/** The flag, then who is asking, then how and from where. null when the request may go on. */
async function refusal(operation: MentoringOperation, { locals, request }: Context, env: Env): Promise<Response | null> {
  const denied = await requireFlag({ db: env.DB, env, user: locals.user ?? null, isAdmin: locals.isAdmin, locals }, "mentor_requests");
  if (denied) return denied;
  if (!locals.user) return platformError("forbidden", "Not permitted.", 403);
  if (locals.personalAccessToken) return platformError("forbidden", "Personal access tokens can't use mentor requests.", 403);
  if (!READS.has(operation) && !hasMatchingRequestOrigin(request)) return platformError("forbidden", "Same-origin request required.", 403);
  return null;
}

/** Work after the response, through the request's waitUntil (or the test seam). Nothing here fails the request. */
function afterResponse(context: Context, env: Env, options: MentoringRequestOptions) {
  const run = (task: () => Promise<void>) => {
    if (options.defer) options.defer(task);
    else if (context.locals.cfContext) context.locals.cfContext.waitUntil(task());
    else void task();
  };
  const attention = { db: env.DB, env };
  return {
    told: (requestId: string, event: MentorRequestEvent) => run(() => mentorRequestAttention(attention, requestId, event)),
    /** The note the acceptance posted gets Clef's check after the response, as every post does. */
    opened: (messageId: string, channelId: string, body: string) => run(async () => {
      try {
        await clefScreen(
          { db: env.DB, ai: env.AI, gatewayName: env.AI_GATEWAY_NAME, timeoutMs: options.clefTimeoutMs, now: options.now },
          { id: messageId, channelId, channelKind: "DIRECT", body },
        );
      } catch (error) {
        await recordError(env.DB, {
          source: "request", route: ROUTES.acceptMentorRequest.path, version: env.DEPLOYMENT_VERSION,
          level: error instanceof ClefCheckError ? "warning" : "error",
          error: error instanceof ClefCheckError ? error : new Error("Channel message check could not be applied."),
        });
      }
    }),
  };
}

async function handle(operation: MentoringOperation, context: Context, env: Env, options: MentoringRequestOptions, userId: string) {
  const { request, params } = context;
  const ctx: MentoringContext = { db: env.DB, viewerId: userId, now: options.now?.() ?? Date.now(), conductVersion: options.conductVersion };
  const later = afterResponse(context, env, options);
  const id = () => parse(IdParams, { id: params.id }).id;
  switch (operation) {
    case "listMentors":
      return platformJson(ROUTES.listMentors.response.parse(await listMentors(env.DB, userId, readQuery(request, MentorDirectoryQuery), ctx.now)));
    case "listMentorRequests":
      return platformJson(ROUTES.listMentorRequests.response.parse(await listRequests(ctx, readQuery(request, MentorRequestListQuery))));
    case "getMentorRequest":
      return platformJson(ROUTES.getMentorRequest.response.parse(await getRequest(ctx, id())));
    case "getWorthAnotherLook":
      return platformJson(ROUTES.getWorthAnotherLook.response.parse(await worthAnotherLook({ db: env.DB, env, locals: context.locals })));
    case "getMentorAvailability":
      return platformJson(ROUTES.getMentorAvailability.response.parse(await getAvailability(env.DB, userId, ctx.now)));
    case "updateMentorAvailability": {
      const input = parse(UpdateMentorAvailability, await readBody(request));
      return platformJson(ROUTES.updateMentorAvailability.response.parse(await updateAvailability(env.DB, userId, input, ctx.now)));
    }
    case "createMentorRequest": {
      const created = await createRequest(ctx, parse(CreateMentorRequest, await readBody(request)));
      later.told(created.id, "created");
      return platformJson(ROUTES.createMentorRequest.response.parse(created), 201);
    }
    case "acceptMentorRequest": {
      const requestId = id();
      parse(AcceptMentorRequest, await readBody(request));
      const { request: accepted, channelId, opening } = await acceptRequest(ctx, requestId);
      later.told(requestId, "accepted");
      if (opening) later.opened(opening.id, channelId, opening.body);
      return platformJson(ROUTES.acceptMentorRequest.response.parse(accepted));
    }
    case "redirectMentorRequest": {
      const requestId = id();
      const redirected = await redirectRequest(ctx, requestId, parse(RedirectMentorRequest, await readBody(request)));
      later.told(requestId, "redirected");
      return platformJson(ROUTES.redirectMentorRequest.response.parse(redirected));
    }
    case "declineMentorRequest": {
      const requestId = id();
      const declined = await declineRequest(ctx, requestId, parse(DeclineMentorRequest, await readBody(request)));
      later.told(requestId, "declined");
      return platformJson(ROUTES.declineMentorRequest.response.parse(declined));
    }
    case "withdrawMentorRequest": {
      const requestId = id();
      parse(WithdrawMentorRequest, await readBody(request));
      const withdrawn = await withdrawRequest(ctx, requestId);
      later.told(requestId, "withdrawn");
      return platformJson(ROUTES.withdrawMentorRequest.response.parse(withdrawn));
    }
  }
}

export async function mentoringRequest(
  operation: MentoringOperation, context: Context, env: Env, options: MentoringRequestOptions = {},
): Promise<Response> {
  try {
    const refused = await refusal(operation, context, env);
    const user = context.locals.user;
    if (refused || !user) return refused ?? platformError("forbidden", "Not permitted.", 403);
    return await handle(operation, context, env, options, user.id);
  } catch (error) {
    if (error instanceof Refusal) return error.response;
    if (error instanceof ChannelError) return platformError(error.code, error.message, error.status, error.retryAfterMs);
    recordErrorInBackground(context.locals.cfContext, env.DB, {
      source: "request", route: ROUTES[operation].path, error, version: env.DEPLOYMENT_VERSION,
    });
    return platformError("server", "Could not complete the mentor request.", 500);
  }
}
