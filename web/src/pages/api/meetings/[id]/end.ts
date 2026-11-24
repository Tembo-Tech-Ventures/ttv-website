import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { meetingRequest } from "@/lib/meetings/http";

export const POST: APIRoute = (context) => meetingRequest("endMeeting", context, env);
