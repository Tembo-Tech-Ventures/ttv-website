import { z } from "zod";

export const openAiStreamChunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z.object({ content: z.string().optional() }).optional(),
      })
    )
    .optional(),
});

export const chatCitationSchema = z.object({
  recordingId: z.string().min(1),
  title: z.string(),
  startTime: z.number().finite().nonnegative(),
  endTime: z.number().finite().nonnegative(),
  text: z.string(),
});

export const chatConversationViewSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const chatMessageViewSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  citations: z.array(chatCitationSchema),
  createdAt: z.string().datetime({ offset: true }),
});

export const conversationPayloadSchema = z.object({
  conversation: chatConversationViewSchema,
});

export const conversationDetailPayloadSchema = conversationPayloadSchema.extend({
  messages: z.array(chatMessageViewSchema),
});

export const conversationListPayloadSchema = z.object({
  conversations: z.array(chatConversationViewSchema),
});

export const apiErrorPayloadSchema = z.object({
  error: z.string().optional(),
});

export const chatStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("metadata"),
    conversation: chatConversationViewSchema,
    userMessage: chatMessageViewSchema,
    citations: z.array(chatCitationSchema),
    retrievalStatus: z.enum(["grounded", "general", "unavailable"]),
  }),
  z.object({
    type: z.literal("delta"),
    content: z.string(),
  }),
  z.object({
    type: z.literal("done"),
    message: chatMessageViewSchema,
  }),
  z.object({
    type: z.literal("error"),
    error: z.string(),
  }),
]);
