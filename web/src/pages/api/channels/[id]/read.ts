import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { channelRequest } from "@/lib/channels/http";

export const POST: APIRoute = (context) => channelRequest("markChannelRead", context, env);
