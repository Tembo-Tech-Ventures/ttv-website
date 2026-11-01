import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { adminAccessRequest } from "@/lib/onboarding/http";

// Middleware requires ADMIN and a same-origin write; the handler also refuses PATs and agent sessions.
export const POST: APIRoute = (context) => adminAccessRequest("decideAccessRequest", context, env);
