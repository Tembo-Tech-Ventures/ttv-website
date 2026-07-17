import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_MESSAGE_LENGTH,
  createConversationSchema,
  parseCitations,
  parseJsonRequest,
  sendMessageSchema,
  titleFromMessage,
  updateConversationSchema,
} from "@/lib/chat/contracts";

describe("chat request contracts", () => {
  it("trims valid input and rejects blanks, excess length, and unknown fields", () => {
    expect(sendMessageSchema.parse({ message: "  hello  " })).toEqual({
      message: "hello",
    });
    expect(sendMessageSchema.safeParse({ message: "   " }).success).toBe(false);
    expect(
      sendMessageSchema.safeParse({ message: "x".repeat(MAX_CHAT_MESSAGE_LENGTH + 1) })
        .success
    ).toBe(false);
    expect(
      sendMessageSchema.safeParse({ message: "hello", conversationHistory: [] }).success
    ).toBe(false);
    expect(createConversationSchema.parse({})).toEqual({});
    expect(updateConversationSchema.safeParse({ title: " " }).success).toBe(false);
  });

  it("returns explicit media-type and malformed-JSON responses", async () => {
    const wrongType = await parseJsonRequest(
      new Request("https://example.test", { method: "POST", body: "{}" })
    );
    expect(wrongType).toBeInstanceOf(Response);
    expect((wrongType as Response).status).toBe(415);

    const malformed = await parseJsonRequest(
      new Request("https://example.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      })
    );
    expect((malformed as Response).status).toBe(400);
  });
});

describe("chat persistence helpers", () => {
  it("creates concise deterministic titles", () => {
    expect(titleFromMessage("  How   does D1 work?  ")).toBe("How does D1 work?");
    const title = titleFromMessage("x".repeat(120));
    expect(title).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
  });

  it("accepts only valid stored citation JSON", () => {
    const citation = {
      recordingId: "recording-1",
      title: "Session",
      startTime: 1,
      endTime: 2,
      text: "Excerpt",
    };
    expect(parseCitations(JSON.stringify([citation]))).toEqual([citation]);
    expect(parseCitations("not-json")).toEqual([]);
    expect(parseCitations(JSON.stringify([{ ...citation, startTime: -1 }]))).toEqual([]);
  });
});
