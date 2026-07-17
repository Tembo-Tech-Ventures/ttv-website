import { describe, expect, it, vi } from "vitest";
import {
  AGENT_SESSION_PREFIX,
  createAgentSession,
  isAgentAuthEnabled,
  isAgentSession,
  isSameOriginRequest,
  listAgentSessions,
  normalizeAgentSessionLabel,
  parseAgentSessionDuration,
  revokeAgentSession,
} from "./agent-auth";

function mockDatabase({
  results = [],
  changes = 1,
}: { results?: unknown[]; changes?: number } = {}) {
  const run = vi.fn().mockResolvedValue({ meta: { changes } });
  const all = vi.fn().mockResolvedValue({ results });
  const bind = vi.fn((..._values: unknown[]) => ({ run, all }));
  const prepare = vi.fn((_sql: string) => ({ bind }));
  return {
    db: { prepare } as unknown as D1Database,
    prepare,
    bind,
    run,
    all,
  };
}

describe("agent auth policy", () => {
  it("enables bearer auth only for the exact explicit flag", () => {
    expect(isAgentAuthEnabled("true")).toBe(true);
    expect(isAgentAuthEnabled("TRUE")).toBe(false);
    expect(isAgentAuthEnabled(undefined)).toBe(false);
  });

  it("identifies agent-issued sessions so they cannot mint credentials", () => {
    expect(isAgentSession(`${AGENT_SESSION_PREFIX}SAM reviewer`)).toBe(true);
    expect(isAgentSession("Mozilla/5.0")).toBe(false);
    expect(isAgentSession(null)).toBe(false);
  });

  it("validates labels and supported durations", () => {
    expect(normalizeAgentSessionLabel("  SAM   staging-1 ")).toBe("SAM staging-1");
    expect(() => normalizeAgentSessionLabel("bad/label")).toThrow("may contain");
    expect(parseAgentSessionDuration("8")).toBe(8);
    expect(() => parseAgentSessionDuration("12")).toThrow("supported");
  });

  it("requires a matching browser origin for mutations", () => {
    expect(
      isSameOriginRequest(
        new Request("https://staging.example.com/admin/agent-access", {
          method: "POST",
          headers: { origin: "https://staging.example.com" },
        })
      )
    ).toBe(true);
    expect(
      isSameOriginRequest(
        new Request("https://staging.example.com/admin/agent-access", {
          method: "POST",
          headers: { origin: "https://evil.example" },
        })
      )
    ).toBe(false);
  });
});

describe("agent sessions", () => {
  it("creates a scoped, expiring session without logging or returning SQL internals", async () => {
    const database = mockDatabase();
    const cryptoImpl = {
      randomUUID: () => "00000000-0000-4000-8000-000000000000",
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint8Array) array.fill(10);
        return array;
      },
    } as Pick<Crypto, "getRandomValues" | "randomUUID">;

    const created = await createAgentSession({
      db: database.db,
      userId: "admin-id",
      label: "SAM reviewer",
      durationHours: 8,
      now: new Date("2026-07-14T10:00:00.000Z"),
      cryptoImpl,
    });

    expect(created).toEqual({
      id: "00000000-0000-4000-8000-000000000000",
      label: "SAM reviewer",
      token: "0a".repeat(32),
      createdAt: new Date("2026-07-14T10:00:00.000Z"),
      expiresAt: new Date("2026-07-14T18:00:00.000Z"),
    });
    expect(database.bind).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000000",
      1784052000,
      "0a".repeat(32),
      `${AGENT_SESSION_PREFIX}SAM reviewer`,
      "admin-id",
      1784023200,
      1784023200
    );
  });

  it("lists metadata without selecting bearer tokens", async () => {
    const database = mockDatabase({
      results: [
        {
          id: "session-id",
          expiresAt: 1784052000,
          userAgent: `${AGENT_SESSION_PREFIX}SAM reviewer`,
          createdAt: 1784023200,
        },
      ],
    });

    await expect(listAgentSessions(database.db, "admin-id")).resolves.toEqual([
      {
        id: "session-id",
        label: "SAM reviewer",
        createdAt: new Date("2026-07-14T10:00:00.000Z"),
        expiresAt: new Date("2026-07-14T18:00:00.000Z"),
      },
    ]);
    expect(database.prepare.mock.calls[0]?.[0]).not.toContain('"token"');
  });

  it("revokes only the current user's marked agent session", async () => {
    const database = mockDatabase();
    await expect(revokeAgentSession(database.db, "admin-id", "session-id")).resolves.toBe(
      true
    );
    expect(database.bind).toHaveBeenCalledWith(
      "session-id",
      "admin-id",
      `${AGENT_SESSION_PREFIX}%`
    );
  });
});
