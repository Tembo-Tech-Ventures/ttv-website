import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { getChatMessages } from "@/lib/chat/sessions";
import * as schema from "@/lib/db/schema";
import { requestCapabilities } from "@/lib/platform/server/request-capabilities";

export const GET: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "session id is required" }, { status: 400 });

  // Saved answers are checked again against what the owner may read now (lib/chat/stored-sources.ts).
  const capabilities = await requestCapabilities(drizzle(env.DB, { schema }), locals);
  const messages = await getChatMessages(env.DB, user.id, id, capabilities);
  if (!messages) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({ messages });
};
