import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { attentionRequest } from "@/lib/attention/http";

export const GET: APIRoute = context => attentionRequest("list", context, env);
