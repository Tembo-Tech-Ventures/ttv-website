import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { channelRequest } from "@/lib/channels/http";

export const PATCH: APIRoute = (context) => channelRequest("editMessage", context, env);
export const DELETE: APIRoute = (context) => channelRequest("deleteMessage", context, env);
