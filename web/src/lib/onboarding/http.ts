import type { APIContext } from "astro";
import type { z } from "zod";
import { isAgentSession } from "@/lib/agent-auth";
import { hasMatchingRequestOrigin } from "@/lib/admin/mutation-security";
import { accessRequestAttention } from "@/lib/attention/producers";
import { recordErrorInBackground } from "@/lib/observability/errors";
import {
  AccessDecision, AdminAccessRequestQuery, CreateAccessRequest, IdParams, ROUTES, UpdateOnboarding,
  DismissAccessRequest, WithdrawAccessRequest,
} from "@/lib/platform/contracts";
import { requireFlag } from "@/lib/platform/server/flags";
import { platformError, platformJson } from "@/lib/platform/server/http";
import { readBoundedJson, RequestJsonError } from "@/lib/request-json";
import { AccessRequestCursorError, decideAccessRequest, listAccessRequests } from "./decisions";
import {
  OnboardingError, createAccessRequest, dismissPrompt, getOnboardingState, markAccessRequestSeen, saveIntents,
  withdrawAccessRequest,
} from "./service";

/**
 * The onboarding and access-request APIs (README.md beside this file). Browser sessions only:
 * personal access tokens and agent sessions are refused on every route, the admin ones included,
 * because request notes are for human administrators and no agent grants roles.
 */

type Env = Pick<Cloudflare.Env, "DB" | "DEPLOYMENT_ENVIRONMENT" | "PLATFORM_FLAGS_OVERRIDE" | "DEPLOYMENT_VERSION">;
type Context = Pick<APIContext, "request" | "locals" | "params">;
type Operation = keyof typeof ROUTES;
export type RequesterOperation = Extract<Operation,
  "getOnboarding" | "updateOnboarding" | "createAccessRequest" | "withdrawAccessRequest" | "dismissAccessRequest">;
export type AdminOperation = Extract<Operation, "listAccessRequests" | "decideAccessRequest">;

/** A request body holds at most a 600-character note, two 200-character fields and a 2048-character link. */
const MAX_BODY_BYTES = 8_192;
const STATUS: Record<OnboardingError["code"], number> = { not_found: 404, conflict: 409, rate_limited: 429 };

class Refusal extends Error {
  constructor(readonly response: Response) { super("Refused"); }
}
const refuse = (...args: Parameters<typeof platformError>) => new Refusal(platformError(...args));

function requireBrowserSession(locals: App.Locals) {
  if (locals.personalAccessToken || isAgentSession(locals.session?.userAgent)) {
    throw refuse("forbidden", "Use a browser session to manage access requests.", 403);
  }
}

async function readBody(request: Request): Promise<unknown> {
  if (!hasMatchingRequestOrigin(request)) throw refuse("forbidden", "Same-origin request required.", 403);
  try { return await readBoundedJson(request, MAX_BODY_BYTES); }
  catch (error) {
    if (error instanceof RequestJsonError) throw refuse("validation", error.message, error.status);
    throw error;
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw refuse("validation", result.error.issues[0]?.message ?? "Invalid request.", 400);
  return result.data;
}

function requestId(params: Context["params"]): string {
  return parse(IdParams, { id: params.id }).id;
}

async function respond(operation: Operation, context: Context, env: Env, handle: () => Promise<Response>): Promise<Response> {
  try {
    return await handle();
  } catch (error) {
    if (error instanceof Refusal) return error.response;
    if (error instanceof OnboardingError) return platformError(error.code, error.message, STATUS[error.code], error.retryAfterMs);
    if (error instanceof AccessRequestCursorError) return platformError("validation", error.message, 400);
    recordErrorInBackground(context.locals.cfContext, env.DB, {
      source: "request", route: ROUTES[operation].path, error, version: env.DEPLOYMENT_VERSION,
    });
    return platformError("server", "Could not complete the access request.", 500);
  }
}

/** /api/platform/onboarding and /api/platform/access-requests…: the signed-in person's own state. */
export function onboardingRequest(operation: RequesterOperation, context: Context, env: Env): Promise<Response> {
  return respond(operation, context, env, async () => {
    const { locals, request, params } = context;
    const denied = await requireFlag({ db: env.DB, env, user: locals.user ?? null, locals }, "onboarding");
    if (denied) return denied;
    if (!locals.user) return platformError("forbidden", "Not permitted.", 403);
    requireBrowserSession(locals);
    const userId = locals.user.id;
    const state = async (status = 200) =>
      platformJson(ROUTES[operation].response.parse(await getOnboardingState(env.DB, userId)), status);

    switch (operation) {
      case "getOnboarding":
        return state();
      case "updateOnboarding": {
        const update = parse(UpdateOnboarding, await readBody(request));
        if ("intents" in update) await saveIntents(env.DB, userId, update.intents);
        else await dismissPrompt(env.DB, userId);
        return state();
      }
      case "createAccessRequest": {
        const id = await createAccessRequest(env.DB, userId, parse(CreateAccessRequest, await readBody(request)));
        await accessRequestAttention({ db: env.DB, env }, id);
        return state(201);
      }
      case "withdrawAccessRequest": {
        const id = requestId(params);
        parse(WithdrawAccessRequest, await readBody(request));
        await withdrawAccessRequest(env.DB, userId, id);
        return state();
      }
      case "dismissAccessRequest": {
        const id = requestId(params);
        parse(DismissAccessRequest, await readBody(request));
        await markAccessRequestSeen(env.DB, userId, { id });
        return state();
      }
    }
  });
}

/**
 * /api/admin/access-requests…: middleware has already required ADMIN. Not flag-gated, so pending
 * requests are never stranded when onboarding is switched off.
 */
export function adminAccessRequest(operation: AdminOperation, context: Context, env: Env): Promise<Response> {
  return respond(operation, context, env, async () => {
    const { locals, request, params } = context;
    if (!locals.isAdmin || !locals.user) return platformError("forbidden", "Not permitted.", 403);
    requireBrowserSession(locals);

    if (operation === "listAccessRequests") {
      const search = new URL(request.url).searchParams;
      if ([...search.keys()].some((key) => search.getAll(key).length !== 1)) {
        return platformError("validation", "Duplicate query parameter.", 400);
      }
      const query = parse(AdminAccessRequestQuery, Object.fromEntries(search));
      return platformJson(ROUTES.listAccessRequests.response.parse(await listAccessRequests(env.DB, query)));
    }
    const id = requestId(params);
    const decision = parse(AccessDecision, await readBody(request));
    const decided = await decideAccessRequest({ db: env.DB, env }, { id, actorId: locals.user.id, ...decision });
    return platformJson(ROUTES.decideAccessRequest.response.parse(decided));
  });
}
