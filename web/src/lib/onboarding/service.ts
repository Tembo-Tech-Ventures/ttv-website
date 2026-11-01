import { createId } from "@paralleldrive/cuid2";
import {
  AccessRole, CreateAccessRequest, Intent, IntentSet, OnboardingState,
  type AccessRequestSummary, type ErrorCode, type InferredIntent, type OnboardingStage,
} from "@/lib/platform/contracts";

/**
 * Onboarding domain (README.md beside this file). Intents choose routing and copy only: nothing here
 * writes UserRoles, and capabilitiesFor never reads these tables. Timestamps are epoch
 * milliseconds. Callers own authentication, the browser-session rule and the onboarding flag.
 */

export const ACCESS_REQUEST_DAILY_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export type OnboardingErrorCode = Extract<ErrorCode, "not_found" | "conflict" | "rate_limited">;
export class OnboardingError extends Error {
  constructor(readonly code: OnboardingErrorCode, message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = "OnboardingError";
  }
}

interface SummaryRow {
  stage: "NEW" | "DONE" | null;
  intents: string;
  roles: string;
  memberFootprint: number;
}
type RequestRow = Omit<AccessRequestSummary, "seenAt"> & { seenAt: number | null };

const byOrder = <T extends string>(order: readonly T[]) => (a: T, b: T) => order.indexOf(a) - order.indexOf(b);

/**
 * One summary read and one request read. MEMBER is inferred only from an application or a student
 * profile: never from a cohort assignment (programRole holds only instructors, TAs and cohort mentors)
 * or from a community profile or journey, which mentors keep too.
 */
export async function getOnboardingState(db: D1Database, userId: string): Promise<OnboardingState> {
  const [summary, { results: requestRows }] = await Promise.all([
    db.prepare(`SELECT
        (SELECT stage FROM member_onboarding WHERE userId = ?1) AS stage,
        (SELECT json_group_array(intent) FROM member_intent WHERE userId = ?1) AS intents,
        (SELECT json_group_array(r.name) FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId
          WHERE ur.userId = ?1 AND r.name IN ('MENTOR', 'INSTITUTION')) AS roles,
        EXISTS (SELECT 1 FROM programApplication WHERE userId = ?1)
          OR EXISTS (SELECT 1 FROM studentProfile WHERE userId = ?1) AS memberFootprint`)
      .bind(userId).first<SummaryRow>(),
    // The latest request per role. decidedBy is deliberately never selected: requesters are not told who decided.
    db.prepare(`SELECT id, role, status, note, organisation, organisationRole, link, decisionMessage,
        createdAt, updatedAt, decidedAt, seenAt
      FROM (SELECT *, requesterSeenAt AS seenAt,
          row_number() OVER (PARTITION BY role ORDER BY createdAt DESC, rowid DESC) AS position
        FROM access_request WHERE userId = ?)
      WHERE position = 1`)
      .bind(userId).all<RequestRow>(),
  ]);
  if (!summary) throw new Error("Onboarding summary returned no row");

  const stage: OnboardingStage = summary.stage ?? "PROMPT";
  const intents = (JSON.parse(summary.intents) as Intent[]).toSorted(byOrder(Intent.options));
  const roles = [...new Set(JSON.parse(summary.roles) as AccessRole[])].toSorted(byOrder(AccessRole.options));
  const inferred: InferredIntent[] = intents.length > 0 ? [] : [
    ...(summary.memberFootprint ? ["MEMBER" as const] : []),
    ...roles,
  ];
  // Role state always wins: a request left pending beside a granted role is not shown.
  const requests = requestRows
    .filter((request) => request.status !== "PENDING" || !roles.includes(request.role))
    .toSorted((a, b) => byOrder(AccessRole.options)(a.role, b.role));
  return OnboardingState.parse({ stage, intents, inferred, requests, roles });
}

/** Approvals to announce once: still held, and neither visited nor dismissed. In preference order. */
export function unseenApprovals(state: OnboardingState): AccessRole[] {
  return state.requests
    .filter((request) => request.status === "APPROVED" && request.seenAt === null && state.roles.includes(request.role))
    .map((request) => request.role);
}

/**
 * Better Auth's user.create hook calls this while onboarding is open (signup.ts). Only these accounts are
 * NEW; an account without a row predates rollout and gets the one-time card instead.
 */
