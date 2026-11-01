import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { channelRequest } from "@/lib/channels/http";

export const GET: APIRoute = (context) => channelRequest("listChannels", context, env);
