import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { adminAccessRequest } from "@/lib/onboarding/http";

// Middleware requires ADMIN; the handler also refuses PATs and agent sessions.
export const GET: APIRoute = (context) => adminAccessRequest("listAccessRequests", context, env);
