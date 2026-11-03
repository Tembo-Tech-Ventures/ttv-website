import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { communityResponse } from "@/lib/community/route";

export const ALL: APIRoute = ({ request, params, locals }) => communityResponse(request, params.path ?? "", locals, env);
