import {
  isClosedFeedbackStatus,
  sanitizeFeedbackContext,
  type FeedbackAttachmentSource,
  type FeedbackAttachmentType,
  type FeedbackContext,
  type FeedbackKind,
  type FeedbackStatus,
} from "./model";

export interface FeedbackAttachmentRecord {
  id: string;
  contentType: FeedbackAttachmentType;
  size: number;
  source: FeedbackAttachmentSource;
  position: number;
}

export interface FeedbackRecord {
  id: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  message: string;
  pageUrl: string;
  pageTitle: string | null;
  context: FeedbackContext;
  appVersion: string | null;
  response: string | null;
  adminNote: string | null;
  resolutionUrl: string | null;
  user: { id: string; name: string; email: string };
  handledBy: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  attachments: FeedbackAttachmentRecord[];
}

export interface NewFeedbackAttachment extends FeedbackAttachmentRecord {
  objectKey: string;
}

export interface NewFeedback {
  id: string;
  userId: string;
  kind: FeedbackKind;
  message: string;
  pageUrl: string;
  pageTitle: string | null;
  context: FeedbackContext;
  appVersion: string | null;
  attachments: NewFeedbackAttachment[];
}

export interface FeedbackPatch {
  status?: FeedbackStatus;
  response?: string | null;
  adminNote?: string | null;
  resolutionUrl?: string | null;
}

interface FeedbackRow {
  id: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  message: string;
  pageUrl: string;
  pageTitle: string | null;
  context: string;
  appVersion: string | null;
  response: string | null;
  adminNote: string | null;
  resolutionUrl: string | null;
  userId: string;
  userName: string;
  userEmail: string;
  handledById: string | null;
  handledByName: string | null;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

interface AttachmentRow extends FeedbackAttachmentRecord {
  feedbackId: string;
}

const FEEDBACK_SELECT = `
  SELECT f."id", f."kind", f."status", f."message", f."pageUrl", f."pageTitle",
         f."context", f."appVersion", f."response", f."adminNote",
         f."resolutionUrl", f."createdAt", f."updatedAt", f."resolvedAt",
         u."id" AS "userId", u."name" AS "userName", u."email" AS "userEmail",
         h."id" AS "handledById", h."name" AS "handledByName"
  FROM "feedback" f
  JOIN "user" u ON u."id" = f."userId"
  LEFT JOIN "user" h ON h."id" = f."handledById"`;

function toSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1_000);
}

function fromSeconds(value: number): Date {
  return new Date(Number(value) * 1_000);
}

function toRecord(row: FeedbackRow, attachments: AttachmentRow[]): FeedbackRecord {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    message: row.message,
    pageUrl: row.pageUrl,
    pageTitle: row.pageTitle,
    context: sanitizeFeedbackContext(row.context),
    appVersion: row.appVersion,
    response: row.response,
    adminNote: row.adminNote,
    resolutionUrl: row.resolutionUrl,
    user: { id: row.userId, name: row.userName, email: row.userEmail },
    handledBy:
      row.handledById && row.handledByName
        ? { id: row.handledById, name: row.handledByName }
        : null,
    createdAt: fromSeconds(row.createdAt),
    updatedAt: fromSeconds(row.updatedAt),
    resolvedAt: row.resolvedAt === null ? null : fromSeconds(row.resolvedAt),
    attachments: attachments
      .filter((attachment) => attachment.feedbackId === row.id)
      .toSorted((left, right) => left.position - right.position)
      .map(({ id, contentType, size, source, position }) => ({
        id,
        contentType,
        size,
        source,
        position,
      })),
  };
}

/** D1 rejects statements with more than 100 bound parameters. */
const D1_MAX_BOUND_PARAMETERS = 100;

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

