import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { searchRequest } from "@/lib/search/http";

export const GET: APIRoute = context => searchRequest(context, env);
