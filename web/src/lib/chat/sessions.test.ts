import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildChatTitle,
  getChatMessages,
  listChatSessions,
  ORPHANED_CHAT_SESSION_AGE_SECONDS,
  resolveOwnedChatSession,
  saveChatExchange,
  type ChatSessionTarget,
} from "./sessions";
import { ASKER, createChatTestDb, OTHER_ASKER } from "@/test/chat-db";

function d1Statement({
  first,
  all,
  run,
}: {
  first?: unknown;
  all?: unknown[];
  run?: unknown;
} = {}) {
  return {
    bind: vi.fn(() => ({
      first: vi.fn().mockResolvedValue(first ?? null),
      all: vi.fn().mockResolvedValue({ results: all ?? [] }),
      run: vi.fn().mockResolvedValue(run ?? { meta: { changes: 1 } }),
    })),
  };
}

function d1Mock(statements: ReturnType<typeof d1Statement>[]) {
  return {
    prepare: vi.fn(
      ((() => statements.shift() ?? d1Statement()) as unknown) as D1Database["prepare"]
    ),
  } as unknown as D1Database;
}

describe("chat sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds concise titles from the first user message", () => {
    expect(buildChatTitle("  Explain   customer discovery  ")).toBe(
      "Explain customer discovery"
    );
    expect(buildChatTitle("x".repeat(100))).toHaveLength(72);
    expect(buildChatTitle("x".repeat(100))).toMatch(/…$/);
  });

  it("lists owned sessions plus legacy messages without exposing another user", async () => {
    const db = d1Mock([
      d1Statement({
        all: [
          {
            id: "session-1",
            title: "Mentor hours",
            createdAt: 10,
            updatedAt: 20,
            messageCount: 2,
            latestMessage: "Use interviews.",
          },
        ],
      }),
      d1Statement({
        first: {
          messageCount: 2,
          updatedAt: 9,
          latestMessage: "Older answer",
        },
      }),
    ]);

    await expect(listChatSessions(db, "user-1")).resolves.toEqual([
      {
        id: "session-1",
        title: "Mentor hours",
        createdAt: 10,
        updatedAt: 20,
        messageCount: 2,
        latestMessage: "Use interviews.",
      },
      {
        id: "legacy",
        title: "Earlier discussion",
        createdAt: 9,
        updatedAt: 9,
        messageCount: 2,
        latestMessage: "Older answer",
      },
    ]);
  });

  it("loads citations for an owned session and rejects missing sessions", async () => {
    const ownedDb = d1Mock([
      d1Statement({ first: { id: "session-1" } }),
      d1Statement({
        all: [
          {
            id: "message-1",
            role: "assistant",
            content: "See [1].",
            citations: JSON.stringify([{ recordingId: "recording-1" }]),
            createdAt: 12,
          },
        ],
      }),
    ]);

    await expect(getChatMessages(ownedDb, "user-1", "session-1")).resolves.toEqual([
      {
        id: "message-1",
        role: "assistant",
        content: "See [1].",
        citations: [{ recordingId: "recording-1" }],
        createdAt: 12,
      },
    ]);

    const missingDb = d1Mock([d1Statement({ first: null })]);
    await expect(getChatMessages(missingDb, "user-1", "missing")).resolves.toBeNull();
  });
});