async function attachmentsFor(
  db: D1Database,
  feedbackIds: string[]
): Promise<AttachmentRow[]> {
  const chunks: string[][] = [];
  for (let start = 0; start < feedbackIds.length; start += D1_MAX_BOUND_PARAMETERS) {
    chunks.push(feedbackIds.slice(start, start + D1_MAX_BOUND_PARAMETERS));
  }
  const results = await Promise.all(
    chunks.map((chunk) =>
      db
        .prepare(
          `SELECT "id", "feedbackId", "contentType", "size", "source", "position"
           FROM "feedback_attachment"
           WHERE "feedbackId" IN (${placeholders(chunk.length)})`
        )
        .bind(...chunk)
        .all<AttachmentRow>()
    )
  );
  return results.flatMap((result) => result.results);
}

async function withAttachments(
  db: D1Database,
  rows: FeedbackRow[]
): Promise<FeedbackRecord[]> {
  const attachments = await attachmentsFor(
    db,
    rows.map((row) => row.id)
  );
  return rows.map((row) => toRecord(row, attachments));
}

export async function countRecentFeedback(
  db: D1Database,
  userId: string,
  since: Date
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS "count" FROM "feedback"
       WHERE "userId" = ? AND "createdAt" >= ?`
    )
    .bind(userId, toSeconds(since))
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

/** Inserts the feedback and its attachment rows in one D1 transaction. */
export async function insertFeedback(
  db: D1Database,
  feedback: NewFeedback,
  now = new Date()
): Promise<void> {
  const nowSeconds = toSeconds(now);
  await db.batch([
    db
      .prepare(
        `INSERT INTO "feedback"
          ("id", "userId", "kind", "message", "pageUrl", "pageTitle", "context",
           "appVersion", "status", "createdAt", "updatedAt")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?)`
      )
      .bind(
        feedback.id,
        feedback.userId,
        feedback.kind,
        feedback.message,
        feedback.pageUrl,
        feedback.pageTitle,
        JSON.stringify(feedback.context),
        feedback.appVersion,
        nowSeconds,
        nowSeconds
      ),
    ...feedback.attachments.map((attachment) =>
      db
        .prepare(
          `INSERT INTO "feedback_attachment"
            ("id", "feedbackId", "objectKey", "contentType", "size", "source",
             "position", "createdAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          attachment.id,
          feedback.id,
          attachment.objectKey,
          attachment.contentType,
          attachment.size,
          attachment.source,
          attachment.position,
          nowSeconds
        )
    ),
  ]);
}

export interface ListFeedbackOptions {
  statuses: readonly FeedbackStatus[];
  kind?: FeedbackKind | null;
  limit?: number;
}

export async function listFeedback(
  db: D1Database,
  { statuses, kind = null, limit = 50 }: ListFeedbackOptions
): Promise<FeedbackRecord[]> {
  if (statuses.length === 0) return [];
  const boundedLimit = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
  const filters = [`f."status" IN (${placeholders(statuses.length)})`];
  const bindings: unknown[] = [...statuses];
  if (kind) {
    filters.push(`f."kind" = ?`);
    bindings.push(kind);
  }
  const result = await db
    .prepare(
      `${FEEDBACK_SELECT}
       WHERE ${filters.join(" AND ")}
       ORDER BY f."createdAt" DESC, f."id" DESC
       LIMIT ?`
    )
    .bind(...bindings, boundedLimit)
    .all<FeedbackRow>();
  return withAttachments(db, result.results);
}

export async function listFeedbackForUser(
  db: D1Database,
  userId: string,
  limit = 50
): Promise<FeedbackRecord[]> {
  const result = await db
    .prepare(
      `${FEEDBACK_SELECT}
       WHERE f."userId" = ?
       ORDER BY f."createdAt" DESC, f."id" DESC
       LIMIT ?`
    )
    .bind(userId, limit)
    .all<FeedbackRow>();
  return withAttachments(db, result.results);
}

