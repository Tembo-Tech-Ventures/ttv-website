import type { APIContext } from "astro";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import { AttentionQuery, MarkAttentionRead, ROUTES } from "@/lib/platform/contracts";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { requireFlag } from "@/lib/platform/server/flags";
import { platformError, platformJson } from "@/lib/platform/server/http";
import { hasMatchingRequestOrigin } from "@/lib/admin/mutation-security";
import { readBoundedJson, RequestJsonError } from "@/lib/request-json";
import { getAttentionCount } from "./count";
import { AttentionCursorError, listAttention, markAttentionRead } from "./service";

export async function attentionRequest(
  operation: "list" | "count" | "read", context: Pick<APIContext, "request" | "locals">,
  env: Pick<Cloudflare.Env, "DB" | "DEPLOYMENT_ENVIRONMENT" | "PLATFORM_FLAGS_OVERRIDE">,
): Promise<Response> {
  const { request, locals } = context;
  try {
    const denied = await requireFlag({ db: env.DB, env, user: locals.user ?? null, locals }, "spaces");
    if (denied) return denied;
    if (!locals.user || locals.personalAccessToken) return platformError("forbidden", "Not permitted.", 403);
    const db = drizzle(env.DB, { schema });
    const capabilities = await capabilitiesFor(db, locals.user);
    if (capabilities.spaces.length === 0) return platformError("forbidden", "Not permitted.", 403);
    if (operation === "count") return platformJson(ROUTES.countAttention.response.parse(await getAttentionCount(db, locals.user.id, capabilities)));
    if (operation === "list") {
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some(key => params.getAll(key).length !== 1)) return platformError("validation", "Duplicate query parameter.", 400);
      const query = AttentionQuery.safeParse(Object.fromEntries(params));
      if (!query.success) return platformError("validation", "Invalid attention query.", 400);
      return platformJson(ROUTES.listAttention.response.parse(await listAttention(db, locals.user.id, query.data, capabilities)));
    }
    if (!hasMatchingRequestOrigin(request)) return platformError("forbidden", "Same-origin request required.", 403);
    const input = MarkAttentionRead.safeParse(await readBoundedJson(request));
    if (!input.success) return platformError("validation", "Invalid read request.", 400);
    return platformJson(ROUTES.markAttentionRead.response.parse(await markAttentionRead(db, locals.user.id, input.data, capabilities)));
  } catch (error) {
    if (error instanceof AttentionCursorError) return platformError("validation", error.message, 400);
    if (error instanceof RequestJsonError) return platformError("validation", error.message, error.status);
    return platformError("server", "Could not access attention items.", 500);
  }
}
