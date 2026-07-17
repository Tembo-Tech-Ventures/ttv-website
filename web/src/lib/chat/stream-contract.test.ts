import { describe, expect, it, vi } from "vitest";
import {
  ChatStreamProtocolError,
  consumeChatStream,
  encodeChatStreamEvent,
} from "@/lib/chat/stream";
import type { ChatStreamEvent } from "@/lib/chat/types";

function textStream(content: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(content));
      controller.close();
    },
  });
}

describe("validated chat stream contract", () => {
  it("rejects valid JSON with an invalid event shape", async () => {
    await expect(
      consumeChatStream(textStream('{"type":"delta","content":42}\n'), vi.fn())
    ).rejects.toBeInstanceOf(ChatStreamProtocolError);
  });

  it("reports a terminal done event", async () => {
    const done: ChatStreamEvent = {
      type: "done",
      message: {
        id: "assistant-1",
        role: "assistant",
        content: "Complete",
        citations: [],
        createdAt: "2026-07-17T09:00:00.000Z",
      },
    };

    await expect(
      consumeChatStream(
        textStream(new TextDecoder().decode(encodeChatStreamEvent(done))),
        vi.fn()
      )
    ).resolves.toBe(true);
  });

  it("does not mislabel event-handler failures as protocol failures", async () => {
    const applicationError = new Error("Rate limited");

    await expect(
      consumeChatStream(textStream('{"type":"error","error":"Retry"}\n'), () => {
        throw applicationError;
      })
    ).rejects.toBe(applicationError);
  });
});
