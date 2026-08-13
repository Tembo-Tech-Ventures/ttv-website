import { describe, expect, it, vi } from "vitest";
import {
  PERSONAL_ACCESS_TOKEN_PREFIX,
  authenticatePersonalAccessToken,
  createPersonalAccessToken,
  enforcePersonalAccessTokenMutationScope,
  extractPersonalAccessToken,
  hasPersonalAccessTokenAuthorization,
  hashPersonalAccessToken,
  listPersonalAccessTokens,
  normalizePersonalAccessTokenLabel,
  parsePersonalAccessTokenDuration,
  parsePersonalAccessTokenScopes,
  personalAccessTokenCanWrite,
  revokePersonalAccessToken,
} from "./personal-access-tokens";

interface MockDatabaseOptions {
  firstResults?: unknown[];
  allResults?: unknown[][];
  changes?: number;
}

function mockDatabase({
  firstResults = [],
  allResults = [],
  changes = 1,
}: MockDatabaseOptions = {}) {
  const firstQueue = [...firstResults];
  const allQueue = [...allResults];
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...values: unknown[]) => {
      calls.push({ sql, values });
      return {
        first: vi.fn(async () => firstQueue.shift() ?? null),
        all: vi.fn(async () => ({ results: allQueue.shift() ?? [] })),
        run: vi.fn(async () => ({ meta: { changes } })),
      };
    }),
  }));
  return { db: { prepare } as unknown as D1Database, prepare, calls };
}

const now = new Date("2026-08-13T12:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1_000);

function deterministicCrypto(fill = 10) {
  return {
    randomUUID: () => "00000000-0000-4000-8000-000000000000",
    getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array) array.fill(fill);
      return array;
    },
    subtle: globalThis.crypto.subtle,
  } as Pick<Crypto, "getRandomValues" | "randomUUID" | "subtle">;
}

describe("personal access token input policy", () => {
  it("normalizes labels, durations, and fine-grained access", () => {
    expect(normalizePersonalAccessTokenLabel("  SAM   production  ")).toBe(
      "SAM production"
    );
    expect(parsePersonalAccessTokenDuration("8")).toBe(8);
    expect(parsePersonalAccessTokenScopes("read")).toEqual(["admin:read"]);
    expect(parsePersonalAccessTokenScopes("write")).toEqual([
      "admin:read",
      "admin:write",
    ]);
  });

  it("rejects unsafe labels, unbounded expiry, and unknown access", () => {
    expect(() => normalizePersonalAccessTokenLabel("bad/token")).toThrow(
      "may contain"
    );
    expect(() => parsePersonalAccessTokenDuration("87600")).toThrow(
      "supported token duration"
    );
    expect(() => parsePersonalAccessTokenScopes("owner")).toThrow(
      "read-only or read/write"
    );
  });
});

describe("personal access token lifecycle", () => {
  it("stores only a token hash and returns the raw token once", async () => {
    const database = mockDatabase({ firstResults: [{ count: 0 }] });
    const cryptoImpl = deterministicCrypto();
    const expectedToken = `${PERSONAL_ACCESS_TOKEN_PREFIX}${"0a".repeat(32)}`;
    const expectedHash = await hashPersonalAccessToken(expectedToken);

    const created = await createPersonalAccessToken({
      db: database.db,
      userId: "admin-id",
      label: "SAM production",
      durationHours: 8,
      scopes: ["admin:read", "admin:write"],
      now,
      cryptoImpl,
    });

    expect(created).toMatchObject({
      id: "00000000-0000-4000-8000-000000000000",
      token: expectedToken,
      tokenPrefix: "ttv_pat_0a0a0a0a…",
      label: "SAM production",
      scopes: ["admin:read", "admin:write"],
      expiresAt: new Date("2026-08-13T20:00:00.000Z"),
    });
    const insert = database.calls.find(({ sql }) =>
      sql.includes('INSERT INTO "personal_access_token"')
    );
    expect(insert?.values).toContain(expectedHash);
    expect(insert?.values).not.toContain(expectedToken);
  });

  it("caps active tokens per user", async () => {
    const database = mockDatabase({ firstResults: [{ count: 10 }] });

    await expect(
      createPersonalAccessToken({
        db: database.db,
        userId: "admin-id",
        label: "One too many",
        durationHours: 8,
        scopes: ["admin:read"],
        now,
      })
    ).rejects.toThrow("Revoke an existing token");
    expect(database.prepare).toHaveBeenCalledOnce();
  });

  it("lists metadata without selecting hashes and revokes only its owner token", async () => {
    const database = mockDatabase({
      allResults: [
        [
          {
            id: "pat-id",
            tokenPrefix: "ttv_pat_12345678…",
            label: "Read-only audit",
            scopes: '["admin:read"]',
            expiresAt: nowSeconds + 3_600,
            lastUsedAt: null,
            revokedAt: null,
            createdAt: nowSeconds,
          },
        ],
      ],
    });

    await expect(
      listPersonalAccessTokens(database.db, "admin-id")
    ).resolves.toEqual([
      {
        id: "pat-id",
        tokenPrefix: "ttv_pat_12345678…",
        label: "Read-only audit",
        scopes: ["admin:read"],
        expiresAt: new Date((nowSeconds + 3_600) * 1_000),
        lastUsedAt: null,
        revokedAt: null,
        createdAt: now,
      },
    ]);
    expect(database.calls[0].sql).not.toContain("tokenHash");

    await expect(
      revokePersonalAccessToken(database.db, "admin-id", "pat-id", now)
    ).resolves.toBe(true);
    expect(database.calls[1].values).toEqual([
      nowSeconds,
      nowSeconds,
      "pat-id",
      "admin-id",
    ]);
  });
});

