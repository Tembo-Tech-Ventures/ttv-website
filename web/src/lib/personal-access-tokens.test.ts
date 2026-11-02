import { describe, expect, it, vi } from "vitest";
import { createSqliteD1, MINIMAL_AUTH_SCHEMA, readMigration } from "@/test/sqlite-d1";
import {
  PERSONAL_ACCESS_TOKEN_EXPIRY_OPTIONS,
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
  personalAccessTokenFamily,
  type PersonalAccessTokenScope,
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
  it.each([24, 72, 168, 720, 1440, 2160, 4320, 8640])("accepts the %i-hour expiry option", (hours) => {
    expect(parsePersonalAccessTokenDuration(String(hours))).toBe(hours);
  });

  it("offers the requested day and month choices without duplicate durations", () => {
    expect(PERSONAL_ACCESS_TOKEN_EXPIRY_OPTIONS).toEqual([
      { hours: 24, label: "1 day" }, { hours: 72, label: "3 days" },
      { hours: 168, label: "7 days" }, { hours: 720, label: "30 days (1 month)" },
      { hours: 1440, label: "2 months" }, { hours: 2160, label: "3 months" },
      { hours: 4320, label: "6 months" }, { hours: 8640, label: "12 months" },
    ]);
  });

  it.each([null, "", "0", "-24", "25", "72.5", "8641", "Infinity", "NaN"])("rejects unsupported expiry %s", (value) => {
    expect(() => parsePersonalAccessTokenDuration(value)).toThrow("supported token duration");
  });
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
    expect(parsePersonalAccessTokenScopes("channels-read")).toEqual(["channels:read"]);
    expect(parsePersonalAccessTokenScopes("channels-write")).toEqual([
      "channels:read",
      "channels:write",
    ]);
  });

  it("rejects unsafe labels, unbounded expiry, and unknown access", () => {
    expect(() => normalizePersonalAccessTokenLabel("bad/token")).toThrow(
      "may contain"
    );
    expect(() => parsePersonalAccessTokenDuration("87600")).toThrow(
      "supported token duration"
    );
    for (const access of ["owner", "community-read", "toString", null]) {
      expect(() => parsePersonalAccessTokenScopes(access)).toThrow(
        "read-only or read/write"
      );
    }
  });
});

describe("personal access token lifecycle", () => {
  it.each(PERSONAL_ACCESS_TOKEN_EXPIRY_OPTIONS)("persists and enforces $label expiry", async ({ hours }) => {
    const { db, database } = createSqliteD1();
    try {
      database.exec(MINIMAL_AUTH_SCHEMA);
      database.exec(readMigration("0008_curvy_purifiers.sql"));
      database.exec("INSERT INTO user(id,name,email) VALUES ('admin','Fictional Admin','admin@example.test')");
      const created = await createPersonalAccessToken({ db, userId: "admin", label: "Expiry check",
        durationHours: hours, scopes: ["admin:read"], now });
      const expiry = now.getTime() + hours * 3_600_000;
      expect(created.expiresAt.getTime()).toBe(expiry);
      expect(database.prepare("SELECT expiresAt FROM personal_access_token").get()).toMatchObject({ expiresAt: expiry / 1000 });
      const request = new Request("https://example.test/admin", { headers: { Authorization: `Bearer ${created.token}` } });
      expect(await authenticatePersonalAccessToken(db, request, new Date(expiry - 1000))).not.toBeNull();
      expect(await authenticatePersonalAccessToken(db, request, new Date(expiry))).toBeNull();
      expect(await authenticatePersonalAccessToken(db, request, new Date(expiry + 1000))).toBeNull();
      await revokePersonalAccessToken(db, "admin", created.id, now);
      expect(await authenticatePersonalAccessToken(db, request, now)).toBeNull();
    } finally { database.close(); }
  });

  it("rejects a duration beyond twelve months before touching the database", async () => {
    const database = mockDatabase();
    await expect(createPersonalAccessToken({ db: database.db, userId: "admin", label: "Invalid",
      durationHours: 8641 as 8640, scopes: ["admin:read"], now })).rejects.toThrow("supported token duration");
    expect(database.prepare).not.toHaveBeenCalled();
  });
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

describe("community personal access token scopes", () => {
  it("stores community scopes without granting admin access", async () => {
    const { db, calls } = mockDatabase();
    const result = await createPersonalAccessToken({ db, userId: "member", label: "Community agent", durationHours: 8, scopes: ["community:read", "community:write"], now, cryptoImpl: deterministicCrypto() });
    expect(result.scopes).toEqual(["community:read", "community:write"]);
    expect(personalAccessTokenCanWrite(result)).toBe(false);
    expect(calls.some(call => call.values.includes('["community:read","community:write"]'))).toBe(true);
  });
  it("requires a base read scope", async () => {
    const { db } = mockDatabase();
    await expect(createPersonalAccessToken({ db, userId: "member", label: "Community agent", durationHours: 8, scopes: ["institution:read"], now, cryptoImpl: deterministicCrypto() })).rejects.toThrow("Every token must include");
  });
  it("refuses mixed admin and community scope grants", async () => {
    const { db } = mockDatabase();
    await expect(createPersonalAccessToken({ db, userId: "member", label: "Mixed agent", durationHours: 8, scopes: ["admin:read", "community:read"], now, cryptoImpl: deterministicCrypto() })).rejects.toThrow("cannot be combined");
  });
});

describe("channel personal access token scopes", () => {
  const create = (scopes: PersonalAccessTokenScope[], db = mockDatabase().db) =>
    createPersonalAccessToken({ db, userId: "member", label: "Channel agent", durationHours: 720, scopes, now, cryptoImpl: deterministicCrypto() });

  it("stores channel scopes without granting admin writes", async () => {
    const { db, calls } = mockDatabase();
    const result = await create(["channels:read", "channels:write"], db);
    expect(result.scopes).toEqual(["channels:read", "channels:write"]);
    expect(personalAccessTokenCanWrite(result)).toBe(false);
    expect(calls.some(call => call.values.includes('["channels:read","channels:write"]'))).toBe(true);
  });

  it("requires channels:read", async () => {
    await expect(create(["channels:write"])).rejects.toThrow("Every token must include");
  });

  it("refuses channel scopes combined with community or admin scopes", async () => {
    for (const scopes of [
      ["channels:read", "community:read"], ["channels:read", "channels:write", "community:write"],
      ["channels:read", "institution:read"], ["channels:read", "admin:read"], ["admin:read", "admin:write", "channels:write"],
    ] as PersonalAccessTokenScope[][]) {
      await expect(create(scopes), `${scopes.join()}`).rejects.toThrow("cannot be combined");
    }
  });

  it("names each token's one family, and no family for a mix", () => {
    expect(personalAccessTokenFamily(["admin:read", "admin:write"])).toBe("admin");
    expect(personalAccessTokenFamily(["community:read", "institution:read"])).toBe("community");
    expect(personalAccessTokenFamily(["channels:read", "channels:write"])).toBe("channels");
    expect(personalAccessTokenFamily(["channels:read", "community:read"])).toBeNull();
    expect(personalAccessTokenFamily([])).toBeNull();
  });

});
