import { describe, expect, it, vi } from "vitest";
import {
  ChatStreamProtocolError,
  consumeChatStream,
  consumeOpenAiStream,
  encodeChatStreamEvent,
} from "@/lib/chat/stream";
import type { ChatStreamEvent } from "@/lib/chat/types";

function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("consumeOpenAiStream", () => {
  it("assembles SSE deltas split across arbitrary chunks", async () => {
    const stream = chunkedStream([
      'data: {"choices":[{"delta":{"content":"Hel',
      'lo "}}]}\n\ndata: {"choices":[{"delta":{"content":"🌍"}}]}\n',
      "\ndata: [DONE]\n\n",
    ]);
    const onDelta = vi.fn();

    await expect(consumeOpenAiStream(stream.getReader(), onDelta)).resolves.toBe(
      "Hello 🌍"
    );
    expect(onDelta.mock.calls.flat()).toEqual(["Hello ", "🌍"]);
  });

  it("fails on malformed upstream data", async () => {
    const stream = chunkedStream(["data: {broken}\n\n"]);
    await expect(consumeOpenAiStream(stream.getReader(), vi.fn())).rejects.toBeInstanceOf(
      ChatStreamProtocolError
    );
  });
});

describe("chat NDJSON protocol", () => {
  it("round-trips events split across chunks", async () => {
    const first: ChatStreamEvent = { type: "delta", content: "Hello" };
    const second: ChatStreamEvent = {
      type: "error",
      error: "Try again",
    };
    const serialized =
      new TextDecoder().decode(encodeChatStreamEvent(first)) +
      new TextDecoder().decode(encodeChatStreamEvent(second));
    const events: ChatStreamEvent[] = [];

    const completed = await consumeChatStream(
      chunkedStream([serialized.slice(0, 9), serialized.slice(9)]),
      (event) => events.push(event)
    );

    expect(events).toEqual([first, second]);
    expect(completed).toBe(false);
  });

  it("rejects malformed API events", async () => {
    await expect(
      consumeChatStream(chunkedStream(["not-json\n"]), vi.fn())
    ).rejects.toBeInstanceOf(ChatStreamProtocolError);
  });
});
