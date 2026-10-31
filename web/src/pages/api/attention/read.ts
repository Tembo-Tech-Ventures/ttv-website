import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { attentionRequest } from "@/lib/attention/http";

export const POST: APIRoute = context => attentionRequest("read", context, env);