export async function startOnboarding(db: D1Database, userId: string, now = Date.now()): Promise<void> {
  await db.prepare(`INSERT OR IGNORE INTO member_onboarding (userId, stage, createdAt, updatedAt)
    VALUES (?1, 'NEW', ?2, ?2)`).bind(userId, now).run();
}

/**
 * Replaces the saved intents and completes onboarding. An empty choice is stored as EXPLORING, so
 * "nothing saved" always means "never chose" and inferred intents apply only then.
 */
export async function saveIntents(db: D1Database, userId: string, input: IntentSet, now = Date.now()): Promise<void> {
  const parsed = IntentSet.parse(input);
  const intents = JSON.stringify(parsed.length > 0 ? parsed : ["EXPLORING"]);
  await db.batch([
    db.prepare("DELETE FROM member_intent WHERE userId = ?1 AND intent NOT IN (SELECT value FROM json_each(?2))")
      .bind(userId, intents),
    db.prepare(`INSERT OR IGNORE INTO member_intent (userId, intent, createdAt)
      SELECT ?1, value, ?3 FROM json_each(?2)`).bind(userId, intents, now),
    db.prepare(`INSERT INTO member_onboarding (userId, stage, completedAt, createdAt, updatedAt)
      VALUES (?1, 'DONE', ?2, ?2, ?2)
      ON CONFLICT (userId) DO UPDATE SET stage = 'DONE', completedAt = coalesce(completedAt, excluded.completedAt),
        updatedAt = max(updatedAt, excluded.updatedAt)`).bind(userId, now),
  ]);
}

/** The one-time card's "Not now": it never returns, and nothing the person has changes. */
export async function dismissPrompt(db: D1Database, userId: string, now = Date.now()): Promise<void> {
  await db.prepare(`INSERT INTO member_onboarding (userId, stage, promptDismissedAt, createdAt, updatedAt)
    VALUES (?1, 'DONE', ?2, ?2, ?2)
    ON CONFLICT (userId) DO UPDATE SET stage = 'DONE', promptDismissedAt = coalesce(promptDismissedAt, excluded.promptDismissedAt),
      updatedAt = max(updatedAt, excluded.updatedAt)`).bind(userId, now).run();
}

const holdsRole = (userParam: string, roleParam: string) =>
  `EXISTS (SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId WHERE ur.userId = ${userParam} AND r.name = ${roleParam})`;
const isPendingConflict = (error: unknown) =>
  error instanceof Error && /UNIQUE constraint failed: access_request\.userId, access_request\.role/.test(error.message);

/**
 * Asks for a global role; an administrator decides (B-O.3). The request also records the matching
 * intent, replacing EXPLORING, so a withdrawal can remove it again. Refused while the role is held or
 * another request for it is pending, and after ACCESS_REQUEST_DAILY_LIMIT creations in 24 hours.
 * The insert re-checks both conditions itself, so concurrent requests cannot slip past them.
 */
export async function createAccessRequest(db: D1Database, userId: string, input: CreateAccessRequest, now = Date.now()): Promise<string> {
  const request = CreateAccessRequest.parse(input);
  const institution = request.role === "INSTITUTION" ? request : null;
  const id = createId();
  let results: D1Result[];
  try {
    results = await db.batch([
      db.prepare(`INSERT INTO access_request
          (id, userId, role, note, organisation, organisationRole, link, scopeAcknowledgedAt, createdAt, updatedAt)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9
        WHERE NOT ${holdsRole("?2", "?3")}
          AND (SELECT count(*) FROM access_request WHERE userId = ?2 AND createdAt > ?9 - ${DAY_MS}) < ${ACCESS_REQUEST_DAILY_LIMIT}`)
        .bind(id, userId, request.role, request.note, institution?.organisation ?? null, institution?.organisationRole ?? null,
          request.link, institution ? now : null, now),
      db.prepare(`INSERT OR IGNORE INTO member_intent (userId, intent, createdAt)
        SELECT userId, role, ?2 FROM access_request WHERE id = ?1`).bind(id, now),
      db.prepare(`DELETE FROM member_intent WHERE userId = ?2 AND intent = 'EXPLORING'
        AND EXISTS (SELECT 1 FROM access_request WHERE id = ?1)`).bind(id, userId),
    ]);
  } catch (error) {
    if (isPendingConflict(error)) throw new OnboardingError("conflict", "A request for this access is already pending.");
    throw error;
  }
  if (results[0].meta.changes === 1) return id;

  const refusal = await db.prepare(`SELECT ${holdsRole("?1", "?2")} AS held,
      (SELECT json_group_array(createdAt) FROM (SELECT createdAt FROM access_request
        WHERE userId = ?1 AND createdAt > ?3 - ${DAY_MS} ORDER BY createdAt)) AS recent`)
    .bind(userId, request.role, now).first<{ held: number; recent: string }>();
  if (refusal?.held) throw new OnboardingError("conflict", "This access is already granted.");
  const recent = JSON.parse(refusal?.recent ?? "[]") as number[];
  // A slot frees when enough of the last day's requests age out to drop below the limit.
  const freesAt = recent[recent.length - ACCESS_REQUEST_DAILY_LIMIT];
  // Neither reason holds any more (say, the role was removed in between): ask for a plain retry.
  if (freesAt === undefined) throw new OnboardingError("conflict", "Your access changed while sending. Try again.");
  throw new OnboardingError("rate_limited", "Too many requests today. Try again later.", Math.max(1, freesAt + DAY_MS - now));
}

