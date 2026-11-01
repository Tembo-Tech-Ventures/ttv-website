import { redactErrorMessage } from "@/lib/observability/errors";
import { FEEDBACK_KIND_LABELS, type FeedbackKind } from "@/lib/feedback/model";

export interface AdminAttentionItem {
  id: string;
  title: string;
  detail: string;
  href: string;
  occurredAt: string;
}

export interface AdminAttentionGroup {
  id:
    | "access-requests"
    | "new-feedback"
    | "failed-recordings"
    | "import-errors"
    | "error-signatures"
    | "pending-projects"
    | "stale-contacts";
  label: string;
  items: AdminAttentionItem[];
}

interface FailedRecordingRow {
  id: string;
  title: string;
  processingError: string | null;
  updatedAt: number;
}

interface ImportErrorRow {
  id: string;
  name: string;
  lastError: string;
  updatedAt: number;
}

interface ErrorSignatureRow {
  signature: string;
  source: string;
  route: string;
  count: number;
  lastSeenAt: number;
}

interface PendingProjectRow {
  id: string;
  title: string;
  organization: string;
  createdAt: number;
}

interface NewFeedbackRow {
  id: string;
  kind: FeedbackKind;
  message: string;
  userName: string;
  createdAt: number;
}

interface AccessRequestRow {
  id: string;
  role: "MENTOR" | "INSTITUTION";
  organisation: string | null;
  userName: string;
  createdAt: number;
}

const ACCESS_ROLE_LABELS: Record<AccessRequestRow["role"], string> = {
  MENTOR: "Mentor",
  INSTITUTION: "Institution",
};

interface StaleContactRow {
  id: string;
  profileId: string;
  fromName: string;
  profileName: string;
  createdAt: number;
}

function rows<T>(result: D1Result<unknown> | undefined) {
  return (result?.results ?? []) as T[];
}

function iso(seconds: number) {
  return new Date(Number(seconds) * 1_000).toISOString();
}

function summarizeFeedback(message: string) {
  const text = message.replace(/\s+/g, " ").trim();
  if (!text) return "Screenshot only";
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

export async function getAdminAttention(
  db: D1Database,
  now = new Date()
): Promise<AdminAttentionGroup[]> {
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const threeDaysAgo = nowSeconds - 3 * 24 * 60 * 60;
  const sevenDaysAgo = nowSeconds - 7 * 24 * 60 * 60;
  const results = await db.batch([
    db.prepare(
      `SELECT "id", "title", "processingError", "updatedAt"
       FROM "recording"
       WHERE "processingStatus" = 'failed'
       ORDER BY "updatedAt" DESC
       LIMIT 10`
    ),
    db.prepare(
      `SELECT "id", "name", "lastError", "updatedAt"
       FROM "recording_import_source"
       WHERE "lastError" IS NOT NULL AND trim("lastError") <> ''
       ORDER BY "updatedAt" DESC
       LIMIT 10`
    ),
    db
      .prepare(
        `SELECT "signature", "source", "route", "count", "lastSeenAt"
         FROM "errorEvent"
         WHERE "lastSeenAt" >= ?
         ORDER BY "count" DESC, "lastSeenAt" DESC
         LIMIT 10`
      )
      .bind(sevenDaysAgo),
    db
      .prepare(
        `SELECT "id", "title", "organization", "createdAt"
         FROM "clientProject"
         WHERE "status" = 'PENDING' AND "createdAt" < ?
         ORDER BY "createdAt" ASC
         LIMIT 10`
      )
      .bind(threeDaysAgo),
    db
      .prepare(
        `SELECT c."id", c."profileId", c."fromName", c."createdAt",
                u."name" AS "profileName"
         FROM "profileContact" AS c
         JOIN "studentProfile" AS p ON p."id" = c."profileId"
         JOIN "user" AS u ON u."id" = p."userId"
         WHERE c."status" = 'NEW' AND c."createdAt" < ?
         ORDER BY c."createdAt" ASC
         LIMIT 10`
      )
      .bind(sevenDaysAgo),
    db.prepare(
      `SELECT f."id", f."kind", f."message", f."createdAt", u."name" AS "userName"
       FROM "feedback" AS f
       JOIN "user" AS u ON u."id" = f."userId"
       WHERE f."status" = 'NEW'
       ORDER BY f."createdAt" ASC
       LIMIT 10`
    ),
    // Epoch milliseconds, unlike the other sources. Uses the (status, createdAt) queue index.
    db.prepare(
      `SELECT a."id", a."role", a."organisation", a."createdAt", u."name" AS "userName"
       FROM "access_request" AS a
       JOIN "user" AS u ON u."id" = a."userId"
       WHERE a."status" = 'PENDING'
       ORDER BY a."createdAt" ASC
       LIMIT 10`
    ),
  ]);

  return [
    {
      id: "access-requests",
      label: "Access requests",
      // The note is the requester's own words, so it stays in the queue.
      items: rows<AccessRequestRow>(results[6]).map((row) => ({
        id: row.id,
        title: `${ACCESS_ROLE_LABELS[row.role]} access for ${row.userName.trim() || "a member"}`,
        detail: row.organisation ?? "Waiting for a decision",
        href: "/admin/access-requests",
        occurredAt: new Date(Number(row.createdAt)).toISOString(),
      })),
    },
    {
      id: "new-feedback",
      label: "New student feedback",
      items: rows<NewFeedbackRow>(results[5]).map((row) => ({
        id: row.id,
        title: `${FEEDBACK_KIND_LABELS[row.kind]} from ${row.userName}`,
        detail: summarizeFeedback(row.message),
        href: `/admin/feedback/${encodeURIComponent(row.id)}`,
        occurredAt: iso(row.createdAt),
      })),
    },
    {
      id: "failed-recordings",
      label: "Failed recordings",
      items: rows<FailedRecordingRow>(results[0]).map((row) => ({
        id: row.id,
        title: row.title,
        detail: redactErrorMessage(row.processingError || "Processing failed"),
        href: `/admin/recordings/${encodeURIComponent(row.id)}`,
        occurredAt: iso(row.updatedAt),
      })),
    },
    {
      id: "import-errors",
      label: "Recording import errors",
      items: rows<ImportErrorRow>(results[1]).map((row) => ({
        id: row.id,
        title: row.name,
        detail: redactErrorMessage(row.lastError),
        href: "/admin/recordings/import",
        occurredAt: iso(row.updatedAt),
      })),
    },
    {
      id: "error-signatures",
      label: "Top error signatures (7 days)",
      items: rows<ErrorSignatureRow>(results[2]).map((row) => ({
        id: row.signature,
        title: `${row.source} · ${row.route}`,
        detail: `${row.count} occurrence${row.count === 1 ? "" : "s"}`,
        href: "/admin#attention-error-signatures",
        occurredAt: iso(row.lastSeenAt),
      })),
    },
    {
      id: "pending-projects",
      label: "Pending client projects (over 3 days)",
      items: rows<PendingProjectRow>(results[3]).map((row) => ({
        id: row.id,
        title: row.title,
        detail: row.organization,
        href: `/admin/projects/${encodeURIComponent(row.id)}`,
        occurredAt: iso(row.createdAt),
      })),
    },
    {
      id: "stale-contacts",
      label: "New contact notes (over 7 days)",
      items: rows<StaleContactRow>(results[4]).map((row) => ({
        id: row.id,
        title: `Contact from ${row.fromName}`,
        detail: `For ${row.profileName}`,
        href: `/admin/profiles/${encodeURIComponent(row.profileId)}`,
        occurredAt: iso(row.createdAt),
      })),
    },
  ];
}
