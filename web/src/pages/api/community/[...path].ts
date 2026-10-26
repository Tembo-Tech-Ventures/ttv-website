import { handleQaCommunityRequest } from "@/lib/community/staging-persona-qa";
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { isAgentSession } from "@/lib/agent-auth";
import { handleCommunityRequest } from "@/lib/community/http";

export const ALL: APIRoute = ({ request, params, locals }) => locals.stagingQa ? handleQaCommunityRequest(request,params.path ?? "",locals.stagingQa,env) : handleCommunityRequest(
  request, params.path ?? "", locals.user ? {
    id: locals.user.id, demo: locals.stagingDemo, fixture: locals.stagingFixture, delegatedSession: isAgentSession(locals.session?.userAgent), scopes: locals.personalAccessToken?.scopes ?? null,
  } : null, env.DB, env,
);
