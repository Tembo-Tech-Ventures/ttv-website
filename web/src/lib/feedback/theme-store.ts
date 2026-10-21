import { createId } from "@paralleldrive/cuid2";
import { retryTransientD1 } from "@/lib/db/d1-errors";
import type { FeedbackKind } from "./model";
import {
  THEME_AGREEMENT_WINDOW_DAYS,
  isClosedThemeStatus,
  type FeedbackThemeChange,
  type FeedbackThemeStatus,
} from "./themes";

export interface FeedbackThemeStats {
  notes: number;
  students: number;
  /** Distinct students inside the agreement window. */
  recentStudents: number;
  lastReportAt: Date | null;
}

export interface FeedbackThemeRecord {
  id: string;
  title: string;
  summary: string;
  kind: FeedbackKind;
  status: FeedbackThemeStatus;
  change: FeedbackThemeChange | null;
  issueUrl: string | null;
  prUrl: string | null;
  decisionNote: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  stats: FeedbackThemeStats;
}

export interface NewFeedbackTheme {
  title: string;
  summary: string;
  kind: FeedbackKind;
  change?: FeedbackThemeChange | null;
}

export interface FeedbackThemePatch {
  title?: string;
  summary?: string;
  kind?: FeedbackKind;
  status?: FeedbackThemeStatus;
  change?: FeedbackThemeChange | null;
  issueUrl?: string | null;
  prUrl?: string | null;
  decisionNote?: string | null;
}

interface ThemeRow {
  id: string;
  title: string;
  summary: string;
  kind: FeedbackKind;
  status: FeedbackThemeStatus;
  change: FeedbackThemeChange | null;
  issueUrl: string | null;
  prUrl: string | null;
  decisionNote: string | null;
  closedAt: number | null;
  createdAt: number;
  updatedAt: number;
  notes: number;
  students: number;
  recentStudents: number;
  lastReportAt: number | null;
}

const DAY_SECONDS = 24 * 60 * 60;

function toSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1_000);
}

function fromSeconds(value: number): Date {
  return new Date(Number(value) * 1_000);
}

/** Bindings: [windowStartSeconds]. Sensitive notes never count toward a theme. */
const THEME_SELECT = `
  SELECT t."id", t."title", t."summary", t."kind", t."status", t."change",
         t."issueUrl", t."prUrl", t."decisionNote", t."closedAt",
         t."createdAt", t."updatedAt",
         COUNT(f."id") AS "notes",
         COUNT(DISTINCT f."userId") AS "students",
         COUNT(DISTINCT CASE WHEN f."createdAt" >= ? THEN f."userId" END) AS "recentStudents",
         MAX(f."createdAt") AS "lastReportAt"
  FROM "feedback_theme" t
  LEFT JOIN "feedback" f ON f."themeId" = t."id" AND f."sensitive" = 0`;

function toRecord(row: ThemeRow): FeedbackThemeRecord {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    kind: row.kind,
    status: row.status,
    change: row.change,
    issueUrl: row.issueUrl,
    prUrl: row.prUrl,
    decisionNote: row.decisionNote,
    closedAt: row.closedAt === null ? null : fromSeconds(row.closedAt),
    createdAt: fromSeconds(row.createdAt),
    updatedAt: fromSeconds(row.updatedAt),
    stats: {
      notes: Number(row.notes),
      students: Number(row.students),
      recentStudents: Number(row.recentStudents),
      lastReportAt: row.lastReportAt === null ? null : fromSeconds(row.lastReportAt),
    },
  };
}

function windowStart(now: Date): number {
  return toSeconds(now) - THEME_AGREEMENT_WINDOW_DAYS * DAY_SECONDS;
}

export async function getTheme(
  db: D1Database,
  id: string,
  now = new Date()
): Promise<FeedbackThemeRecord | null> {
  if (!id) return null;
  const row = await db
    .prepare(`${THEME_SELECT} WHERE t."id" = ? GROUP BY t."id"`)
    .bind(windowStart(now), id)
    .first<ThemeRow>();
  return row ? toRecord(row) : null;
}

