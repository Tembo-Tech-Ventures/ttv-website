import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import { openChatCompletionStream } from "@/lib/ai/gateway";
import { parseJsonRequest, sendMessageSchema } from "@/lib/chat/contracts";
import { createChatRepository } from "@/lib/chat/repository";
import { retrieveTranscriptSources } from "@/lib/chat/retrieval";
import { chatServiceErrorResponse, createSendMessageResponse } from "@/lib/chat/service";

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const conversationId = params.id?.trim();
  if (!conversationId) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }

  const payload = await parseJsonRequest(request);
  if (payload instanceof Response) return payload;
  const parsed = sendMessageSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid message." },
      { status: 400 }
    );
  }

  const db = drizzle(env.DB, { schema });
  const repository = createChatRepository(db);

  try {
    return await createSendMessageResponse(
      {
        userId: user.id,
        conversationId,
        message: parsed.data.message,
        signal: request.signal,
      },
      {
        repository,
        checkRateLimit: async (userId) => {
          const result = await env.CHAT_RATE_LIMITER.limit({ key: userId });
          return result.success;
        },
        retrieve: () =>
          retrieveTranscriptSources({
            db,
            ai: env.AI,
            vectorize: env.VECTORIZE,
            userId: user.id,
            isAdmin: Boolean(locals.isAdmin),
            question: parsed.data.message,
          }),
        openCompletion: (messages, signal) =>
          openChatCompletionStream(env, messages, signal),
      }
    );
  } catch (error) {
    return chatServiceErrorResponse(error);
  }
};