describe("chat session persistence", () => {
  const exchange = { question: "How do I run a customer interview?", answer: "Start with their last attempt [1].", citations: [{ sourceNumber: 1 }] };

  it("reuses a session only when it belongs to the user, and writes nothing to decide", async () => {
    const chat = createChatTestDb();
    chat.seedSession("mine", ASKER.id, { messageCount: 2 });
    chat.seedSession("theirs", OTHER_ASKER.id, { messageCount: 2 });

    await expect(resolveOwnedChatSession(chat.db, ASKER.id, "mine", "Question?"))
      .resolves.toEqual({ kind: "existing", id: "mine" });
    for (const requested of ["theirs", "missing", null, undefined]) {
      const target = await resolveOwnedChatSession(chat.db, ASKER.id, requested, "  Explain   pricing  ");
      expect(target).toEqual({ kind: "new", id: expect.any(String), title: "Explain pricing" });
      expect(target.id).not.toBe(requested);
    }
    expect(chat.sessions().map((row) => row.id)).toEqual(["mine", "theirs"]);
  });

  it("saves a new conversation with both messages in one batch", async () => {
    const chat = createChatTestDb();
    const batch = vi.spyOn(chat.db, "batch");
    const target = await resolveOwnedChatSession(chat.db, ASKER.id, null, exchange.question);

    await saveChatExchange(chat.db, ASKER.id, target, exchange);

    expect(batch).toHaveBeenCalledTimes(1);
    expect(chat.sessions()).toEqual([expect.objectContaining({ id: target.id, userId: ASKER.id, title: exchange.question })]);
    expect(chat.messages(target.id)).toEqual([
      { userId: ASKER.id, role: "user", content: exchange.question, citations: null },
      { userId: ASKER.id, role: "assistant", content: exchange.answer, citations: JSON.stringify(exchange.citations) },
    ]);
  });

  it("appends to an existing conversation and moves it to the top of Recent", async () => {
    const chat = createChatTestDb();
    chat.seedSession("older", ASKER.id, { ageSeconds: 3_600, messageCount: 2 });
    chat.seedSession("newer", ASKER.id, { ageSeconds: 60, messageCount: 2 });

    await saveChatExchange(chat.db, ASKER.id, { kind: "existing", id: "older" }, exchange);

    expect(chat.messages("older")).toHaveLength(4);
    expect(chat.messages("newer")).toHaveLength(2);
    expect((await listChatSessions(chat.db, ASKER.id)).map((session) => session.id)).toEqual(["older", "newer"]);
  });

  it("writes nothing when any statement in the exchange fails", async () => {
    const chat = createChatTestDb();
    chat.seedSession("abandoned", ASKER.id, { ageSeconds: ORPHANED_CHAT_SESSION_AGE_SECONDS + 60 });
    chat.seedSession("taken", OTHER_ASKER.id, { messageCount: 2 });
    const before = chat.sessions();
    // The session insert collides on its primary key, after the cleanup ran.
    const collision: ChatSessionTarget = { kind: "new", id: "taken", title: "Collision" };

    await expect(saveChatExchange(chat.db, ASKER.id, collision, exchange)).rejects.toThrow(/UNIQUE/);
    expect(chat.sessions()).toEqual(before);
    expect(chat.messages("taken")).toHaveLength(2);
  });

  it("removes only the user's empty conversations old enough not to be in flight", async () => {
    const chat = createChatTestDb();
    const old = ORPHANED_CHAT_SESSION_AGE_SECONDS + 60;
    chat.seedSession("old-empty", ASKER.id, { ageSeconds: old });
    chat.seedSession("recent-empty", ASKER.id, { ageSeconds: 60 });
    chat.seedSession("old-answered", ASKER.id, { ageSeconds: old, messageCount: 2 });
    chat.seedSession("their-old-empty", OTHER_ASKER.id, { ageSeconds: old });

    const first = await resolveOwnedChatSession(chat.db, ASKER.id, null, exchange.question);
    await saveChatExchange(chat.db, ASKER.id, first, exchange);
    const second = await resolveOwnedChatSession(chat.db, ASKER.id, null, exchange.question);
    await saveChatExchange(chat.db, ASKER.id, second, exchange);

    expect(chat.sessions(ASKER.id).map((row) => row.id).toSorted())
      .toEqual(["old-answered", "recent-empty", first.id, second.id].toSorted());
    expect(chat.sessions(OTHER_ASKER.id).map((row) => row.id)).toEqual(["their-old-empty"]);
  });

  it("leaves empty conversations alone when answering in an existing one", async () => {
    const chat = createChatTestDb();
    chat.seedSession("old-empty", ASKER.id, { ageSeconds: ORPHANED_CHAT_SESSION_AGE_SECONDS + 60 });
    chat.seedSession("answered", ASKER.id, { messageCount: 2 });

    await saveChatExchange(chat.db, ASKER.id, { kind: "existing", id: "answered" }, exchange);

    expect(chat.sessions(ASKER.id).map((row) => row.id)).toEqual(["answered", "old-empty"]);
  });

  it("keeps empty conversations out of Recent", async () => {
    const chat = createChatTestDb();
    chat.seedSession("recent-empty", ASKER.id, { ageSeconds: 60 });
    chat.seedSession("answered", ASKER.id, { ageSeconds: 120, messageCount: 2 });

    expect(await listChatSessions(chat.db, ASKER.id)).toEqual([
      expect.objectContaining({ id: "answered", messageCount: 2, latestMessage: expect.any(String) }),
    ]);
  });
});
