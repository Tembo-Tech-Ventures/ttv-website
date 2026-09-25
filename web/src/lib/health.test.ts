import { describe, expect, it, vi } from "vitest";
import {
  HEALTH_PATH,
  createHealthPayload,
  createHealthResponse,
  isHealthCheckPath,
  readHealthChecks,
  type HealthChecks,
} from "./health";

const healthyChecks: HealthChecks = {
  db: "ok",
  failedRecordings: 0,
  stuckRecordings: 0,
  importSourceErrors: 0,
  errorSignatures24h: 0,
  lastErrorAt: null,
};

function createDatabase(
  row: Record<string, unknown>,
  options: { reject?: Error; success?: boolean } = {}
) {
  const statement = { sql: "health" };
  const prepare = vi.fn(() => statement);
  const batch = options.reject
    ? vi.fn().mockRejectedValue(options.reject)
    : vi.fn().mockResolvedValue([
        {
          success: options.success ?? true,
          results: [row],
        },
      ]);
  return {
    db: { prepare, batch } as unknown as D1Database,
    batch,
    prepare,
    statement,
  };
}

describe("health checks", () => {
  it("recognizes only the exact public health path", () => {
    expect(isHealthCheckPath(HEALTH_PATH)).toBe(true);
    expect(isHealthCheckPath(`${HEALTH_PATH}/`)).toBe(false);
    expect(isHealthCheckPath("/api/health-details")).toBe(false);
  });

  it("reads every database signal through one D1 batch", async () => {
    const { db, batch, statement } = createDatabase({
      failedRecordings: 2,
      stuckRecordings: 3,
      importSourceErrors: 1,
      errorSignatures24h: 4,
      lastErrorAt: 1_795_000_000,
    });

    await expect(readHealthChecks(db)).resolves.toEqual({
      db: "ok",
      failedRecordings: 2,
      stuckRecordings: 3,
      importSourceErrors: 1,
      errorSignatures24h: 4,
      lastErrorAt: new Date(1_795_000_000_000).toISOString(),
    });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenCalledWith([statement]);
  });

  it("includes deployment identity, check shape, and a healthy state", () => {
    expect(
      createHealthPayload(
        {
          DEPLOYMENT_ENVIRONMENT: "agent-abc123",
          DEPLOYMENT_VERSION: "deadbeef",
        },
        healthyChecks
      )
    ).toEqual({
      status: "ok",
      service: "ttv-website",
      environment: "agent-abc123",
      version: "deadbeef",
      checks: healthyChecks,
      degraded: false,
      alerts: [],
    });
  });

  it("marks application failures degraded without changing status", () => {
    const payload = createHealthPayload(
      {
        DEPLOYMENT_ENVIRONMENT: "production",
        DEPLOYMENT_VERSION: "v1",
      },
      {
        ...healthyChecks,
        failedRecordings: 1,
        importSourceErrors: 2,
      }
    );

    expect(payload.status).toBe("ok");
    expect(payload.degraded).toBe(true);
    expect(payload.alerts).toEqual([
      "1 failed recording",
      "2 recording import sources have errors",
    ]);
  });

  it("returns non-cacheable JSON and 503 only when the database is unavailable", async () => {
    const { db } = createDatabase({}, { reject: new Error("D1 unavailable") });
    const response = await createHealthResponse({
      DB: db,
      DEPLOYMENT_ENVIRONMENT: "production",
      DEPLOYMENT_VERSION: "version-1",
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      status: "error",
      service: "ttv-website",
      environment: "production",
      version: "version-1",
      checks: {
        db: "error",
        failedRecordings: 0,
        stuckRecordings: 0,
        importSourceErrors: 0,
        errorSignatures24h: 0,
        lastErrorAt: null,
      },
      degraded: true,
      alerts: ["Database health check failed"],
    });
  });
});
