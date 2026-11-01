import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { onboardingRequest } from "@/lib/onboarding/http";

export const POST: APIRoute = (context) => onboardingRequest("dismissAccessRequest", context, env);
