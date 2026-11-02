import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { createCommunityService } from "@/lib/community/service";
import { moderationMcpTools } from "@/lib/channels/moderation/mcp";
import { handleCommunityMcp } from "@/lib/community/mcp";

export const ALL: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return new Response("Authentication required", { status: 401, headers: { "Cache-Control": "no-store" } });
  // Unknown bearer schemes must never inherit an accompanying browser cookie.
  if (request.headers.has("Authorization") && !locals.personalAccessToken) return new Response("Scoped personal access token required", { status: 401 });
  const scopes = locals.personalAccessToken?.scopes ?? null;
  return handleCommunityMcp(request, {
    userId: locals.user.id,
    scopes,
  }, createCommunityService(env.DB, locals.user.id, locals.stagingFixture, env.DEPLOYMENT_ENVIRONMENT, env.PLATFORM_FLAGS_OVERRIDE), env, [
    moderationMcpTools({ db: env.DB, env, locals, scopes }),
  ]);
};
