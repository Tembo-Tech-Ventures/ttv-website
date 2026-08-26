import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { listChatSessions } from "@/lib/chat/sessions";

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const sessions = await listChatSessions(env.DB, user.id);
  return Response.json({ sessions });
};
