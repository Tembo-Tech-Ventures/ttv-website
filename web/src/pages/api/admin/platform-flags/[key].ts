import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { readBoundedJson, RequestJsonError } from "@/lib/request-json";
import { FlagKey, UpdateFlag } from "@/lib/platform/server/flag-contracts";
import { updateFlag } from "@/lib/platform/server/flag-admin";
import { platformError, platformJson } from "@/lib/platform/server/http";

// Middleware authenticates ADMIN, checks admin:write for PATs, and enforces
// same-origin browser writes. Clients cannot supply the audit actor or time.
export const PUT: APIRoute = async ({ locals, params, request }) => {
  if (!locals.isAdmin || !locals.user) return platformError("forbidden", "Forbidden.", 403);
  const key = FlagKey.safeParse(params.key);
  if (!key.success) return platformError("validation", "Unknown feature flag.", 400);

  let body: unknown;
  try {
    body = await readBoundedJson(request, 1_024);
  } catch (error) {
    if (error instanceof RequestJsonError) return platformError("validation", error.message, error.status);
    throw error;
  }
  const update = UpdateFlag.safeParse(body);
  if (!update.success) return platformError("validation", "Send an audience of OFF, STAFF or ALL.", 400);

  try {
    const flag = await updateFlag(env.DB, key.data, update.data.audience, locals.user.id);
    return flag ? platformJson(flag) : platformError("not_found", "Feature flag not found.", 404);
  } catch {
    return platformError("server", "Could not update feature flag.", 500);
  }
};
