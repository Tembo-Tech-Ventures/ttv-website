import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import { createConversationSchema, parseJsonRequest } from "@/lib/chat/contracts";
import { createChatRepository, toConversationView } from "@/lib/chat/repository";
import { NEW_CONVERSATION_TITLE } from "@/lib/chat/types";

const noStoreHeaders = { "Cache-Control": "no-store" };

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const repository = createChatRepository(drizzle(env.DB, { schema }));
  const conversations = await repository.listConversations(user.id);
  return Response.json(
    { conversations: conversations.map(toConversationView) },
    { headers: noStoreHeaders }
  );
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const payload = await parseJsonRequest(request);
  if (payload instanceof Response) return payload;
  const parsed = createConversationSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid conversation." },
      { status: 400 }
    );
  }

  const repository = createChatRepository(drizzle(env.DB, { schema }));
  const conversation = await repository.createConversation(
    user.id,
    parsed.data.title ?? NEW_CONVERSATION_TITLE
  );
  return Response.json(
    { conversation: toConversationView(conversation) },
    { status: 201, headers: noStoreHeaders }
  );
};
