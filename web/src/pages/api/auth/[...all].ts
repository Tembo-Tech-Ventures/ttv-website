import { createAuth } from "@/lib/auth";
import type { APIRoute } from "astro";

export const ALL: APIRoute = async (ctx) => {
  const auth = createAuth(ctx.locals.runtime.env.DB);
  return auth.handler(ctx.request);
};
