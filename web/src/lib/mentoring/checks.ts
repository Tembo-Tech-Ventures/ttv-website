import { ChannelError } from "@/lib/channels/errors";
import { askClef } from "@/lib/channels/moderation/clef";
import type {
  DecideMentorRequestCase, MentorRequest, MentorRequestCase, MentorRequestCaseList, MentorRequestCaseQuery, ReportMentorRequest,
} from "@/lib/platform/contracts";
import { personColumns, personRow, personSummary } from "./people";
import {
  ALREADY, decodeCursor, encodeCursor, getRequest, lostRace, notFound, partyRow, reasonsOf, REQUEST_COLUMNS, REQUEST_JOINS, toRequest,
  type MentoringContext, type RequestRow,
} from "./requests";
import { MENTOR_SEES } from "./visibility";

/**
 * Checks on mentor request notes (README.md beside this file, "Checks"). The detectors screen and
 * mask a note when it is written (requests.ts); after the response Clef reads it, and near-certain
 * abuse holds the request in a check before its mentor sees it. A mentor may also report a waiting
 * request. Either way an admin keeps it (it goes to the mentor) or removes it (it closes, never
 * sent). Every write checks its conditions inside the statement that makes it.
 */

/** Cases per page of the admin queue. */
export const CASE_PAGE_SIZE = 20;

export interface ClefHoldContext {
  db: D1Database;
  ai?: Pick<Ai, "run">;
  gatewayName?: string;
  timeoutMs?: number;
  now: number;
}

/** What Clef's read did: nothing left to check, nothing near-certain, a hold, or nothing to change. */
export type ClefHoldOutcome = "skipped" | "clear" | "held" | "unchanged";

/**
 * After a request is created: Clef reads its note, as a direct conversation's message (the attached
 * work is the asker's own published project, which its own check covers). Near-certain abuse opens a
 * check that holds the request, if it is still PENDING with that note and no check yet; anything less
 * changes nothing, as the detectors already masked contact details. Throws ClefCheckError when the
 * check fails; the caller logs it and the request stays as it is (fail open).
 */
export async function clefHold(ctx: ClefHoldContext, requestId: string): Promise<ClefHoldOutcome> {
  const open = `SELECT id, note FROM mentor_request r WHERE r.id = ?1 AND r.status = 'PENDING'
    AND NOT EXISTS (SELECT 1 FROM mentor_request_case c WHERE c.requestId = r.id)`;
  const request = await ctx.db.prepare(open).bind(requestId).first<{ id: string; note: string }>();
  if (!request) return "skipped";
  const verdict = await askClef(ctx.ai, ctx.gatewayName, { body: request.note, channelKind: "DIRECT" }, ctx.timeoutMs);
  if (!verdict.hide) return "clear";
  const held = await ctx.db.prepare(`INSERT INTO mentor_request_case (requestId, state, clefReasons, openedAt, createdAt, updatedAt)
    SELECT r.id, 'OPEN', ?3, ?4, ?4, ?4 FROM mentor_request r WHERE r.id = ?1 AND r.note = ?2 AND r.status = 'PENDING'
    ON CONFLICT (requestId) DO NOTHING RETURNING requestId`)
    .bind(requestId, request.note, JSON.stringify(verdict.reasons), ctx.now).all<{ requestId: string }>();
  return held.results.length === 1 ? "held" : "unchanged";
}

/**
 * POST /api/mentor-requests/:id/report: the mentor asked reports a waiting request's note. It closes
 * for them (they cannot act on it) and opens a check for the admins; one report per request. Refusals:
 * not a party, or a request Clef holds (404, as for a missing one); the person asking (403); no longer
 * PENDING, or already reported (409). Two statements in one batch: the report, then the check it
 * opens (or opens again after an admin kept it).
 */
export async function reportRequest(ctx: MentoringContext, id: string, input: ReportMentorRequest): Promise<MentorRequest> {
  const { db, viewerId, now } = ctx;
  const row = await partyRow(ctx, id);
  if (!row) throw notFound();
  if (row.mentorId !== viewerId) throw new ChannelError("forbidden", "Only the mentor asked can report this request.", 403);
  if (row.status !== "PENDING") throw new ChannelError("conflict", ALREADY[row.status], 409);
  if (row.reported) throw new ChannelError("conflict", "You already reported this request.", 409);
  const [reported] = await db.batch([
    db.prepare(`INSERT INTO mentor_request_report (requestId, reporterId, reason, createdAt)
      SELECT r.id, r.mentorId, ?3, ?4 FROM mentor_request r WHERE r.id = ?1 AND r.mentorId = ?2 AND r.status = 'PENDING' AND ${MENTOR_SEES("r")}
      ON CONFLICT (requestId) DO NOTHING RETURNING requestId`).bind(id, viewerId, input.reason, now),
    db.prepare(`INSERT INTO mentor_request_case (requestId, state, clefReasons, openedAt, createdAt, updatedAt)
      SELECT ?1, 'OPEN', '[]', ?2, ?2, ?2 WHERE EXISTS (SELECT 1 FROM mentor_request_report WHERE requestId = ?1 AND createdAt = ?2)
      ON CONFLICT (requestId) DO UPDATE SET state = 'OPEN', openedAt = excluded.openedAt, updatedAt = max(excluded.updatedAt, updatedAt)
        WHERE state = 'DECIDED' AND decision = 'KEEP'`).bind(id, now),
  ]);
  if (reported?.results.length !== 1) {
    throw await lostRace(ctx, id, () => new ChannelError("conflict", "You already reported this request.", 409));
  }
  return getRequest(ctx, id);
}

