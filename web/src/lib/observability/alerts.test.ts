import { describe, expect, it, vi } from "vitest";
import { ALERT_TIMEOUT_MS, pushAlerts, type PlatformAlertKind } from "./alerts";

interface FakeStatement {
  sql: string;
  values: unknown[];
  bind: (...values: unknown[]) => FakeStatement;
  all: <T>() => Promise<{ results: T[] }>;
  first: <T>() => Promise<T | null>;
  run: () => Promise<{ success: true }>;
}

interface StoredAlert {
  id: string;
  kind: PlatformAlertKind;
  subject: string;
  idempotencyKey: string;
  payload: string;
  status: "pending" | "sent";
  sentAt: number | null;
  attempts: number;
  createdAt: number;
}

function createAlertDatabase(options: {
  errors?: Array<Record<string, unknown>>;
  recordings?: Array<Record<string, unknown>>;
  imports?: Array<Record<string, unknown>>;
  health?: Partial<{
    failedRecordings: number;
    stuckRecordings: number;
    importSourceErrors: number;
    errorSignatures24h: number;
    lastErrorAt: number | null;
  }>;
  alerts?: StoredAlert[];
} = {}) {
  const alerts = [...(options.alerts ?? [])];
  const statements: FakeStatement[] = [];

  const makeStatement = (sql: string, values: unknown[] = []): FakeStatement => {
    const statement: FakeStatement = {
      sql,
      values,
      bind: (...bound) => makeStatement(sql, bound),
      all: async <T>() => {
        if (!sql.includes('FROM "platformAlert"')) {
          throw new Error(`Unexpected all query: ${sql}`);
        }
        return {
          results: alerts
            .filter((alert) => alert.status === "pending" && alert.attempts < 5)
            .map((alert) => ({ ...alert })) as T[],
        };
      },
      first: async <T>() => {
        if (!sql.startsWith('UPDATE "platformAlert"')) {
          throw new Error(`Unexpected first query: ${sql}`);
        }
        const alert = alerts.find((item) => item.id === values[0]);
        if (!alert || alert.status !== "pending" || alert.attempts >= 5) return null;
        alert.attempts += 1;
        return { attempts: alert.attempts } as T;
      },
      run: async () => {
        if (sql.includes(`SET "status" = 'sent'`)) {
          const [sentAt, id] = values as [number, string];
          const alert = alerts.find((item) => item.id === id);
          if (alert) Object.assign(alert, { status: "sent", sentAt });
        }
        return { success: true };
      },
    };
    statements.push(statement);
    return statement;
  };

  const prepare = vi.fn((sql: string) => makeStatement(sql));
  const batch = vi.fn(async (batchStatements: FakeStatement[]) => {
    if (batchStatements[0]?.sql.includes('CASE WHEN "lastNotifiedAt"')) {
      return [
        { success: true, results: options.errors ?? [] },
        { success: true, results: options.recordings ?? [] },
        { success: true, results: options.imports ?? [] },
      ];
    }
    if (batchStatements[0]?.sql.includes('AS "failedRecordings"')) {
      return [
        {
          success: true,
          results: [
            {
              failedRecordings: 0,
              stuckRecordings: 0,
              importSourceErrors: 0,
              errorSignatures24h: 0,
              lastErrorAt: null,
              ...options.health,
            },
          ],
        },
      ];
    }
    if (batchStatements[0]?.sql.includes('INSERT OR IGNORE INTO "platformAlert"')) {
      for (const statement of batchStatements) {
        const [id, kind, subject, idempotencyKey, payload, createdAt] =
          statement.values as [string, PlatformAlertKind, string, string, string, number];
        if (alerts.some((alert) => alert.idempotencyKey === idempotencyKey)) continue;
        alerts.push({
          id,
          kind,
          subject,
          idempotencyKey,
          payload,
          status: "pending",
          sentAt: null,
          attempts: 0,
          createdAt,
        });
      }
      return batchStatements.map(() => ({ success: true, results: [] }));
    }
    throw new Error(`Unexpected batch: ${batchStatements[0]?.sql}`);
  });

  return {
    db: { prepare, batch } as unknown as D1Database,
    alerts,
    batch,
    prepare,
    statements,
  };
}

function createEnv(db: D1Database, configured = true) {
  return {
    DB: db,
    SAM_ALERT_WEBHOOK_URL: configured ? "https://sam.example.test/ingest" : undefined,
    SAM_ALERT_WEBHOOK_TOKEN: configured ? "sam_wh_test-token" : undefined,
    DEPLOYMENT_ENVIRONMENT: "production",
    DEPLOYMENT_VERSION: "abc123",
    PRIMARY_DOMAIN: "tembotechventures.com",
    BETTER_AUTH_URL: "https://tembotechventures.com",
  };
}

