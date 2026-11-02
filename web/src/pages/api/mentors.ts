import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { mentoringRequest } from "@/lib/mentoring/http";

export const GET: APIRoute = (context) => mentoringRequest("listMentors", context, env);