describe("personal access token authentication", () => {
  it("ignores cookies, malformed bearer values, and non-PAT bearer sessions", () => {
    expect(
      extractPersonalAccessToken(
        new Request("https://example.com/admin", {
          headers: { cookie: "session=value" },
        })
      )
    ).toBeNull();
    expect(
      hasPersonalAccessTokenAuthorization(
        new Request("https://example.com/admin", {
          headers: { authorization: "Bearer ttv_pat_malformed" },
        })
      )
    ).toBe(true);
    expect(
      extractPersonalAccessToken(
        new Request("https://example.com/admin", {
          headers: { authorization: "Bearer existing-better-auth-session" },
        })
      )
    ).toBeNull();
    expect(
      extractPersonalAccessToken(
        new Request("https://example.com/admin", {
          headers: { authorization: "Basic dXNlcjpwYXNz" },
        })
      )
    ).toBeNull();
  });

  it("authenticates an unexpired hash match without retaining the raw secret", async () => {
    const rawToken = `${PERSONAL_ACCESS_TOKEN_PREFIX}${"0b".repeat(32)}`;
    const database = mockDatabase({
      firstResults: [
        {
          id: "pat-id",
          tokenPrefix: "ttv_pat_0b0b0b0b…",
          label: "SAM verifier",
          scopes: '["admin:read","admin:write"]',
          expiresAt: nowSeconds + 3_600,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: nowSeconds - 60,
          userId: "admin-id",
          userName: "Admin",
          userEmail: "admin@example.com",
          userEmailVerified: 1,
          userImage: null,
          userCreatedAt: nowSeconds - 600,
          userUpdatedAt: nowSeconds - 300,
        },
      ],
    });
    const request = new Request("https://example.com/admin", {
      headers: { authorization: `Bearer ${rawToken}` },
    });

    const authenticated = await authenticatePersonalAccessToken(
      database.db,
      request,
      now
    );

    expect(authenticated).toMatchObject({
      token: {
        id: "pat-id",
        scopes: ["admin:read", "admin:write"],
      },
      session: {
        id: "pat:pat-id",
        token: "[personal-access-token]",
        userId: "admin-id",
      },
      user: {
        id: "admin-id",
        emailVerified: true,
      },
    });
    expect(JSON.stringify(authenticated)).not.toContain(rawToken);
    expect(database.calls[0].values).toEqual([
      await hashPersonalAccessToken(rawToken),
      nowSeconds,
    ]);
    expect(database.calls[1].sql).toContain('SET "lastUsedAt" = ?');
  });

  it("fails closed for a missing, expired, revoked, or malformed-scope row", async () => {
    const token = `${PERSONAL_ACCESS_TOKEN_PREFIX}${"0c".repeat(32)}`;
    const request = new Request("https://example.com/admin", {
      headers: { authorization: `Bearer ${token}` },
    });
    const missing = mockDatabase({ firstResults: [null] });
    await expect(
      authenticatePersonalAccessToken(missing.db, request, now)
    ).resolves.toBeNull();

    const malformed = mockDatabase({
      firstResults: [
        {
          id: "pat-id",
          tokenPrefix: "ttv_pat_0c0c0c0c…",
          label: "Invalid",
          scopes: '["owner"]',
          expiresAt: nowSeconds + 60,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: nowSeconds,
          userId: "admin-id",
          userName: "Admin",
          userEmail: "admin@example.com",
          userEmailVerified: 1,
          userImage: null,
          userCreatedAt: nowSeconds,
          userUpdatedAt: nowSeconds,
        },
      ],
    });
    await expect(
      authenticatePersonalAccessToken(malformed.db, request, now)
    ).resolves.toBeNull();
  });

  it("recognizes write access only when explicitly granted", () => {
    expect(personalAccessTokenCanWrite({ scopes: ["admin:read"] })).toBe(
      false
    );
    expect(
      personalAccessTokenCanWrite({
        scopes: ["admin:read", "admin:write"],
      })
    ).toBe(true);
  });

  it("blocks admin mutations for read-only tokens and allows explicit write", async () => {
    const request = new Request("https://example.com/api/admin/recordings/process", {
      method: "POST",
    });
    const denied = enforcePersonalAccessTokenMutationScope(
      request,
      "/api/admin/recordings/process",
      { scopes: ["admin:read"] }
    );
    expect(denied?.status).toBe(403);
    await expect(denied?.text()).resolves.toContain("admin:write");
    expect(
      enforcePersonalAccessTokenMutationScope(
        request,
        "/api/admin/recordings/process",
        { scopes: ["admin:read", "admin:write"] }
      )
    ).toBeNull();
    expect(
      enforcePersonalAccessTokenMutationScope(
        new Request("https://example.com/admin/recordings"),
        "/admin/recordings",
        { scopes: ["admin:read"] }
      )
    ).toBeNull();
  });
});