const now = new Date("2026-09-25T04:30:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1_000);

describe("pushAlerts", () => {
  it("does nothing when either webhook setting is absent", async () => {
    const prepare = vi.fn(() => {
      throw new Error("database should not be touched");
    });
    const env = createEnv({ prepare } as unknown as D1Database, false);

    await expect(pushAlerts(env, { now })).resolves.toEqual({
      created: 0,
      attempted: 0,
      sent: 0,
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("creates every signal kind with the shared payload contract", async () => {
    const signature = "a".repeat(64);
    const { db, alerts } = createAlertDatabase({
      errors: [
        {
          signature,
          route: "/api/test",
          message: "Bearer payload-secret failed",
          count: 12,
          firstSeenAt: nowSeconds - 60,
          lastSeenAt: nowSeconds,
          kind: "error.new",
        },
        {
          signature: "c".repeat(64),
          route: "/queue/process_recording",
          message: "queue failures increased",
          count: 22,
          firstSeenAt: nowSeconds - 600,
          lastSeenAt: nowSeconds,
          kind: "error.spike",
        },
      ],
      recordings: [
        {
          id: "recording-1",
          title: "Workshop",
          processingError: "transcription failed",
          createdAt: nowSeconds - 120,
          updatedAt: nowSeconds,
        },
      ],
      imports: [
        {
          id: "import-1",
          name: "Drive folder",
          lastError: "API key=private-key rejected",
          createdAt: nowSeconds - 180,
          updatedAt: nowSeconds,
        },
      ],
      health: { stuckRecordings: 1 },
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));

    const result = await pushAlerts(createEnv(db), { fetchImpl, now });

    expect(result).toEqual({ created: 5, attempted: 5, sent: 0 });
    expect(alerts.map((alert) => alert.kind).toSorted()).toEqual([
      "error.new",
      "error.spike",
      "health.degraded",
      "import.error",
      "recording.failed",
    ]);
    const errorAlert = alerts.find((alert) => alert.kind === "error.new");
    expect(errorAlert?.idempotencyKey).toBe(`error.new:${signature}:2026-09-25`);
    const payload = JSON.parse(errorAlert?.payload ?? "{}") as Record<string, unknown>;
    expect(payload).toMatchObject({
      source: "ttv-website",
      kind: "error.new",
      environment: "production",
      version: "abc123",
      signature: "a".repeat(16),
      count: 12,
      firstSeenAt: new Date((nowSeconds - 60) * 1_000).toISOString(),
      lastSeenAt: new Date(nowSeconds * 1_000).toISOString(),
      links: {
        health: "https://tembotechventures.com/api/health",
        run: null,
        admin: "https://tembotechventures.com/admin#attention-error-signatures",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("payload-secret");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer sam_wh_test-token",
        "Content-Type": "application/json",
        "Idempotency-Key": `error.new:${signature}:2026-09-25`,
      },
      signal: expect.any(AbortSignal),
    });
    expect(ALERT_TIMEOUT_MS).toBe(5_000);
  });

  it("marks an alert sent only when SAM returns 202", async () => {
    const signature = "b".repeat(64);
    const { db, alerts } = createAlertDatabase({
      errors: [
        {
          signature,
          route: "/api/test",
          message: "failed",
          count: 1,
          firstSeenAt: nowSeconds,
          lastSeenAt: nowSeconds,
          kind: "error.new",
        },
      ],
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

    await expect(pushAlerts(createEnv(db), { fetchImpl, now })).resolves.toEqual({
      created: 1,
      attempted: 1,
      sent: 1,
    });
    expect(alerts[0]).toMatchObject({ status: "sent", attempts: 1 });
  });

  it("leaves a 5xx delivery pending for the next cron", async () => {
    const pending: StoredAlert = {
      id: "alert-1",
      kind: "recording.failed",
      subject: "recording-1:1",
      idempotencyKey: "recording.failed:recording-1:1:2026-09-25",
      payload: "{}",
      status: "pending",
      sentAt: null,
      attempts: 2,
      createdAt: nowSeconds,
    };
    const { db, alerts } = createAlertDatabase({ alerts: [pending] });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));

    await pushAlerts(createEnv(db), { fetchImpl, now });

    expect(alerts[0]).toMatchObject({ status: "pending", attempts: 3, sentAt: null });
  });

  it("never attempts a pending alert after five tries", async () => {
    const { db, alerts } = createAlertDatabase({
      alerts: [
        {
          id: "alert-1",
          kind: "recording.failed",
          subject: "recording-1:1",
          idempotencyKey: "recording.failed:recording-1:1:2026-09-25",
          payload: "{}",
          status: "pending",
          sentAt: null,
          attempts: 5,
          createdAt: nowSeconds,
        },
      ],
    });
    const fetchImpl = vi.fn();

    await expect(pushAlerts(createEnv(db), { fetchImpl, now })).resolves.toEqual({
      created: 0,
      attempted: 0,
      sent: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(alerts[0].attempts).toBe(5);
  });
});