export async function listThemes(
  db: D1Database,
  { statuses, now = new Date() }: { statuses: readonly FeedbackThemeStatus[]; now?: Date }
): Promise<FeedbackThemeRecord[]> {
  if (statuses.length === 0) return [];
  const result = await db
    .prepare(
      `${THEME_SELECT}
       WHERE t."status" IN (${statuses.map(() => "?").join(", ")})
       GROUP BY t."id"
       ORDER BY "recentStudents" DESC, "lastReportAt" DESC, t."updatedAt" DESC`
    )
    .bind(windowStart(now), ...statuses)
    .all<ThemeRow>();
  return result.results.map(toRecord);
}

export async function createTheme(
  db: D1Database,
  theme: NewFeedbackTheme,
  { now = new Date(), newId = createId }: { now?: Date; newId?: () => string } = {}
): Promise<FeedbackThemeRecord> {
  const id = newId();
  const nowSeconds = toSeconds(now);
  await retryTransientD1(async (attempt) => {
    if (attempt > 1 && (await getTheme(db, id, now))) return;
    await db
      .prepare(
        `INSERT INTO "feedback_theme"
          ("id", "title", "summary", "kind", "status", "change", "createdAt", "updatedAt")
         VALUES (?, ?, ?, ?, 'COLLECTING', ?, ?, ?)`
      )
      .bind(id, theme.title, theme.summary, theme.kind, theme.change ?? null, nowSeconds, nowSeconds)
      .run();
  });
  const created = await getTheme(db, id, now);
  if (!created) throw new Error("Theme was not stored.");
  return created;
}

export interface ThemeUpdateOptions {
  actorId: string;
  /**
   * Written to every open note on the theme when it ships or is declined, so
   * each student gets an answer in the same step.
   */
  studentMessage?: string | null;
  now?: Date;
}

/**
 * Updates a theme. Shipping or declining it also closes every open note on it
 * in the same transaction: status, reply, link to the change and handler.
 */
export async function updateTheme(
  db: D1Database,
  id: string,
  patch: FeedbackThemePatch,
  { actorId, studentMessage = null, now = new Date() }: ThemeUpdateOptions
): Promise<FeedbackThemeRecord | null> {
  const existing = await getTheme(db, id, now);
  if (!existing) return null;

  const nowSeconds = toSeconds(now);
  const assignments = [`"updatedAt" = ?`];
  const bindings: unknown[] = [nowSeconds];
  for (const column of [
    "title",
    "summary",
    "kind",
    "status",
    "change",
    "issueUrl",
    "prUrl",
    "decisionNote",
  ] as const) {
    if (patch[column] !== undefined) {
      assignments.push(`"${column}" = ?`);
      bindings.push(patch[column]);
    }
  }
  const nextStatus = patch.status ?? existing.status;
  const closing = isClosedThemeStatus(nextStatus);
  if (patch.status !== undefined) {
    assignments.push(closing ? `"closedAt" = COALESCE("closedAt", ?)` : `"closedAt" = NULL`);
    if (closing) bindings.push(nowSeconds);
  }

  const statements = [
    db
      .prepare(`UPDATE "feedback_theme" SET ${assignments.join(", ")} WHERE "id" = ?`)
      .bind(...bindings, id),
  ];
  if (patch.status !== undefined && closing && !isClosedThemeStatus(existing.status)) {
    const link = patch.prUrl ?? existing.prUrl ?? patch.issueUrl ?? existing.issueUrl;
    statements.push(
      db
        .prepare(
          `UPDATE "feedback"
           SET "status" = ?, "resolvedAt" = ?, "updatedAt" = ?, "handledById" = ?,
               "response" = COALESCE(?, "response"),
               "resolutionUrl" = COALESCE("resolutionUrl", ?)
           WHERE "themeId" = ? AND "sensitive" = 0
             AND "status" IN ('NEW', 'IN_PROGRESS')`
        )
        .bind(
          nextStatus === "SHIPPED" ? "RESOLVED" : "DECLINED",
          nowSeconds,
          nowSeconds,
          actorId,
          studentMessage,
          link,
          id
        )
    );
  }
  // Both statements are idempotent, so a retried batch is safe.
  await retryTransientD1(() => db.batch(statements));
  return getTheme(db, id, now);
}

/** Notes on a theme, for synthesis. Sensitive notes are never returned. */
export async function listThemeNoteIds(db: D1Database, themeId: string): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT "id" FROM "feedback"
       WHERE "themeId" = ? AND "sensitive" = 0
       ORDER BY "createdAt" ASC`
    )
    .bind(themeId)
    .all<{ id: string }>();
  return result.results.map((row) => row.id);
}
