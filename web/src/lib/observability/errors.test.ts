import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ACTIVE_ERROR_SIGNATURES,
  collapseRoutePattern,
  createErrorSignature,
  recordError,
  redactErrorMessage,
} from "./errors";

interface StoredError {
  id: string;
  signature: string;
  source: string;
  route: string;
  message: string;
  level: string;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastVersion: string;
}

function createErrorDatabase(initial: StoredError[] = []) {
  const rows = new Map(initial.map((row) => [row.signature, { ...row }]));
  const prepare = vi.fn((sql: string) => ({
    bind: (...values: unknown[]) => ({
      first: async () => {
        if (sql.startsWith('UPDATE "errorEvent"')) {
          const [lastSeenAt, lastVersion, message, level, signature] = values as [
            number,
            string,
            string,
            string,
            string,
          ];
          const row = rows.get(signature);
          if (!row) return null;
          row.count += 1;
          Object.assign(row, { lastSeenAt, lastVersion, message, level });
          return { id: row.id };
        }
        if (sql.includes('COUNT(*) AS "count"')) {
          const [activeSince] = values as [number];
          return {
            count: [...rows.values()].filter((row) => row.lastSeenAt >= activeSince)
              .length,
          };
        }
        throw new Error(`Unexpected first query: ${sql}`);
      },
      run: async () => {
        if (!sql.startsWith('INSERT INTO "errorEvent"')) {
          throw new Error(`Unexpected run query: ${sql}`);
        }
        const [
          id,
          signature,
          source,
          route,
          message,
          level,
          firstSeenAt,
          lastSeenAt,
          lastVersion,
        ] = values as [string, string, string, string, string, string, number, number, string];
        const existing = rows.get(signature);
        if (existing) {
          existing.count += 1;
          Object.assign(existing, { lastSeenAt, lastVersion, message, level });
        } else {
          rows.set(signature, {
            id,
            signature,
            source,
            route,
            message,
            level,
            count: 1,
            firstSeenAt,
            lastSeenAt,
            lastVersion,
          });
        }
        return { success: true };
      },
    }),
  }));
  return { db: { prepare } as unknown as D1Database, prepare, rows };
}

function storedError(index: number, lastSeenAt: number): StoredError {
  return {
    id: `error-${index}`,
    signature: `signature-${index}`,
    source: "request",
    route: "/test",
    message: "failed",
    level: "error",
    count: 1,
    firstSeenAt: lastSeenAt,
    lastSeenAt,
    lastVersion: "v1",
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("error signatures", () => {
  it("collapses numeric, UUID, cuid, and query-string route details", () => {
    expect(
      collapseRoutePattern(
        "/api/recordings/123/550e8400-e29b-41d4-a716-446655440000?q=secret"
      )
    ).toBe("/api/recordings/:id/:id");
    expect(collapseRoutePattern("/users/clh1234567890abcdefghijk/settings")).toBe(
      "/users/:id/settings"
    );
    expect(
      collapseRoutePattern("/users/person%40example.com/from/192.168.10.22")
    ).toBe("/users/:redacted/from/:redacted");
  });

  it("is stable across identifiers, counts, whitespace, and case", async () => {
    const first = await createErrorSignature({
      source: "request",
      route: "/api/recordings/123?token=first",
      error: new Error("Upload 42 FAILED  for user one@example.com"),
    });
    const second = await createErrorSignature({
      source: "request",
      route: "/api/recordings/987?token=second",
      error: new Error("upload 99 failed for user two@example.com"),
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes UUIDs and cuids embedded in messages", async () => {
    const first = await createErrorSignature({
      source: "pipeline",
      route: "/recordings/:id/pipeline",
      error: new Error(
        "Recording 550e8400-e29b-41d4-a716-446655440000 clh1234567890abcdefghijk failed"
      ),
    });
    const second = await createErrorSignature({
      source: "pipeline",
      route: "/recordings/:id/pipeline",
      error: new Error(
        "Recording 123e4567-e89b-42d3-a456-426614174000 cm0123456789abcdefghijkl failed"
      ),
    });

    expect(first).toBe(second);
  });
});

describe("error redaction", () => {
  it("removes bearer values, keyed secrets, emails, IPs, and query strings", () => {
    const secret = "sam_wh_do-not-log-this";
    const redacted = redactErrorMessage(
      `Authorization: Bearer ${secret}; api_key=key-value token: token-value ` +
        `for person@example.com at 192.168.10.22 via https://example.com/run?id=12&secret=x`
    );

    expect(redacted).toContain("Authorization: [REDACTED]");
    expect(redacted).toContain("api_key=[REDACTED]");
    expect(redacted).toContain("token: [REDACTED]");
    expect(redacted).toContain("[EMAIL]");
    expect(redacted).toContain("[IP]");
    expect(redacted).toContain("https://example.com/run?[QUERY]");
    expect(redacted).not.toContain(secret);
    expect(redacted).not.toContain("person@example.com");
    expect(redacted.length).toBeLessThanOrEqual(500);
  });
});

describe("recordError", () => {
  it("deduplicates a stable signature and increments its count", async () => {
    const { db, rows } = createErrorDatabase();
    const now = new Date("2026-09-25T04:00:00.000Z");

    const first = await recordError(
      db,
      {
        source: "queue",
        route: "/queue/recordings/123",
        error: new Error("Recording 123 failed"),
        version: "v1",
      },
      now
    );
    const second = await recordError(
      db,
      {
        source: "queue",
        route: "/queue/recordings/456",
        error: new Error("recording 456 FAILED"),
        version: "v2",
      },
      new Date("2026-09-25T04:05:00.000Z")
    );

    expect(second).toBe(first);
    expect(rows).toHaveLength(1);
    expect(rows.get(first ?? "")).toMatchObject({
      count: 2,
      route: "/queue/recordings/:id",
      lastVersion: "v2",
    });
  });

  it("ignores a new signature when 500 signatures are active", async () => {
    const now = new Date("2026-09-25T04:00:00.000Z");
    const seenAt = Math.floor(now.getTime() / 1_000);
    const initial = Array.from({ length: MAX_ACTIVE_ERROR_SIGNATURES }, (_, index) =>
      storedError(index, seenAt)
    );
    const { db, rows } = createErrorDatabase(initial);

    await expect(
      recordError(
        db,
        {
          source: "request",
          route: "/new-route",
          error: new Error("new failure"),
          version: "v1",
        },
        now
      )
    ).resolves.toBeNull();
    expect(rows).toHaveLength(MAX_ACTIVE_ERROR_SIGNATURES);
  });

  it("never throws or logs the original secret when the ledger is unavailable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = {
      prepare: vi.fn(() => {
        throw new Error("DB rejected Bearer private-token");
      }),
    } as unknown as D1Database;

    await expect(
      recordError(db, {
        source: "cron",
        route: "/scheduled",
        error: new Error("Bearer application-token"),
        version: "v1",
      })
    ).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledOnce();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private-token");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("application-token");
  });
});
