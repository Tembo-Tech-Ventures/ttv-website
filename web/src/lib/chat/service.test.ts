import { describe, expect, it, vi } from "vitest";
import {
  ChatRequestError,
  chatServiceErrorResponse,
  createSendMessageResponse,
  type SendMessageDependencies,
} from "@/lib/chat/service";
import { consumeChatStream } from "@/lib/chat/stream";
import type { ChatStreamEvent } from "@/lib/chat/types";
import type { ChatConversationRecord, ChatMessageRecord } from "@/lib/chat/repository";

const now = new Date("2026-07-17T09:00:00.000Z");

function conversation(
  overrides: Partial<ChatConversationRecord> = {}
): ChatConversationRecord {
  return {
    id: "conversation-1",
    userId: "user-1",
    title: "New conversation",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function message(
  role: "user" | "assistant",
  content: string,
  overrides: Partial<ChatMessageRecord> = {}
): ChatMessageRecord {
  return {
    id: `${role}-message`,
    conversationId: "conversation-1",
    userId: "user-1",
    role,
    content,
    citations: null,
    model: null,
    createdAt: now,
    ...overrides,
  };
}

function openAiReader(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }).getReader();
}

function makeDependencies(
  overrides: Partial<SendMessageDependencies> = {}
): SendMessageDependencies {
  const repository: SendMessageDependencies["repository"] = {
    findConversation: vi.fn().mockResolvedValue(conversation()),
    listRecentMessages: vi
      .fn()
      .mockResolvedValue([
        message("user", "Earlier question"),
        message("assistant", "Earlier answer"),
      ]),
    createMessage: vi
      .fn<SendMessageDependencies["repository"]["createMessage"]>()
      .mockImplementation((input) =>
        Promise.resolve(
          message(input.role, input.content, {
            id: `${input.role}-saved`,
            citations: input.citations ? JSON.stringify(input.citations) : null,
            model: input.model ?? null,
          })
        )
      ),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    touchConversation: vi
      .fn<SendMessageDependencies["repository"]["touchConversation"]>()
      .mockImplementation((_userId, _conversationId, title) =>
        Promise.resolve(conversation({ title: title ?? "New conversation" }))
      ),
  };

  return {
    repository,
    checkRateLimit: vi.fn().mockResolvedValue(true),
    retrieve: vi.fn().mockResolvedValue({
      status: "grounded",
      sources: [
        {
          citation: {
            recordingId: "recording-1",
            title: "D1 session",
            startTime: 10,
            endTime: 20,
            text: "D1 excerpt",
          },
          content: "D1 is a distributed database.",
        },
      ],
    }),
    openCompletion: vi.fn().mockResolvedValue({
      model: "workers-ai/@cf/google/gemma-4-test",
      reader: openAiReader([
        'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"learner"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    }),
    ...overrides,
  };
}

async function readEvents(response: Response): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  if (!response.body) throw new Error("Missing response body in test.");
  await consumeChatStream(response.body, (event) => events.push(event));
  return events;
}

describe("createSendMessageResponse", () => {
  it("streams a grounded answer and persists an owned server-context conversation", async () => {
    const dependencies = makeDependencies();

    const response = await createSendMessageResponse(
      {
        userId: "user-1",
        conversationId: "conversation-1",
        message: "How does D1 work?",
      },
      dependencies
    );
    const events = await readEvents(response);

    expect(response.headers.get("content-type")).toBe(
      "application/x-ndjson; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(events.map((event) => event.type)).toEqual([
      "metadata",
      "delta",
      "delta",
      "done",
    ]);
    expect(events[0]).toMatchObject({
      type: "metadata",
      retrievalStatus: "grounded",
      conversation: { title: "How does D1 work?" },
    });
    expect(events.at(-1)).toMatchObject({
      type: "done",
      message: { content: "Hello learner" },
    });

    expect(dependencies.repository.listRecentMessages).toHaveBeenCalledWith(
      "user-1",
      "conversation-1",
      12
    );
    const completionMessages = vi.mocked(dependencies.openCompletion).mock.calls[0]?.[0];
    expect(completionMessages?.at(-1)).toEqual({
      role: "user",
      content: "How does D1 work?",
    });
    expect(completionMessages?.[0]?.content).toContain("D1 is a distributed database");
    expect(dependencies.repository.createMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: "user", content: "How does D1 work?" })
    );
    expect(dependencies.repository.createMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        role: "assistant",
        content: "Hello learner",
        model: "workers-ai/@cf/google/gemma-4-test",
      })
    );
    expect(dependencies.repository.deleteMessage).not.toHaveBeenCalled();
  });

  it("rejects rate-limited and cross-user conversation requests before inference", async () => {
    const limited = makeDependencies({
      checkRateLimit: vi.fn().mockResolvedValue(false),
    });
    await expect(
      createSendMessageResponse(
        { userId: "user-1", conversationId: "conversation-1", message: "Hi" },
        limited
      )
    ).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    expect(limited.repository.findConversation).not.toHaveBeenCalled();

    const missing = makeDependencies();
    vi.mocked(missing.repository.findConversation).mockResolvedValue(undefined);
    await expect(
      createSendMessageResponse(
        { userId: "other-user", conversationId: "conversation-1", message: "Hi" },
        missing
      )
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(missing.openCompletion).not.toHaveBeenCalled();
  });

  it("degrades safely to general chat when transcript retrieval is unavailable", async () => {
    const dependencies = makeDependencies({
      retrieve: vi.fn().mockRejectedValue(new Error("Vectorize unavailable")),
    });
    const response = await createSendMessageResponse(
      { userId: "user-1", conversationId: "conversation-1", message: "Teach me" },
      dependencies
    );
    const events = await readEvents(response);

    expect(events[0]).toMatchObject({
      type: "metadata",
      retrievalStatus: "unavailable",
      citations: [],
    });
    const system = vi.mocked(dependencies.openCompletion).mock.calls[0]?.[0][0];
    expect(system?.content).toContain("answer from general knowledge");
  });

  it("removes the pending user message and emits a retryable error on stream failure", async () => {
    const dependencies = makeDependencies({
      openCompletion: vi.fn().mockResolvedValue({
        model: "workers-ai/@cf/google/gemma-4-test",
        reader: openAiReader(["data: {malformed}\n\n"]),
      }),
    });
    const response = await createSendMessageResponse(
      { userId: "user-1", conversationId: "conversation-1", message: "Hello" },
      dependencies
    );
    const events = await readEvents(response);

    expect(events.map((event) => event.type)).toEqual(["metadata", "error"]);
    expect(dependencies.repository.deleteMessage).toHaveBeenCalledWith(
      "user-1",
      "user-saved"
    );
    expect(dependencies.repository.createMessage).toHaveBeenCalledTimes(1);
    expect(dependencies.repository.touchConversation).not.toHaveBeenCalled();
  });

  it("cancels upstream work and removes the pending user message", async () => {
    const upstreamCancelled = vi.fn();
    const neverEnding = new ReadableStream<Uint8Array>({
      cancel: upstreamCancelled,
    });
    const dependencies = makeDependencies({
      openCompletion: vi.fn().mockResolvedValue({
        model: "workers-ai/@cf/google/gemma-4-test",
        reader: neverEnding.getReader(),
      }),
    });
    const response = await createSendMessageResponse(
      { userId: "user-1", conversationId: "conversation-1", message: "Stop me" },
      dependencies
    );
    if (!response.body) throw new Error("Missing response body in test.");
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();

    expect(upstreamCancelled).toHaveBeenCalledOnce();
    expect(dependencies.repository.deleteMessage).toHaveBeenCalledWith(
      "user-1",
      "user-saved"
    );
  });
});

describe("chatServiceErrorResponse", () => {
  it("maps known request failures without exposing internals", async () => {
    const response = chatServiceErrorResponse(
      new ChatRequestError("Conversation not found.", 404, "not_found")
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Conversation not found.",
      code: "not_found",
    });
  });

  it("uses a generic response for unknown failures", async () => {
    const response = chatServiceErrorResponse(new Error("database secret"));
    expect(response.status).toBe(500);
    await expect(response.text()).resolves.not.toContain("database secret");
  });
});
