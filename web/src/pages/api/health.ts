import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { createHealthResponse } from "@/lib/health";

export const prerender = false;

export const GET: APIRoute = () => createHealthResponse(env);
