import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { mentoringRequest } from "@/lib/mentoring/http";

export const POST: APIRoute = (context) => mentoringRequest("redirectMentorRequest", context, env);
