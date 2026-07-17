import { describe, expect, it } from "vitest";
import {
  chatStreamEventSchema,
  conversationDetailPayloadSchema,
} from "@/lib/chat/client-contracts";

const now = "2026-07-17T09:00:00.000Z";

describe("chat client contracts", () => {
  it("accepts a complete conversation payload", () => {
    expect(
      conversationDetailPayloadSchema.safeParse({
        conversation: {
          id: "conversation-1",
          title: "Learning D1",
          createdAt: now,
          updatedAt: now,
        },
        messages: [
          {
            id: "message-1",
            role: "assistant",
            content: "Hello",
            citations: [],
            createdAt: now,
          },
        ],
      }).success
    ).toBe(true);
  });

  it.each([
    { type: "delta", content: 42 },
    { type: "done", message: { role: "assistant" } },
    { type: "metadata", retrievalStatus: "secret" },
    { type: "unknown", content: "hello" },
  ])("rejects malformed stream events", (event) => {
    expect(chatStreamEventSchema.safeParse(event).success).toBe(false);
  });

  it("rejects invalid timestamps and message roles", () => {
    expect(
      conversationDetailPayloadSchema.safeParse({
        conversation: {
          id: "conversation-1",
          title: "Invalid",
          createdAt: "yesterday",
          updatedAt: now,
        },
        messages: [
          {
            id: "message-1",
            role: "system",
            content: "unsafe",
            citations: [],
            createdAt: now,
          },
        ],
      }).success
    ).toBe(false);
  });
});
