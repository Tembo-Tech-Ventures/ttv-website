export const HEALTH_PATH = "/api/health";

type HealthRuntimeEnv = Pick<
  Cloudflare.Env,
  "DB" | "DEPLOYMENT_ENVIRONMENT" | "DEPLOYMENT_VERSION"
>;

export interface HealthChecks {
  db: "ok" | "error";
  failedRecordings: number;
  stuckRecordings: number;
  importSourceErrors: number;
  errorSignatures24h: number;
  lastErrorAt: string | null;
}

interface HealthQueryRow {
  failedRecordings: number;
  stuckRecordings: number;
  importSourceErrors: number;
  errorSignatures24h: number;
  lastErrorAt: number | string | null;
}

const HEALTH_QUERY = `
  SELECT
    (SELECT COUNT(*) FROM "recording" WHERE "processingStatus" = 'failed')
      AS "failedRecordings",
    (SELECT COUNT(*) FROM "recording"
      WHERE "processingStatus" IN
        ('queued', 'downloading', 'extracting_audio', 'transcribing', 'embedding')
        AND "updatedAt" < unixepoch() - 7200)
      AS "stuckRecordings",
    (SELECT COUNT(*) FROM "recording_import_source"
      WHERE "lastError" IS NOT NULL AND trim("lastError") <> '')
      AS "importSourceErrors",
    (SELECT COUNT(*) FROM "errorEvent"
      WHERE "lastSeenAt" >= unixepoch() - 86400)
      AS "errorSignatures24h",
    (SELECT MAX("lastSeenAt") FROM "errorEvent") AS "lastErrorAt"
`;

export function isHealthCheckPath(pathname: string) {
  return pathname === HEALTH_PATH;
}

function count(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function toIsoTimestamp(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1_000).toISOString();
}

export async function readHealthChecks(db: D1Database): Promise<HealthChecks> {
  const [result] = await db.batch([db.prepare(HEALTH_QUERY)]);
  const row = result?.results?.[0] as unknown as HealthQueryRow | undefined;
  if (!result?.success || !row) throw new Error("Database health query failed");

  return {
    db: "ok",
    failedRecordings: count(row.failedRecordings),
    stuckRecordings: count(row.stuckRecordings),
    importSourceErrors: count(row.importSourceErrors),
    errorSignatures24h: count(row.errorSignatures24h),
    lastErrorAt: toIsoTimestamp(row.lastErrorAt),
  };
}

export function createHealthAlerts(checks: HealthChecks) {
  const alerts: string[] = [];
  if (checks.db === "error") alerts.push("Database health check failed");
  if (checks.failedRecordings > 0) {
    alerts.push(
      `${checks.failedRecordings} failed recording${checks.failedRecordings === 1 ? "" : "s"}`
    );
  }
  if (checks.stuckRecordings > 0) {
    alerts.push(
      `${checks.stuckRecordings} recording${checks.stuckRecordings === 1 ? " is" : "s are"} stuck in processing`
    );
  }
  if (checks.importSourceErrors > 0) {
    alerts.push(
      `${checks.importSourceErrors} recording import source${checks.importSourceErrors === 1 ? " has" : "s have"} errors`
    );
  }
  if (checks.errorSignatures24h > 0) {
    alerts.push(
      `${checks.errorSignatures24h} error signature${checks.errorSignatures24h === 1 ? "" : "s"} seen in the last 24 hours`
    );
  }
  return alerts;
}

export function createHealthPayload(
  runtimeEnv: Pick<
    HealthRuntimeEnv,
    "DEPLOYMENT_ENVIRONMENT" | "DEPLOYMENT_VERSION"
  >,
  checks: HealthChecks
) {
  const alerts = createHealthAlerts(checks);
  return {
    status: checks.db === "ok" ? ("ok" as const) : ("error" as const),
    service: "ttv-website" as const,
    environment: runtimeEnv.DEPLOYMENT_ENVIRONMENT ?? "unknown",
    version: runtimeEnv.DEPLOYMENT_VERSION ?? "unknown",
    checks,
    degraded: alerts.length > 0,
    alerts,
  };
}

export async function createHealthResponse(runtimeEnv: HealthRuntimeEnv) {
  let checks: HealthChecks;
  try {
    checks = await readHealthChecks(runtimeEnv.DB);
  } catch {
    checks = {
      db: "error",
      failedRecordings: 0,
      stuckRecordings: 0,
      importSourceErrors: 0,
      errorSignatures24h: 0,
      lastErrorAt: null,
    };
  }
  const payload = createHealthPayload(runtimeEnv, checks);

  return Response.json(payload, {
    status: payload.status === "ok" ? 200 : 503,
    headers: {
      "cache-control": "no-store",
    },
  });
}
