import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getChatMessages } from "@/lib/chat/sessions";

export const GET: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "session id is required" }, { status: 400 });

  const messages = await getChatMessages(env.DB, user.id, id);
  if (!messages) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({ messages });
};
