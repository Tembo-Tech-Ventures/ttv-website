import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildChatTitle,
  ensureOwnedChatSession,
  getChatMessages,
  listChatSessions,
} from "./sessions";

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

  it("reuses a session only when it belongs to the user", async () => {
    const db = d1Mock([d1Statement({ first: { id: "session-1" } })]);

    await expect(
      ensureOwnedChatSession(db, "user-1", "session-1", "Question?")
    ).resolves.toBe("session-1");
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
