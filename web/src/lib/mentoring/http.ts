import type { APIContext } from "astro";
import type { z } from "zod";
import { hasMatchingRequestOrigin } from "@/lib/admin/mutation-security";
import { userHasAdminRole } from "@/lib/admin/roles";
import { mentorRequestAttention, type MentorRequestEvent } from "@/lib/attention/mentor-producers";
import { ChannelError } from "@/lib/channels/errors";
import { ClefCheckError, clefScreen } from "@/lib/channels/moderation/clef";
import { recordError, recordErrorInBackground } from "@/lib/observability/errors";
import {
  AcceptMentorRequest, CreateMentorRequest, DecideMentorRequestCase, DeclineMentorRequest, IdParams, MentorDirectoryQuery,
  MentorRequestCaseQuery, MentorRequestListQuery, RedirectMentorRequest, ReportMentorRequest, ROUTES, UpdateMentorAvailability,
  WithdrawMentorRequest,
} from "@/lib/platform/contracts";
import { requireFlag } from "@/lib/platform/server/flags";
import { platformError, platformJson } from "@/lib/platform/server/http";
import { readBoundedJson, RequestJsonError } from "@/lib/request-json";
import { worthAnotherLook } from "./another-look";
import { clefHold, decideCase, listCases, reportRequest, requireAdmin } from "./checks";
import { getAvailability, listMentors, updateAvailability } from "./profiles";
import {
  acceptRequest, createRequest, declineRequest, getRequest, listRequests, redirectRequest, withdrawRequest, type MentoringContext,
} from "./requests";

/**
 * The mentor connection APIs (README.md beside this file), and the admins' checks on request notes
 * under /api/moderation/mentor-requests. Every route is 404 while `mentor_requests` is off for the
 * caller (it is effective only while `channels` is on). Signed-in sessions only: personal access
 * tokens are refused, channels and admin tokens included (no token scope covers asking a person for
 * their time, or judging that request). Agent sessions act as their person, as on the channel APIs.
 * Writes must come from the same origin.
 */

type Env = Pick<Cloudflare.Env, "DB" | "DEPLOYMENT_ENVIRONMENT" | "PLATFORM_FLAGS_OVERRIDE" | "DEPLOYMENT_VERSION">
  & Partial<Pick<Cloudflare.Env, "AI" | "AI_GATEWAY_NAME">>;
type Context = Pick<APIContext, "request" | "locals" | "params">;
export type MentoringOperation = Extract<keyof typeof ROUTES,
  "listMentors" | "listMentorRequests" | "getMentorRequest" | "createMentorRequest" | "acceptMentorRequest"
  | "redirectMentorRequest" | "declineMentorRequest" | "withdrawMentorRequest" | "reportMentorRequest" | "getMentorAvailability"
  | "updateMentorAvailability" | "getWorthAnotherLook" | "listMentorRequestCases" | "decideMentorRequestCase">;

/** Test seams: the clock, the code of conduct version, work after the response, and Clef's time limit. */
export interface MentoringRequestOptions {
  now?: () => number; conductVersion?: number; defer?: (task: () => Promise<void>) => void; clefTimeoutMs?: number;
}

const READS: ReadonlySet<MentoringOperation> = new Set([
  "listMentors", "listMentorRequests", "getMentorRequest", "getMentorAvailability", "getWorthAnotherLook", "listMentorRequestCases",
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
    /**
     * A new request's note gets Clef's check before its mentor hears of it: a hold tells the admins
     * instead. When Clef fails the request stays as it is, logged, and the mentor hears of it (fail open).
     */
    asked: (requestId: string) => run(async () => {
      try {
        const outcome = await clefHold({
          db: env.DB, ai: env.AI, gatewayName: env.AI_GATEWAY_NAME, timeoutMs: options.clefTimeoutMs, now: options.now?.() ?? Date.now(),
        }, requestId);
        if (outcome === "held") {
          await mentorRequestAttention(attention, requestId, "checking");
          return;
        }
      } catch (error) {
        await recordError(env.DB, {
          source: "request", route: ROUTES.createMentorRequest.path, version: env.DEPLOYMENT_VERSION,
          level: error instanceof ClefCheckError ? "warning" : "error",
          error: error instanceof ClefCheckError ? error : new Error("Mentor request check could not be applied."),
        });
      }
      await mentorRequestAttention(attention, requestId, "created");
    }),
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

/** Whether the caller is an admin: the middleware's answer, or the roles table's. */
async function isAdmin({ locals }: Context, env: Env, userId: string): Promise<boolean> {
  return locals.isAdmin ?? await userHasAdminRole(env.DB, userId);
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
      later.asked(created.id);
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
    case "reportMentorRequest": {
      const requestId = id();
      const reported = await reportRequest(ctx, requestId, parse(ReportMentorRequest, await readBody(request)));
      later.told(requestId, "checking");
      return platformJson(ROUTES.reportMentorRequest.response.parse(reported));
    }
    case "listMentorRequestCases": {
      const cases = await listCases(ctx, await isAdmin(context, env, userId), readQuery(request, MentorRequestCaseQuery));
      return platformJson(ROUTES.listMentorRequestCases.response.parse(cases));
    }
    case "decideMentorRequestCase": {
      const admin = await isAdmin(context, env, userId);
      requireAdmin(admin);
      const requestId = id();
      const input = parse(DecideMentorRequestCase, await readBody(request));
      const decided = await decideCase(ctx, admin, requestId, input);
      // A kept request reaches its mentor now, if they had not heard of it (the notice is once per request).
      if (input.action === "keep") later.told(requestId, "created");
      // The person asking hears what the check changed for them (QA4-02).
      later.told(requestId, "decided");
      return platformJson(ROUTES.decideMentorRequestCase.response.parse(decided));
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
