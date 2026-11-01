import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASKER, createChatTestDb, OTHER_ASKER } from "@/test/chat-db";

// The real session store against real SQL: only the model and cohort access are stubbed.
const mocks = vi.hoisted(() => ({
  env: { DB: {} as D1Database },
  generateToolCompletion: vi.fn(),
  executeTool: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("drizzle-orm/d1", () => ({ drizzle: () => ({}) }));
vi.mock("@/lib/recordings/access", () => ({ getAccessibleProgramIds: async () => [] }));
vi.mock("@/lib/ai/gateway", () => ({ generateToolCompletion: mocks.generateToolCompletion }));
vi.mock("@/lib/chat/tools", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeTool: mocks.executeTool,
}));

import { POST } from "@/pages/api/chat";

type Chat = ReturnType<typeof createChatTestDb>;
let chat: Chat;

function ask(
  body: { message: string; sessionId?: string | null },
  { user = ASKER as { id: string; name: string } | null, origin = "https://example.com" } = {}
) {
  const request = new Request("https://example.com/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
  return POST({ request, locals: { user } } as unknown as Parameters<typeof POST>[0]);
}

function answer(content: string) {
  return { content, toolCalls: [], finishReason: "stop" };
}

beforeEach(() => {
  vi.clearAllMocks();
  chat = createChatTestDb();
  mocks.env.DB = chat.db;
  mocks.generateToolCompletion.mockResolvedValue(answer("Start from the last time they tried."));
});

describe("POST /api/chat persistence", () => {
  it("saves a new conversation with its question and answer, then continues it", async () => {
    const first = await ask({ message: "How do I run a customer interview?", sessionId: null });
    const { sessionId } = (await first.json()) as { sessionId: string };

    expect(first.status).toBe(200);
    expect(chat.sessions()).toEqual([
      expect.objectContaining({ id: sessionId, userId: ASKER.id, title: "How do I run a customer interview?" }),
    ]);
    expect(chat.messages(sessionId).map((row) => [row.role, row.content])).toEqual([
      ["user", "How do I run a customer interview?"],
      ["assistant", "Start from the last time they tried."],
    ]);

    const next = await ask({ message: "And how many people?", sessionId });
    expect(((await next.json()) as { sessionId: string }).sessionId).toBe(sessionId);
    expect(chat.sessions()).toHaveLength(1);
    expect(chat.messages(sessionId)).toHaveLength(4);
  });

  it.each([
    ["the model fails", () => mocks.generateToolCompletion.mockRejectedValue(new Error("provider down"))],
    ["a tool fails", () => {
      mocks.generateToolCompletion.mockResolvedValue({
        content: null,
        toolCalls: [{ id: "call-1", type: "function", function: { name: "get_user_context", arguments: "{}" } }],
        finishReason: "tool_calls",
      });
      mocks.executeTool.mockRejectedValue(new Error("tool down"));
    }],
  ])("leaves no conversation behind when %s on a new chat", async (_, fail) => {
    fail();

    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await ask({ message: "Try again", sessionId: null })).status).toBe(500);
    }

    expect(chat.sessions()).toEqual([]);
    expect(chat.database.prepare(`SELECT COUNT(*) AS n FROM "chat_message"`).get()).toEqual({ n: 0 });
  });

  it("leaves an existing conversation exactly as it was when a request in it fails", async () => {
    chat.seedSession("existing", ASKER.id, { ageSeconds: 3_600, messageCount: 2 });
    const before = { sessions: chat.sessions(), messages: chat.messages("existing") };
    mocks.generateToolCompletion.mockRejectedValue(new Error("provider down"));

    expect((await ask({ message: "One more question", sessionId: "existing" })).status).toBe(500);

    expect(chat.sessions()).toEqual(before.sessions);
    expect(chat.messages("existing")).toEqual(before.messages);
  });

  it("gives concurrent first questions their own conversations and drops the failed one", async () => {
    // Hold every answer until all three requests have resolved their conversation,
    // then release them in reverse order, so their writes interleave.
    const pending: Array<{ message: string; release: () => void }> = [];
    mocks.generateToolCompletion.mockImplementation((_env, messages: Array<{ content: string }>) => {
      const message = messages.at(-1)!.content;
      return new Promise((resolve, reject) => {
        pending.push({
          message,
          release: () => (message === "fails" ? reject(new Error("provider down")) : resolve(answer(`Re: ${message}`))),
        });
      });
    });

    const requests = ["first", "fails", "second"].map((message) => ask({ message, sessionId: null }));
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    for (const request of pending.toReversed()) request.release();
    const responses = await Promise.all(requests);

    expect(responses.map((response) => response.status)).toEqual([200, 500, 200]);
    const sessions = chat.sessions(ASKER.id);
    expect(sessions.map((row) => row.title).toSorted()).toEqual(["first", "second"]);
    for (const session of sessions) {
      expect(chat.messages(String(session.id)).map((row) => row.content)).toEqual([session.title, `Re: ${session.title}`]);
    }
  });

  it("appends concurrent questions in one existing conversation without creating another", async () => {
    chat.seedSession("existing", ASKER.id, { messageCount: 2 });

    const responses = await Promise.all(
      ["one", "two"].map((message) => ask({ message, sessionId: "existing" }))
    );

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(chat.sessions().map((row) => row.id)).toEqual(["existing"]);
    expect(chat.messages("existing")).toHaveLength(6);
  });

  describe("authorization is unchanged", () => {
    it("never writes into another user's conversation; it starts the asker a new one", async () => {
      chat.seedSession("theirs", OTHER_ASKER.id, { messageCount: 2 });
      const theirs = { sessions: chat.sessions(OTHER_ASKER.id), messages: chat.messages("theirs") };

      const response = await ask({ message: "Whose is this?", sessionId: "theirs" });
      const { sessionId } = (await response.json()) as { sessionId: string };

      expect(response.status).toBe(200);
      expect(sessionId).not.toBe("theirs");
      expect(chat.sessions(ASKER.id).map((row) => row.id)).toEqual([sessionId]);
      expect(chat.sessions(OTHER_ASKER.id)).toEqual(theirs.sessions);
      expect(chat.messages("theirs")).toEqual(theirs.messages);
    });

    it.each([
      ["signed out", { user: null }, 401],
      ["cross-origin", { origin: "https://other.example" }, 403],
    ] as const)("rejects a %s request before resolving or writing anything", async (_, options, status) => {
      chat.seedSession("existing", ASKER.id, { messageCount: 2 });
      const before = chat.sessions();

      for (const sessionId of [null, "existing"]) {
        expect((await ask({ message: "Hello", sessionId }, options)).status).toBe(status);
      }

      expect(mocks.generateToolCompletion).not.toHaveBeenCalled();
      expect(chat.sessions()).toEqual(before);
      expect(chat.messages("existing")).toHaveLength(2);
    });
  });
});
