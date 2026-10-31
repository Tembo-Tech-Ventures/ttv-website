import type { APIContext } from "astro";
import { SearchQuery } from "@/lib/platform/contracts";
import { requireFlag } from "@/lib/platform/server/flags";
import { platformError, platformJson } from "@/lib/platform/server/http";
import { searchPlatform, SearchScopeError } from "./service";

export async function searchRequest(
  { request, locals }: Pick<APIContext, "request" | "locals">,
  env: Pick<Cloudflare.Env, "DB" | "DEPLOYMENT_ENVIRONMENT" | "PLATFORM_FLAGS_OVERRIDE">,
): Promise<Response> {
  try {
    const denial = await requireFlag({ db: env.DB, env, user: locals.user ?? null, locals }, "spaces");
    if (denial) return denial;
    if (!locals.user || locals.personalAccessToken || locals.stagingFixture || locals.stagingQa) {
      return platformError("forbidden", "Not permitted.", 403);
    }
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => params.getAll(key).length !== 1)) {
      return platformError("validation", "Duplicate query parameter.", 400);
    }
    const query = SearchQuery.safeParse(Object.fromEntries(params));
    if (!query.success) return platformError("validation", "Invalid search query.", 400);
    return platformJson(await searchPlatform(env.DB, locals.user.id, query.data));
  } catch (error) {
    if (error instanceof SearchScopeError) return platformError("forbidden", "Search scope is not available.", 403);
    // Do not log search terms, source content, SQL errors or private records.
    return platformError("server", "Could not search right now.", 500);
  }
}
