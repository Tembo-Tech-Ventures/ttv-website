import { createId } from "@paralleldrive/cuid2";
import { createHealthAlerts, readHealthChecks } from "@/lib/health";
import { redactErrorMessage } from "@/lib/observability/errors";

export const ALERT_TIMEOUT_MS = 5_000;
const ALERT_SIGNATURE_LENGTH = 16;
const RECENT_SIGNAL_SECONDS = 60 * 60;

export type PlatformAlertKind =
  | "error.new"
  | "error.spike"
  | "recording.failed"
  | "import.error"
  | "health.degraded";

type AlertEnv = Pick<
  Cloudflare.Env,
  | "DB"
  | "SAM_ALERT_WEBHOOK_URL"
  | "SAM_ALERT_WEBHOOK_TOKEN"
  | "DEPLOYMENT_ENVIRONMENT"
  | "DEPLOYMENT_VERSION"
  | "PRIMARY_DOMAIN"
  | "BETTER_AUTH_URL"
>;

interface ErrorSignal {
  signature: string;
  route: string;
  message: string;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  kind: "error.new" | "error.spike";
}

interface RecordingSignal {
  id: string;
  title: string;
  processingError: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ImportSignal {
  id: string;
  name: string;
  lastError: string;
  createdAt: number;
  updatedAt: number;
}

interface PendingAlert {
  id: string;
  kind: PlatformAlertKind;
  subject: string;
  idempotencyKey: string;
  payload: string;
  attempts: number;
}

interface AlertPayload {
  source: "ttv-website";
  kind: PlatformAlertKind;
  environment: string;
  version: string;
  signature: string;
  count: number;
  message: string;
  firstSeenAt: string;
  lastSeenAt: string;
  links: {
    health: string;
    run: null;
    admin: string;
  };
}

interface AlertDraft {
  kind: PlatformAlertKind;
  subject: string;
  payload: AlertPayload;
}

function rows<T>(result: D1Result<unknown> | undefined) {
  return (result?.results ?? []) as T[];
}

function iso(seconds: number) {
  return new Date(Number(seconds) * 1_000).toISOString();
}

function dateKey(now: Date) {
  return now.toISOString().slice(0, 10);
}

function applicationOrigin(env: AlertEnv) {
  if (env.PRIMARY_DOMAIN) return `https://${env.PRIMARY_DOMAIN}`;
  if (env.BETTER_AUTH_URL) {
    try {
      return new URL(env.BETTER_AUTH_URL).origin;
    } catch {
      // Deployment configuration validates this URL; retain a safe fallback.
    }
  }
  return "https://tembotechventures.com";
}

async function hashPrefix(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  )
    .join("")
    .slice(0, ALERT_SIGNATURE_LENGTH);
}

function alertPayload(
  env: AlertEnv,
  input: Omit<AlertPayload, "source" | "environment" | "version" | "links"> & {
    adminPath: string;
  }
): AlertPayload {
  const origin = applicationOrigin(env);
  return {
    source: "ttv-website",
    kind: input.kind,
    environment: env.DEPLOYMENT_ENVIRONMENT ?? "unknown",
    version: env.DEPLOYMENT_VERSION ?? "unknown",
    signature: input.signature,
    count: input.count,
    message: redactErrorMessage(input.message),
    firstSeenAt: input.firstSeenAt,
    lastSeenAt: input.lastSeenAt,
    links: {
      health: `${origin}/api/health`,
      run: null,
      admin: `${origin}${input.adminPath}`,
    },
  };
}

