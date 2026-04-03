import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { createAuth } from "@/lib/auth";

const handleAuth: APIRoute = async ({ request }) => {
  const auth = createAuth(env.DB);
  return auth.handler(request);
};

export const GET = handleAuth;
export const POST = handleAuth;
