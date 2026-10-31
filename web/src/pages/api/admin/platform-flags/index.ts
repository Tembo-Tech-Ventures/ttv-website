import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { listFlags } from "@/lib/platform/server/flag-admin";
import { platformError, platformJson } from "@/lib/platform/server/http";

// Rollout controls deliberately remain available while every flag is OFF.
// Middleware authenticates ADMIN and requires admin:read for PATs.
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.isAdmin || !locals.user) return platformError("forbidden", "Forbidden.", 403);
  try {
    return platformJson(await listFlags(env.DB));
  } catch {
    return platformError("server", "Could not read feature flags.", 500);
  }
};