interface CaseRow extends RequestRow {
  clefReasons: string; openedAt: number; reportReason: string | null; reportedAt: number | null;
  decisionReason: string | null; decidedAt: number | null; decidedBy: string | null;
}

/** One check with its request, from mentor_request_case `c`: along its primary key or the queue index. */
const CASE_SELECT = `SELECT ${REQUEST_COLUMNS}, c.clefReasons, c.openedAt, c.decisionReason, c.decidedAt, c.decidedBy,
  rp.reason AS reportReason, rp.createdAt AS reportedAt, ${personColumns("du", "c.decidedBy", "decider")}
FROM mentor_request_case c JOIN mentor_request r ON r.id = c.requestId ${REQUEST_JOINS}
  LEFT JOIN "user" du ON du.id = c.decidedBy`;

function toCase(row: CaseRow, viewerId: string): MentorRequestCase {
  return {
    id: row.id, request: toRequest(row, viewerId, { admin: true }), state: row.caseState ?? "OPEN", clefReasons: reasonsOf(row.clefReasons),
    report: row.reportReason === null || row.reportedAt === null ? null : { reason: row.reportReason, reportedAt: row.reportedAt },
    openedAt: row.openedAt,
    decision: row.caseDecision === null || row.decisionReason === null || row.decidedAt === null ? null : {
      action: row.caseDecision === "KEEP" ? "keep" : "remove", reason: row.decisionReason, decidedAt: row.decidedAt,
      by: row.decidedBy === null ? null : personSummary(row.decidedBy, personRow(row, "decider")),
    },
  };
}

/** Admins only (403), for each case route: checked before the request body is read. */
export function requireAdmin(isAdmin: boolean) {
  if (!isAdmin) throw new ChannelError("forbidden", "Only admins can check request notes.", 403);
}

/**
 * GET /api/moderation/mentor-requests: admins only (403). The checks in one state (OPEN unless asked
 * for DECIDED), oldest opened first, CASE_PAGE_SIZE at a time. One statement, along
 * mentor_request_case_queue_idx.
 */
export async function listCases(ctx: MentoringContext, isAdmin: boolean, query: MentorRequestCaseQuery): Promise<MentorRequestCaseList> {
  requireAdmin(isAdmin);
  const [afterAt, afterId] = query.cursor === undefined ? [null, null] : decodeCursor(query.cursor);
  const { results } = await ctx.db.prepare(`${CASE_SELECT}
    WHERE c.state = ?1 AND (?2 IS NULL OR c.openedAt > ?2 OR (c.openedAt = ?2 AND c.requestId > ?3))
    ORDER BY c.openedAt, c.requestId LIMIT ?4`)
    .bind(query.state ?? "OPEN", afterAt, afterId, CASE_PAGE_SIZE + 1).all<CaseRow>();
  const page = results.slice(0, CASE_PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((row) => toCase(row, ctx.viewerId)),
    nextCursor: results.length > CASE_PAGE_SIZE && last ? encodeCursor(last.openedAt, last.id) : null,
  };
}

async function caseRow(ctx: MentoringContext, id: string): Promise<CaseRow | null> {
  return ctx.db.prepare(`${CASE_SELECT} WHERE c.requestId = ?1`).bind(id).first<CaseRow>();
}

/**
 * POST /api/moderation/mentor-requests/:id: an admin (403 otherwise) decides an open check (404 when
 * the request has none, 409 once decided), with a reason kept for the record. keep: the request goes
 * (back) to its mentor as it is, PENDING. remove: a waiting request closes as WITHDRAWN, never sent;
 * the person asking sees "not_sent". One batch: the decision, then the removal it allows.
 */
export async function decideCase(
  ctx: MentoringContext, isAdmin: boolean, id: string, input: DecideMentorRequestCase,
): Promise<MentorRequestCase> {
  requireAdmin(isAdmin);
  const { db, viewerId, now } = ctx;
  const decision = input.action === "keep" ? "KEEP" : "REMOVE";
  const [decided] = await db.batch([
    db.prepare(`UPDATE mentor_request_case SET state = 'DECIDED', decision = ?2, decisionReason = ?3, decidedBy = ?4,
        decidedAt = ?5, updatedAt = max(?5, updatedAt)
      WHERE requestId = ?1 AND state = 'OPEN' RETURNING requestId`).bind(id, decision, input.reason, viewerId, now),
    db.prepare(`UPDATE mentor_request SET status = 'WITHDRAWN', decidedAt = max(?2, createdAt), updatedAt = max(?2, createdAt)
      WHERE id = ?1 AND status = 'PENDING' AND EXISTS (SELECT 1 FROM mentor_request_case
        WHERE requestId = ?1 AND state = 'DECIDED' AND decision = 'REMOVE' AND decidedAt = ?2 AND decidedBy IS ?3)`).bind(id, now, viewerId),
  ]);
  const row = await caseRow(ctx, id);
  if (!row) throw new ChannelError("not_found", "This request has no check.", 404);
  if (decided?.results.length !== 1) throw new ChannelError("conflict", "An admin already decided this check.", 409);
  return toCase(row, viewerId);
}