async function collectAlertDrafts(env: AlertEnv, now: Date) {
  const recentSince = Math.floor(now.getTime() / 1_000) - RECENT_SIGNAL_SECONDS;
  const results = await env.DB.batch([
    env.DB
      .prepare(
        `SELECT "signature", "route", "message", "count", "firstSeenAt", "lastSeenAt",
                CASE WHEN "lastNotifiedAt" IS NULL THEN 'error.new' ELSE 'error.spike' END AS "kind"
         FROM "errorEvent" AS e
         WHERE "lastSeenAt" >= ?
           AND (
             ("lastNotifiedAt" IS NULL AND NOT EXISTS (
               SELECT 1 FROM "platformAlert" AS a
               WHERE a."kind" = 'error.new' AND a."subject" = e."signature"
             ))
             OR
             ("lastNotifiedAt" IS NOT NULL AND "count" - "notifiedCount" >= 10)
           )`
      )
      .bind(recentSince),
    env.DB
      .prepare(
        `SELECT "id", "title", "processingError", "createdAt", "updatedAt"
         FROM "recording"
         WHERE "processingStatus" = 'failed' AND "updatedAt" >= ?`
      )
      .bind(recentSince),
    env.DB
      .prepare(
        `SELECT "id", "name", "lastError", "createdAt", "updatedAt"
         FROM "recording_import_source"
         WHERE "lastError" IS NOT NULL AND trim("lastError") <> '' AND "updatedAt" >= ?`
      )
      .bind(recentSince),
  ]);
  const drafts: AlertDraft[] = [];

  for (const error of rows<ErrorSignal>(results[0])) {
    drafts.push({
      kind: error.kind,
      subject: error.signature,
      payload: alertPayload(env, {
        kind: error.kind,
        signature: error.signature.slice(0, ALERT_SIGNATURE_LENGTH),
        count: Number(error.count),
        message: error.message,
        firstSeenAt: iso(error.firstSeenAt),
        lastSeenAt: iso(error.lastSeenAt),
        adminPath: "/admin#attention-error-signatures",
      }),
    });
  }

  for (const recording of rows<RecordingSignal>(results[1])) {
    const subject = `${recording.id}:${recording.updatedAt}`;
    drafts.push({
      kind: "recording.failed",
      subject,
      payload: alertPayload(env, {
        kind: "recording.failed",
        signature: await hashPrefix(`recording.failed:${subject}`),
        count: 1,
        message: recording.processingError || `Recording ${recording.title} failed`,
        firstSeenAt: iso(recording.createdAt),
        lastSeenAt: iso(recording.updatedAt),
        adminPath: `/admin/recordings/${encodeURIComponent(recording.id)}`,
      }),
    });
  }

  for (const source of rows<ImportSignal>(results[2])) {
    const errorSignature = await hashPrefix(source.lastError);
    const subject = `${source.id}:${errorSignature}`;
    drafts.push({
      kind: "import.error",
      subject,
      payload: alertPayload(env, {
        kind: "import.error",
        signature: await hashPrefix(`import.error:${subject}`),
        count: 1,
        message: `${source.name}: ${source.lastError}`,
        firstSeenAt: iso(source.createdAt),
        lastSeenAt: iso(source.updatedAt),
        adminPath: "/admin/recordings/import",
      }),
    });
  }

  const healthChecks = await readHealthChecks(env.DB);
  const healthAlerts = createHealthAlerts(healthChecks);
  if (healthAlerts.length > 0) {
    const subject = await hashPrefix(healthAlerts.join("\n"));
    const seenAt = now.toISOString();
    drafts.push({
      kind: "health.degraded",
      subject,
      payload: alertPayload(env, {
        kind: "health.degraded",
        signature: await hashPrefix(`health.degraded:${subject}`),
        count: healthAlerts.length,
        message: healthAlerts.join("; "),
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        adminPath: "/admin",
      }),
    });
  }

  return drafts;
}

async function persistAlertDrafts(db: D1Database, drafts: AlertDraft[], now: Date) {
  if (drafts.length === 0) return;
  const createdAt = Math.floor(now.getTime() / 1_000);
  await db.batch(
    drafts.map((draft) => {
      const idempotencyKey = `${draft.kind}:${draft.subject}:${dateKey(now)}`;
      return db
        .prepare(
          `INSERT OR IGNORE INTO "platformAlert"
           ("id", "kind", "subject", "idempotencyKey", "payload", "status", "sentAt", "attempts", "createdAt")
           VALUES (?, ?, ?, ?, ?, 'pending', NULL, 0, ?)`
        )
        .bind(
          createId(),
          draft.kind,
          draft.subject,
          idempotencyKey,
          JSON.stringify(draft.payload),
          createdAt
        );
    })
  );
}

async function markDelivered(db: D1Database, alert: PendingAlert, now: Date) {
  const sentAt = Math.floor(now.getTime() / 1_000);
  await db
    .prepare(
      `UPDATE "platformAlert" SET "status" = 'sent', "sentAt" = ? WHERE "id" = ?`
    )
    .bind(sentAt, alert.id)
    .run();
  if (alert.kind === "error.new" || alert.kind === "error.spike") {
    await db
      .prepare(
        `UPDATE "errorEvent"
         SET "lastNotifiedAt" = ?, "notifiedCount" = "count"
         WHERE "signature" = ?`
      )
      .bind(sentAt, alert.subject)
      .run();
  }
}

export async function pushAlerts(
  env: AlertEnv,
  options: { fetchImpl?: typeof fetch; now?: Date } = {}
) {
  const webhookUrl = env.SAM_ALERT_WEBHOOK_URL?.trim();
  const webhookToken = env.SAM_ALERT_WEBHOOK_TOKEN?.trim();
  if (!webhookUrl || !webhookToken) {
    return { created: 0, attempted: 0, sent: 0 };
  }

  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const drafts = await collectAlertDrafts(env, now);
  await persistAlertDrafts(env.DB, drafts, now);

  const pendingResult = await env.DB
    .prepare(
      `SELECT "id", "kind", "subject", "idempotencyKey", "payload", "attempts"
       FROM "platformAlert"
       WHERE "status" = 'pending' AND "attempts" < 5
       ORDER BY "createdAt" ASC
       LIMIT 100`
    )
    .all<PendingAlert>();
  const pending = pendingResult.results ?? [];
  let attempted = 0;
  let sent = 0;

  for (const alert of pending) {
    const claimed = await env.DB
      .prepare(
        `UPDATE "platformAlert"
         SET "attempts" = "attempts" + 1
         WHERE "id" = ? AND "status" = 'pending' AND "attempts" = ? AND "attempts" < 5
         RETURNING "attempts"`
      )
      .bind(alert.id, alert.attempts)
      .first<{ attempts: number }>();
    if (!claimed) continue;
    attempted += 1;

    try {
      const response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${webhookToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": alert.idempotencyKey,
        },
        body: alert.payload,
        signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
      });
      if (response.status !== 202) continue;
      await markDelivered(env.DB, alert, now);
      sent += 1;
    } catch {
      // The row remains pending and the next cron retries it, up to five times.
    }
  }

  return { created: drafts.length, attempted, sent };
}
