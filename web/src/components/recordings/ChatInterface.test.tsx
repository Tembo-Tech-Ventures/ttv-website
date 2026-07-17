// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInterface } from "@/components/recordings/ChatInterface";
import { encodeChatStreamEvent } from "@/lib/chat/stream";
import type {
  ChatConversationView,
  ChatMessageView,
  ChatStreamEvent,
} from "@/lib/chat/types";

const now = "2026-07-17T09:00:00.000Z";
const conversation: ChatConversationView = {
  id: "conversation-1",
  title: "New conversation",
  createdAt: now,
  updatedAt: now,
};
const userMessage: ChatMessageView = {
  id: "user-1",
  role: "user",
  content: "Teach me D1",
  citations: [],
  createdAt: now,
};
const assistantMessage: ChatMessageView = {
  id: "assistant-1",
  role: "assistant",
  content: "**Hello learner**",
  citations: [],
  createdAt: now,
};

function streamResponse(events: ChatStreamEvent[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(encodeChatStreamEvent(event));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } }
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
    "00000000-0000-4000-8000-000000000000"
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ChatInterface", () => {
  it("restores a durable conversation and safely renders markdown with citations", async () => {
    const citation = {
      recordingId: "recording-1",
      title: "Cloudflare session",
      startTime: 65,
      endTime: 70,
      text: "D1 is a distributed SQL database.",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          conversations: [{ ...conversation, title: "Learning D1" }],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          conversation: { ...conversation, title: "Learning D1" },
          messages: [userMessage, { ...assistantMessage, citations: [citation] }],
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatInterface />);

    expect(await screen.findByText("Hello learner", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText("Learning D1")).toBeTruthy();
    expect(screen.getByText("1 session source")).toBeTruthy();
    expect(screen.getByRole("link", { name: "1:05" }).getAttribute("href")).toBe(
      "/dashboard/sessions/recording-1?t=65"
    );
  });

  it("creates a conversation, streams markdown, and never sends client-owned history", async () => {
    const titledConversation = {
      ...conversation,
      title: "Teach me D1",
      updatedAt: "2026-07-17T09:01:00.000Z",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ conversations: [] }))
      .mockResolvedValueOnce(Response.json({ conversation }, { status: 201 }))
      .mockResolvedValueOnce(
        streamResponse([
          {
            type: "metadata",
            conversation: titledConversation,
            userMessage,
            citations: [],
            retrievalStatus: "general",
          },
          { type: "delta", content: "**Hello " },
          { type: "delta", content: "learner**" },
          { type: "done", message: assistantMessage },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ChatInterface />);

    const composer = await screen.findByLabelText("Message the TTV Learning Coach");
    await user.type(composer, "Teach me D1");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Hello learner", { selector: "strong" })).toBeTruthy();
    expect(screen.getByLabelText("You: Teach me D1")).toBeTruthy();
    const messageRequest = fetchMock.mock.calls[2];
    expect(messageRequest?.[0]).toBe("/api/chat/conversations/conversation-1/messages");
    const requestBody = messageRequest?.[1]?.body;
    if (typeof requestBody !== "string") throw new Error("Expected a JSON request body.");
    const parsedBody: unknown = JSON.parse(requestBody);
    expect(parsedBody).toEqual({
      message: "Teach me D1",
    });
  });

  it("surfaces a rate limit and retries the failed optimistic message", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ conversations: [] }))
      .mockResolvedValueOnce(Response.json({ conversation }, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json({ error: "You are sending messages too quickly." }, { status: 429 })
      )
      .mockResolvedValueOnce(
        streamResponse([
          {
            type: "metadata",
            conversation: { ...conversation, title: "Teach me D1" },
            userMessage,
            citations: [],
            retrievalStatus: "general",
          },
          { type: "delta", content: "Recovered" },
          {
            type: "done",
            message: { ...assistantMessage, content: "Recovered" },
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ChatInterface />);

    await user.type(
      await screen.findByLabelText("Message the TTV Learning Coach"),
      "Teach me D1"
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "You are sending messages too quickly."
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Recovered")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("fails safely when the chat API returns a malformed payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ conversations: [{ id: "missing-required-fields" }] })
        )
    );

    render(<ChatInterface />);

    expect((await screen.findByRole("alert")).textContent).toContain("invalid response");
  });

  it("aborts an in-flight response from the stop control", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ conversations: [] }))
      .mockResolvedValueOnce(Response.json({ conversation }, { status: 201 }))
      .mockImplementationOnce((_url, init) => {
        requestSignal = init?.signal ?? undefined;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            requestSignal?.addEventListener("abort", () => {
              controller.error(new DOMException("Aborted", "AbortError"));
            });
          },
        });
        return Promise.resolve(new Response(body));
      });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ChatInterface />);

    await user.type(
      await screen.findByLabelText("Message the TTV Learning Coach"),
      "Teach me D1"
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await user.click(await screen.findByRole("button", { name: "Stop response" }));

    await waitFor(() => {
      expect(requestSignal?.aborted).toBe(true);
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Response stopped");
  });
});
