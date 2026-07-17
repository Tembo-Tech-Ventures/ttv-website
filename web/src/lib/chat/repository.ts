import { and, asc, desc, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/database";
import { parseCitations } from "@/lib/chat/contracts";
import type {
  ChatCitation,
  ChatConversationView,
  ChatMessageView,
} from "@/lib/chat/types";

export type ChatConversationRecord = typeof schema.chatConversation.$inferSelect;
export type ChatMessageRecord = typeof schema.chatMessage.$inferSelect;

export function toConversationView(
  conversation: ChatConversationRecord
): ChatConversationView {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

export function toMessageView(message: ChatMessageRecord): ChatMessageView {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    citations: parseCitations(message.citations),
    createdAt: message.createdAt.toISOString(),
  };
}

export function createChatRepository(db: Database) {
  return {
    async listConversations(userId: string): Promise<ChatConversationRecord[]> {
      return db.query.chatConversation.findMany({
        where: eq(schema.chatConversation.userId, userId),
        orderBy: [desc(schema.chatConversation.updatedAt)],
        limit: 50,
      });
    },

    async findConversation(
      userId: string,
      conversationId: string
    ): Promise<ChatConversationRecord | undefined> {
      return db.query.chatConversation.findFirst({
        where: and(
          eq(schema.chatConversation.id, conversationId),
          eq(schema.chatConversation.userId, userId)
        ),
      });
    },

    async createConversation(
      userId: string,
      title: string
    ): Promise<ChatConversationRecord> {
      const [conversation] = await db
        .insert(schema.chatConversation)
        .values({ userId, title })
        .returning();
      if (!conversation) throw new Error("Unable to create conversation.");
      return conversation;
    },

    async updateConversationTitle(
      userId: string,
      conversationId: string,
      title: string
    ): Promise<ChatConversationRecord | undefined> {
      const [conversation] = await db
        .update(schema.chatConversation)
        .set({ title, updatedAt: new Date() })
        .where(
          and(
            eq(schema.chatConversation.id, conversationId),
            eq(schema.chatConversation.userId, userId)
          )
        )
        .returning();
      return conversation;
    },

    async touchConversation(
      userId: string,
      conversationId: string,
      title?: string
    ): Promise<ChatConversationRecord | undefined> {
      const [conversation] = await db
        .update(schema.chatConversation)
        .set({ ...(title ? { title } : {}), updatedAt: new Date() })
        .where(
          and(
            eq(schema.chatConversation.id, conversationId),
            eq(schema.chatConversation.userId, userId)
          )
        )
        .returning();
      return conversation;
    },

    async deleteConversation(userId: string, conversationId: string): Promise<boolean> {
      const deleted = await db
        .delete(schema.chatConversation)
        .where(
          and(
            eq(schema.chatConversation.id, conversationId),
            eq(schema.chatConversation.userId, userId)
          )
        )
        .returning({ id: schema.chatConversation.id });
      return deleted.length === 1;
    },

    async listMessages(
      userId: string,
      conversationId: string
    ): Promise<ChatMessageRecord[]> {
      return db.query.chatMessage.findMany({
        where: and(
          eq(schema.chatMessage.userId, userId),
          eq(schema.chatMessage.conversationId, conversationId)
        ),
        orderBy: [asc(schema.chatMessage.createdAt)],
        limit: 200,
      });
    },

    async listRecentMessages(
      userId: string,
      conversationId: string,
      limit: number
    ): Promise<ChatMessageRecord[]> {
      const messages = await db.query.chatMessage.findMany({
        where: and(
          eq(schema.chatMessage.userId, userId),
          eq(schema.chatMessage.conversationId, conversationId)
        ),
        orderBy: [desc(schema.chatMessage.createdAt)],
        limit,
      });
      return messages.reverse();
    },

    async createMessage(input: {
      conversationId: string;
      userId: string;
      role: "user" | "assistant";
      content: string;
      citations?: ChatCitation[];
      model?: string;
    }): Promise<ChatMessageRecord> {
      const [message] = await db
        .insert(schema.chatMessage)
        .values({
          conversationId: input.conversationId,
          userId: input.userId,
          role: input.role,
          content: input.content,
          citations: input.citations ? JSON.stringify(input.citations) : null,
          model: input.model,
        })
        .returning();
      if (!message) throw new Error("Unable to save chat message.");
      return message;
    },

    async deleteMessage(userId: string, messageId: string): Promise<void> {
      await db
        .delete(schema.chatMessage)
        .where(
          and(eq(schema.chatMessage.id, messageId), eq(schema.chatMessage.userId, userId))
        );
    },
  };
}

export type ChatRepository = ReturnType<typeof createChatRepository>;
