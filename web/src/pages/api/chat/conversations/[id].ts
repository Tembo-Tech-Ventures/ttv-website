import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import { parseJsonRequest, updateConversationSchema } from "@/lib/chat/contracts";
import {
  createChatRepository,
  toConversationView,
  toMessageView,
} from "@/lib/chat/repository";

const noStoreHeaders = { "Cache-Control": "no-store" };

function routeId(params: Record<string, string | undefined>): string | null {
  const id = params.id?.trim();
  if (!id) return null;
  return id;
}

export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const conversationId = routeId(params);
  if (!conversationId) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }

  const repository = createChatRepository(drizzle(env.DB, { schema }));
  const conversation = await repository.findConversation(user.id, conversationId);
  if (!conversation) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  const messages = await repository.listMessages(user.id, conversationId);
  return Response.json(
    {
      conversation: toConversationView(conversation),
      messages: messages.map(toMessageView),
    },
    { headers: noStoreHeaders }
  );
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const conversationId = routeId(params);
  if (!conversationId) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }

  const payload = await parseJsonRequest(request);
  if (payload instanceof Response) return payload;
  const parsed = updateConversationSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid title." },
      { status: 400 }
    );
  }

  const repository = createChatRepository(drizzle(env.DB, { schema }));
  const conversation = await repository.updateConversationTitle(
    user.id,
    conversationId,
    parsed.data.title
  );
  if (!conversation) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  return Response.json(
    { conversation: toConversationView(conversation) },
    { headers: noStoreHeaders }
  );
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const conversationId = routeId(params);
  if (!conversationId) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }

  const repository = createChatRepository(drizzle(env.DB, { schema }));
  const deleted = await repository.deleteConversation(user.id, conversationId);
  if (!deleted) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  return new Response(null, { status: 204, headers: noStoreHeaders });
};