async function refuseUnchanged(db: D1Database, userId: string, id: string, allowed: string): Promise<never> {
  const owned = await db.prepare("SELECT 1 FROM access_request WHERE id = ? AND userId = ?").bind(id, userId).first();
  // Someone else's request is reported exactly like a missing one.
  if (!owned) throw new OnboardingError("not_found", "Request not found.");
  throw new OnboardingError("conflict", `Only ${allowed} requests can do that.`);
}

/**
 * The owner withdraws a pending request; the matching intent goes with it. When that empties a
 * completed onboarding, the person reads as exploring again rather than as never having chosen.
 * The later statements key on this call's own withdrawalId, so a replay never removes an intent the
 * person has added again since, whatever the clock says.
 */
export async function withdrawAccessRequest(db: D1Database, userId: string, id: string, now = Date.now()): Promise<void> {
  const withdrawalId = createId();
  const withdrawn = "SELECT role FROM access_request WHERE id = ?2 AND userId = ?1 AND withdrawalId = ?4";
  const [update] = await db.batch([
    db.prepare(`UPDATE access_request SET status = 'WITHDRAWN', withdrawalId = ?4, updatedAt = max(updatedAt, ?3)
      WHERE id = ?2 AND userId = ?1 AND status = 'PENDING'`).bind(userId, id, now, withdrawalId),
    db.prepare(`DELETE FROM member_intent WHERE userId = ?1 AND intent = (${withdrawn})`).bind(userId, id, now, withdrawalId),
    db.prepare(`INSERT OR IGNORE INTO member_intent (userId, intent, createdAt)
      SELECT ?1, 'EXPLORING', ?3 WHERE EXISTS (${withdrawn})
        AND EXISTS (SELECT 1 FROM member_onboarding WHERE userId = ?1 AND completedAt IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM member_intent WHERE userId = ?1)`).bind(userId, id, now, withdrawalId),
  ]);
  if (update.meta.changes !== 1) await refuseUnchanged(db, userId, id, "pending");
}

/**
 * Marks a decision as seen, so its card and the one-time preference stop. By id when the person
 * dismisses the card (idempotent), or by role when they visit the space it opened.
 */
export async function markAccessRequestSeen(
  db: D1Database, userId: string, target: { id: string } | { role: AccessRole }, now = Date.now(),
): Promise<void> {
  if ("role" in target) {
    await db.prepare(`UPDATE access_request SET requesterSeenAt = ?3, updatedAt = max(updatedAt, ?3)
      WHERE userId = ?1 AND role = ?2 AND status IN ('APPROVED', 'DECLINED') AND requesterSeenAt IS NULL`)
      .bind(userId, AccessRole.parse(target.role), now).run();
    return;
  }
  const { meta } = await db.prepare(`UPDATE access_request SET requesterSeenAt = coalesce(requesterSeenAt, ?3),
      updatedAt = CASE WHEN requesterSeenAt IS NULL THEN max(updatedAt, ?3) ELSE updatedAt END
    WHERE id = ?2 AND userId = ?1 AND status IN ('APPROVED', 'DECLINED')`).bind(userId, target.id, now).run();
  if (meta.changes !== 1) await refuseUnchanged(db, userId, target.id, "approved or declined");
}