export async function getFeedback(
  db: D1Database,
  id: string
): Promise<FeedbackRecord | null> {
  if (!id) return null;
  const row = await db
    .prepare(`${FEEDBACK_SELECT} WHERE f."id" = ? LIMIT 1`)
    .bind(id)
    .first<FeedbackRow>();
  if (!row) return null;
  const [record] = await withAttachments(db, [row]);
  return record ?? null;
}

export async function countFeedbackByStatus(
  db: D1Database
): Promise<Record<FeedbackStatus, number>> {
  const result = await db
    .prepare(
      `SELECT "status", COUNT(*) AS "count" FROM "feedback" GROUP BY "status"`
    )
    .all<{ status: FeedbackStatus; count: number }>();
  const counts: Record<FeedbackStatus, number> = {
    NEW: 0,
    IN_PROGRESS: 0,
    RESOLVED: 0,
    DECLINED: 0,
  };
  for (const row of result.results) counts[row.status] = Number(row.count);
  return counts;
}

export type UpdateFeedbackResult =
  | { outcome: "updated"; feedback: FeedbackRecord }
  | { outcome: "not-found" }
  | { outcome: "conflict"; feedback: FeedbackRecord };

/**
 * Applies a staff or agent update. `expectedStatus` makes the write
 * conditional, so two agents polling the same queue cannot both claim one
 * item: the second sees `conflict` and moves on.
 */
export async function updateFeedback(
  db: D1Database,
  id: string,
  patch: FeedbackPatch,
  {
    actorId,
    expectedStatus,
    now = new Date(),
  }: { actorId: string; expectedStatus?: FeedbackStatus; now?: Date }
): Promise<UpdateFeedbackResult> {
  const assignments = [`"handledById" = ?`, `"updatedAt" = ?`];
  const nowSeconds = toSeconds(now);
  const bindings: unknown[] = [actorId, nowSeconds];

  if (patch.status !== undefined) {
    assignments.push(`"status" = ?`);
    bindings.push(patch.status);
    if (isClosedFeedbackStatus(patch.status)) {
      // SET expressions read the pre-update row, so an item that was already
      // closed keeps its original resolution time.
      assignments.push(
        `"resolvedAt" = COALESCE(CASE WHEN "status" IN ('RESOLVED', 'DECLINED') THEN "resolvedAt" END, ?)`
      );
      bindings.push(nowSeconds);
    } else {
      assignments.push(`"resolvedAt" = NULL`);
    }
  }
  for (const column of ["response", "adminNote", "resolutionUrl"] as const) {
    if (patch[column] !== undefined) {
      assignments.push(`"${column}" = ?`);
      bindings.push(patch[column]);
    }
  }

  const conditions = [`"id" = ?`];
  bindings.push(id);
  if (expectedStatus) {
    conditions.push(`"status" = ?`);
    bindings.push(expectedStatus);
  }

  const result = await db
    .prepare(
      `UPDATE "feedback" SET ${assignments.join(", ")}
       WHERE ${conditions.join(" AND ")}`
    )
    .bind(...bindings)
    .run();

  const feedback = await getFeedback(db, id);
  if (!feedback) return { outcome: "not-found" };
  if ((result.meta.changes ?? 0) === 0) return { outcome: "conflict", feedback };
  return { outcome: "updated", feedback };
}

export interface FeedbackAttachmentObject {
  objectKey: string;
  contentType: FeedbackAttachmentType;
  ownerId: string;
}

export async function getFeedbackAttachmentObject(
  db: D1Database,
  attachmentId: string
): Promise<FeedbackAttachmentObject | null> {
  if (!attachmentId) return null;
  return db
    .prepare(
      `SELECT a."objectKey", a."contentType", f."userId" AS "ownerId"
       FROM "feedback_attachment" a
       JOIN "feedback" f ON f."id" = a."feedbackId"
       WHERE a."id" = ?
       LIMIT 1`
    )
    .bind(attachmentId)
    .first<FeedbackAttachmentObject>();
}
