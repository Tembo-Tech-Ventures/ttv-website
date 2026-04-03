import type { APIRoute } from "astro";
import { createAuth } from "@/lib/auth";

const handleAuth: APIRoute = async ({ request, locals }) => {
  const auth = createAuth(locals.runtime.env.DB);
  return auth.handler(request);
};

export const GET = handleAuth;
export const POST = handleAuth;
