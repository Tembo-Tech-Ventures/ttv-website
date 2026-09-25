import { createId } from "@paralleldrive/cuid2";

export const MAX_ACTIVE_ERROR_SIGNATURES = 500;
export const ACTIVE_ERROR_WINDOW_SECONDS = 24 * 60 * 60;

export type ErrorSource = "request" | "queue" | "cron" | "import" | "pipeline";
export type ErrorLevel = "error" | "warning";

export interface RecordErrorInput {
  source: ErrorSource;
  route: string;
  error: unknown;
  version?: string;
  level?: ErrorLevel;
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUID_SEGMENT = /^[a-z][a-z0-9]{23,31}$/i;
const HEX_ID_SEGMENT = /^[0-9a-f]{16,64}$/i;
const NUMBER_SEGMENT = /^\d+$/;

function isIdentifierSegment(segment: string) {
  return (
    UUID_SEGMENT.test(segment) ||
    CUID_SEGMENT.test(segment) ||
    HEX_ID_SEGMENT.test(segment) ||
    NUMBER_SEGMENT.test(segment)
  );
}

function collapseRouteSegment(segment: string) {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Preserve malformed path segments rather than failing error capture.
  }
  if (isIdentifierSegment(decoded)) return ":id";
  if (redactErrorMessage(decoded) !== decoded) return ":redacted";
  return segment;
}

export function collapseRoutePattern(route: string) {
  const trimmed = route.trim();
  let pathname = trimmed;
  try {
    if (/^https?:\/\//i.test(trimmed)) pathname = new URL(trimmed).pathname;
  } catch {
    // Fall back to treating the value as a path.
  }
  pathname = pathname.split(/[?#]/, 1)[0] || "/";

  return pathname
    .split("/")
    .map(collapseRouteSegment)
    .join("/");
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

export function redactErrorMessage(value: unknown) {
  let message = errorMessage(value);

  message = message.replace(/\bbearer\s+[^\s,;]+/gi, "Bearer [REDACTED]");
  message = message.replace(
    /\b(?:sam_wh|ttv_pat|gh[opsu]|sk)[_-][a-z0-9._-]+/gi,
    "[REDACTED]"
  );
  message = message.replace(
    /\b(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
    (_match, key: string, separator: string) => `${key}${separator}[REDACTED]`
  );
  message = message.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "[EMAIL]"
  );
  message = message.replace(
    /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g,
    "[IP]"
  );
  message = message.replace(
    /\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/gi,
    "[IP]"
  );
  message = message.replace(
    /((?:https?:\/\/|\/)[^\s?#]+)\?[^\s#]*/gi,
    "$1?[QUERY]"
  );

  return message.slice(0, 500);
}

function normalizeErrorMessage(value: unknown) {
  return redactErrorMessage(value)
    .toLowerCase()
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      ":id"
    )
    .replace(/\b[a-z][a-z0-9]{23,31}\b/gi, ":id")
    .replace(/\b[0-9a-f]{16,64}\b/gi, ":id")
    .replace(/\b\d+\b/g, ":number")
    .replace(/\s+/g, " ")
    .trim();
}

export async function createErrorSignature({
  source,
  route,
  error,
}: Pick<RecordErrorInput, "source" | "route" | "error">) {
  const value = `${source}\n${collapseRoutePattern(route)}\n${normalizeErrorMessage(error)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function reportLedgerFailure(error: unknown) {
  try {
    console.error("Unable to record observability error:", redactErrorMessage(error));
  } catch {
    // Error recording must never change request, queue, or cron behavior.
  }
}

export async function recordError(
  db: D1Database,
  input: RecordErrorInput,
  now = new Date()
): Promise<string | null> {
  try {
    const route = collapseRoutePattern(input.route);
    const message = redactErrorMessage(input.error);
    const signature = await createErrorSignature({ ...input, route });
    const seenAt = Math.floor(now.getTime() / 1_000);
    const version = input.version?.trim() || "unknown";
    const level = input.level ?? "error";

    const existing = await db
      .prepare(
        `UPDATE "errorEvent"
         SET "count" = "count" + 1,
             "lastSeenAt" = ?,
             "lastVersion" = ?,
             "message" = ?,
             "level" = ?
         WHERE "signature" = ?
         RETURNING "id"`
      )
      .bind(seenAt, version, message, level, signature)
      .first<{ id: string }>();
    if (existing) return signature;

    const activeSince = seenAt - ACTIVE_ERROR_WINDOW_SECONDS;
    const active = await db
      .prepare(
        `SELECT COUNT(*) AS "count"
         FROM "errorEvent"
         WHERE "lastSeenAt" >= ?`
      )
      .bind(activeSince)
      .first<{ count: number }>();
    if (Number(active?.count ?? 0) >= MAX_ACTIVE_ERROR_SIGNATURES) return null;

    await db
      .prepare(
        `INSERT INTO "errorEvent"
         ("id", "signature", "source", "route", "message", "level", "count",
          "firstSeenAt", "lastSeenAt", "lastVersion", "lastNotifiedAt", "notifiedCount")
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, 0)
         ON CONFLICT("signature") DO UPDATE SET
           "count" = "errorEvent"."count" + 1,
           "lastSeenAt" = excluded."lastSeenAt",
           "lastVersion" = excluded."lastVersion",
           "message" = excluded."message",
           "level" = excluded."level"`
      )
      .bind(
        createId(),
        signature,
        input.source,
        route,
        message,
        level,
        seenAt,
        seenAt,
        version
      )
      .run();

    return signature;
  } catch (error) {
    reportLedgerFailure(error);
    return null;
  }
}
