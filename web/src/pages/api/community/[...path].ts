import { handleQaCommunityRequest } from "@/lib/community/staging-persona-qa";
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { communityActor } from "@/lib/community/actor";
import { handleCommunityRequest } from "@/lib/community/http";

export const ALL: APIRoute = ({ request, params, locals }) => locals.stagingQa
  ? handleQaCommunityRequest(request, params.path ?? "", locals.stagingQa, env)
  : handleCommunityRequest(request, params.path ?? "", communityActor(locals), env.DB, env);
