import { z } from "zod";
import { NEW_CONVERSATION_TITLE, type ChatCitation } from "@/lib/chat/types";

export const MAX_CHAT_MESSAGE_LENGTH = 2_000;
export const MAX_CONVERSATION_TITLE_LENGTH = 80;

export const createConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_CONVERSATION_TITLE_LENGTH).optional(),
  })
  .strict();

export const updateConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_CONVERSATION_TITLE_LENGTH),
  })
  .strict();

export const sendMessageSchema = z
  .object({
    message: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_LENGTH),
  })
  .strict();

const citationSchema = z.object({
  recordingId: z.string(),
  title: z.string(),
  startTime: z.number().finite().nonnegative(),
  endTime: z.number().finite().nonnegative(),
  text: z.string(),
});

export async function parseJsonRequest(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return Response.json(
      { error: "Content-Type must be application/json." },
      { status: 415 }
    );
  }

  try {
    return await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
}

export function titleFromMessage(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return NEW_CONVERSATION_TITLE;
  if (normalized.length <= MAX_CONVERSATION_TITLE_LENGTH) return normalized;

  return `${normalized.slice(0, MAX_CONVERSATION_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function parseCitations(value: string | null): ChatCitation[] {
  if (!value) return [];

  try {
    const result = z.array(citationSchema).safeParse(JSON.parse(value));
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}
