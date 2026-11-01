import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { onboardingRequest } from "@/lib/onboarding/http";

export const GET: APIRoute = (context) => onboardingRequest("getOnboarding", context, env);
export const PUT: APIRoute = (context) => onboardingRequest("updateOnboarding", context, env);
