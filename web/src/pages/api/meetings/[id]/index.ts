import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { meetingRequest } from "@/lib/meetings/http";

export const GET: APIRoute = (context) => meetingRequest("getMeeting", context, env);
