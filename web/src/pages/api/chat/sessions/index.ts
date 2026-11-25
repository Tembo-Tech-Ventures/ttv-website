import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { listChatSessions } from "@/lib/chat/sessions";
import * as schema from "@/lib/db/schema";
import { requestCapabilities } from "@/lib/platform/server/request-capabilities";

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // A preview of a saved answer is checked again against what the owner may read now (lib/chat/stored-sources.ts).
  const capabilities = await requestCapabilities(drizzle(env.DB, { schema }), locals);
  const sessions = await listChatSessions(env.DB, user.id, capabilities);
  return Response.json({ sessions });
};
