import { retryTransientD1 } from "@/lib/db/d1-errors";
import type { FeedbackThemeStatus } from "./themes";
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
  /** Personal content: never on a theme, never summarised publicly. */
  sensitive: boolean;
  theme: FeedbackNoteTheme | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  attachments: FeedbackAttachmentRecord[];
}

/** The slice of a theme a note carries: enough to show a student where it stands. */
export interface FeedbackNoteTheme {
  id: string;
  title: string;
  status: FeedbackThemeStatus;
  issueUrl: string | null;
  /** Distinct students on the theme, this one included. */
  students: number;
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
  /** Attach to a theme, or `null` to detach. */
  themeId?: string | null;
  sensitive?: boolean;
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
  sensitive: number;
  themeId: string | null;
  themeTitle: string | null;
  themeStatus: FeedbackThemeStatus | null;
  themeIssueUrl: string | null;
  themeStudents: number | null;
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
         h."id" AS "handledById", h."name" AS "handledByName",
         f."sensitive", f."themeId", t."title" AS "themeTitle",
         t."status" AS "themeStatus", t."issueUrl" AS "themeIssueUrl",
         (SELECT COUNT(DISTINCT x."userId") FROM "feedback" x
          WHERE x."themeId" = f."themeId" AND x."sensitive" = 0) AS "themeStudents"
  FROM "feedback" f
  JOIN "user" u ON u."id" = f."userId"
  LEFT JOIN "user" h ON h."id" = f."handledById"
  LEFT JOIN "feedback_theme" t ON t."id" = f."themeId"`;

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
    sensitive: Boolean(row.sensitive),
    theme:
      row.themeId && row.themeTitle && row.themeStatus
        ? {
            id: row.themeId,
            title: row.themeTitle,
            status: row.themeStatus,
            issueUrl: row.themeIssueUrl,
            students: Number(row.themeStudents ?? 0),
          }
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

async function feedbackExists(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS "found" FROM "feedback" WHERE "id" = ? LIMIT 1`)
    .bind(id)
    .first();
  return row !== null;
}

/**
 * Inserts the feedback and its attachment rows in one D1 transaction,
 * retrying a dropped connection. The batch is all-or-nothing, so if the
 * feedback row exists the earlier attempt landed and there is nothing to redo.
 */
export async function insertFeedback(
  db: D1Database,
  feedback: NewFeedback,
  now = new Date()
): Promise<void> {
  await retryTransientD1(async (attempt) => {
    if (attempt > 1 && (await feedbackExists(db, feedback.id))) return;
    await insertFeedbackBatch(db, feedback, now);
  });
}

async function insertFeedbackBatch(
  db: D1Database,
  feedback: NewFeedback,
  now: Date
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
  /** Only notes nobody has sorted yet: no theme and not marked sensitive. */
  untriaged?: boolean;
  themeId?: string | null;
  limit?: number;
}

export async function listFeedback(
  db: D1Database,
  { statuses, kind = null, untriaged = false, themeId = null, limit = 50 }: ListFeedbackOptions
): Promise<FeedbackRecord[]> {
  if (statuses.length === 0) return [];
  const boundedLimit = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
  const filters = [`f."status" IN (${placeholders(statuses.length)})`];
  const bindings: unknown[] = [...statuses];
  if (kind) {
    filters.push(`f."kind" = ?`);
    bindings.push(kind);
  }
  if (untriaged) filters.push(`f."themeId" IS NULL AND f."sensitive" = 0`);
  if (themeId) {
    filters.push(`f."themeId" = ?`);
    bindings.push(themeId);
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
  | { outcome: "conflict"; feedback: FeedbackRecord }
  | { outcome: "invalid"; message: string };

async function themeExists(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS "found" FROM "feedback_theme" WHERE "id" = ? LIMIT 1`)
    .bind(id)
    .first();
  return row !== null;
}

/**
 * Theme membership rules: a sensitive note is never on a theme, and marking a
 * note sensitive takes it off its theme in the same write.
 */
async function validateThemeChange(
  db: D1Database,
  id: string,
  patch: FeedbackPatch
): Promise<string | null> {
  if (typeof patch.themeId !== "string") return null;
  if (patch.sensitive === true) {
    return "A sensitive note cannot be attached to a theme.";
  }
  if (!(await themeExists(db, patch.themeId))) return "That theme does not exist.";
  if (patch.sensitive === undefined) {
    const note = await db
      .prepare(`SELECT "sensitive" FROM "feedback" WHERE "id" = ? LIMIT 1`)
      .bind(id)
      .first<{ sensitive: number }>();
    if (note?.sensitive) return "A sensitive note cannot be attached to a theme.";
  }
  return null;
}

/** The SET clause for a note update. Only fields present in the patch change. */
function buildAssignments(patch: FeedbackPatch, actorId: string, nowSeconds: number) {
  const assignments = [`"handledById" = ?`, `"updatedAt" = ?`];
  const bindings: unknown[] = [actorId, nowSeconds];

  if (patch.sensitive !== undefined) {
    assignments.push(`"sensitive" = ?`);
    bindings.push(patch.sensitive ? 1 : 0);
    if (patch.sensitive) assignments.push(`"themeId" = NULL`);
  }
  if (patch.themeId !== undefined && !patch.sensitive) {
    assignments.push(`"themeId" = ?`);
    bindings.push(patch.themeId);
  }
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
  return { assignments, bindings };
}

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
  const invalid = await validateThemeChange(db, id, patch);
  if (invalid) return { outcome: "invalid", message: invalid };

  const nowSeconds = toSeconds(now);
  const { assignments, bindings } = buildAssignments(patch, actorId, nowSeconds);

  const conditions = [`"id" = ?`];
  bindings.push(id);
  if (expectedStatus) {
    conditions.push(`"status" = ?`);
    bindings.push(expectedStatus);
  }

  const statement = db
    .prepare(
      `UPDATE "feedback" SET ${assignments.join(", ")}
       WHERE ${conditions.join(" AND ")}`
    )
    .bind(...bindings);
  const { changes, attempts } = await retryTransientD1(async (attempt) => {
    const result = await statement.run();
    return { changes: result.meta.changes ?? 0, attempts: attempt };
  });

  const feedback = await getFeedback(db, id);
  if (!feedback) return { outcome: "not-found" };
  if (changes === 0) {
    // A conditional write retried after a dropped connection finds its own
    // earlier success; it carries this actor and this exact timestamp.
    const ownEarlierWrite =
      attempts > 1 &&
      feedback.handledBy?.id === actorId &&
      toSeconds(feedback.updatedAt) === nowSeconds &&
      (patch.status === undefined || feedback.status === patch.status);
    if (!ownEarlierWrite) return { outcome: "conflict", feedback };
  }
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
