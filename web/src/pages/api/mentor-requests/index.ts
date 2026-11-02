import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { mentoringRequest } from "@/lib/mentoring/http";

export const GET: APIRoute = (context) => mentoringRequest("listMentorRequests", context, env);
export const POST: APIRoute = (context) => mentoringRequest("createMentorRequest", context, env);
