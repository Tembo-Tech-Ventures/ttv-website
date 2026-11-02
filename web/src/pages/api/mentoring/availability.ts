import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { mentoringRequest } from "@/lib/mentoring/http";

export const GET: APIRoute = (context) => mentoringRequest("getMentorAvailability", context, env);
export const PUT: APIRoute = (context) => mentoringRequest("updateMentorAvailability", context, env);
