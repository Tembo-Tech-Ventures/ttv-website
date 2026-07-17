import {
  AiGatewayConfigurationError,
  AiGatewayResponseError,
  type ChatCompletionStream,
  type ChatMessage,
} from "@/lib/ai/gateway";
import { titleFromMessage } from "@/lib/chat/contracts";
import { buildChatMessages, MAX_HISTORY_MESSAGES } from "@/lib/chat/prompt";
import {
  toConversationView,
  toMessageView,
  type ChatConversationRecord,
  type ChatMessageRecord,
  type ChatRepository,
} from "@/lib/chat/repository";
import { consumeOpenAiStream, encodeChatStreamEvent } from "@/lib/chat/stream";
import {
  CHAT_STREAM_CONTENT_TYPE,
  NEW_CONVERSATION_TITLE,
  type RetrievalStatus,
} from "@/lib/chat/types";
import type { TranscriptRetrievalResult } from "@/lib/chat/retrieval";

export class ChatRequestError extends Error {
  override readonly name = "ChatRequestError";

  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

export interface SendMessageDependencies {
  repository: Pick<
    ChatRepository,
    | "findConversation"
    | "listRecentMessages"
    | "createMessage"
    | "deleteMessage"
    | "touchConversation"
  >;
  checkRateLimit(userId: string): Promise<boolean>;
  retrieve(): Promise<TranscriptRetrievalResult>;
  openCompletion(
    messages: ChatMessage[],
    signal?: AbortSignal
  ): Promise<ChatCompletionStream>;
}

interface SendMessageInput {
  userId: string;
  conversationId: string;
  message: string;
  signal?: AbortSignal;
}

function conversationWithTitle(
  conversation: ChatConversationRecord,
  message: string
): ChatConversationRecord {
  return conversation.title === NEW_CONVERSATION_TITLE
    ? { ...conversation, title: titleFromMessage(message), updatedAt: new Date() }
    : conversation;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function createSendMessageResponse(
  input: SendMessageInput,
  dependencies: SendMessageDependencies
): Promise<Response> {
  if (!(await dependencies.checkRateLimit(input.userId))) {
    throw new ChatRequestError(
      "You are sending messages too quickly. Please wait a moment and try again.",
      429,
      "rate_limited"
    );
  }

  const conversation = await dependencies.repository.findConversation(
    input.userId,
    input.conversationId
  );
  if (!conversation) {
    throw new ChatRequestError("Conversation not found.", 404, "not_found");
  }

  let retrieval: TranscriptRetrievalResult;
  try {
    retrieval = await dependencies.retrieve();
  } catch {
    retrieval = { sources: [], status: "unavailable" };
  }

  const history = await dependencies.repository.listRecentMessages(
    input.userId,
    input.conversationId,
    MAX_HISTORY_MESSAGES
  );
  const messages = buildChatMessages({
    history,
    question: input.message,
    sources: retrieval.sources,
    retrievalStatus: retrieval.status,
  });
  const completion = await dependencies.openCompletion(messages, input.signal);

  let userMessage: ChatMessageRecord;
  try {
    userMessage = await dependencies.repository.createMessage({
      conversationId: input.conversationId,
      userId: input.userId,
      role: "user",
      content: input.message,
    });
  } catch (error) {
    await completion.reader.cancel();
    throw error;
  }

  const titledConversation = conversationWithTitle(conversation, input.message);
  const citations = retrieval.sources.map((source) => source.citation);
  let settled = false;
  let cancelled = false;
  let committing = false;
  let cleanupPromise: Promise<void> | undefined;

  const cleanupUserMessage = () => {
    cleanupPromise ??= dependencies.repository.deleteMessage(
      input.userId,
      userMessage.id
    );
    return cleanupPromise;
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encodeChatStreamEvent({
          type: "metadata",
          conversation: toConversationView(titledConversation),
          userMessage: toMessageView(userMessage),
          citations,
          retrievalStatus: retrieval.status,
        })
      );

      const pump = async () => {
        try {
          const answer = await consumeOpenAiStream(completion.reader, (content) => {
            controller.enqueue(encodeChatStreamEvent({ type: "delta", content }));
          });
          if (!answer.trim()) throw new Error("AI Gateway returned an empty answer.");
          if (cancelled) throw new DOMException("Chat request cancelled.", "AbortError");

          committing = true;
          await dependencies.repository.touchConversation(
            input.userId,
            input.conversationId,
            titledConversation.title
          );
          const assistantMessage = await dependencies.repository.createMessage({
            conversationId: input.conversationId,
            userId: input.userId,
            role: "assistant",
            content: answer,
            citations,
            model: completion.model,
          });
          settled = true;
          controller.enqueue(
            encodeChatStreamEvent({
              type: "done",
              message: toMessageView(assistantMessage),
            })
          );
          controller.close();
        } catch (error) {
          await cleanupUserMessage();
          if (!cancelled && !isAbortError(error)) {
            controller.enqueue(
              encodeChatStreamEvent({
                type: "error",
                error: "The response was interrupted. Please retry your message.",
              })
            );
            controller.close();
          }
        }
      };

      void pump();
    },
    async cancel() {
      cancelled = true;
      if (settled || committing) return;
      await Promise.all([completion.reader.cancel(), cleanupUserMessage()]);
    },
  });

  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": CHAT_STREAM_CONTENT_TYPE,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function chatServiceErrorResponse(error: unknown): Response {
  if (error instanceof ChatRequestError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  if (error instanceof AiGatewayConfigurationError) {
    return Response.json(
      { error: "AI chat is temporarily unavailable.", code: "not_configured" },
      { status: 503 }
    );
  }
  if (error instanceof AiGatewayResponseError) {
    return Response.json(
      { error: "The AI service could not start a response.", code: "upstream_error" },
      { status: 502 }
    );
  }

  return Response.json(
    { error: "Unable to process the chat request.", code: "internal_error" },
    { status: 500 }
  );
}

export function retrievalStatusLabel(status: RetrievalStatus): string {
  switch (status) {
    case "grounded":
      return "TTV sources found";
    case "general":
      return "General learning answer";
    case "unavailable":
      return "Session search unavailable";
  }
}
