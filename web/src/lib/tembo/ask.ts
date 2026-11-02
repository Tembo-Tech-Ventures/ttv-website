import { createId } from "@paralleldrive/cuid2";
import type { TemboUsage } from "@/lib/platform/contracts";
import { TEMBO_CONFIG } from "./config";
import { temboDay, usageOf } from "./quota";

/**
 * Accepting a question (README.md beside this file, "Asking"). One batch decides everything, so
 * concurrent asks of the same message (a mention and the Ask button, or a retry) cannot both run it,
 * and two questions cannot both take the last place in the allowance:
 *
 * 1. reclaim: a PENDING ask whose run went quiet for TEMBO_CONFIG.staleClaimMs (a Worker that died)
 *    is claimed again, without counting it again;
 * 2. accept: a new ask, or one whose run failed, is written PENDING under a fresh claim while the
 *    asker has questions left today and the message and its thread are still open;
 * 3. count: only an accepted ask counts against the allowance;
 * 4. read back what happened.
 *
 * The caller has already checked the flag, the channel, that the message is the caller's own and in
 * this channel, and that they may post here.
 */

export interface AskInput {
  messageId: string;
  channelId: string;
  userId: string;
  now: number;
}

export type AskOutcome =
  /** This request owns the run: generate an answer under `claim`. */
  | { status: "run"; claim: string; usage: TemboUsage }
  /** Another run is answering it. */
  | { status: "pending"; usage: TemboUsage }
  | { status: "answered"; answerId: string | null; usage: TemboUsage }
  /** No questions left today. */
  | { status: "quota"; usage: TemboUsage }
  /** The message or its thread was deleted or hidden meanwhile. */
  | { status: "closed"; usage: TemboUsage };

/** The asking message (?1) is open, and so is its thread's root. */
export const OPEN_QUESTION = `EXISTS (SELECT 1 FROM channel_message q WHERE q.id = ?1 AND q.deletedAt IS NULL AND q.moderationState <> 'HIDDEN'
  AND (q.parentId IS NULL OR EXISTS (SELECT 1 FROM channel_message r WHERE r.id = q.parentId AND r.channelId = q.channelId
    AND r.deletedAt IS NULL AND r.moderationState <> 'HIDDEN')))`;

interface AskRow { status: "PENDING" | "ANSWERED" | "FAILED" | null; claim: string | null; answerId: string | null; used: number | null }

export async function acceptAsk(db: D1Database, { messageId, channelId, userId, now }: AskInput): Promise<AskOutcome> {
  const day = temboDay(now);
  const counted = createId();
  const reclaimed = createId();
  // ?1 message, ?2 channel, ?3 asker, ?4 day, ?5 the counted claim, ?6 now, ?7 the daily limit, ?8 the reclaimed claim,
  // ?9 stale before. Each statement binds the parameters up to the highest it uses.
  const params = [messageId, channelId, userId, day, counted, now, TEMBO_CONFIG.dailyLimit, reclaimed, now - TEMBO_CONFIG.staleClaimMs];
  const [, , , state] = await db.batch([
    db.prepare(`UPDATE tembo_ask SET claim = ?8, claimedAt = ?6, updatedAt = max(updatedAt, ?6)
      WHERE messageId = ?1 AND status = 'PENDING' AND claimedAt < ?9 RETURNING claim`).bind(...params),
    db.prepare(`INSERT INTO tembo_ask (messageId, channelId, userId, day, status, claim, claimedAt, createdAt, updatedAt)
      SELECT ?1, ?2, ?3, ?4, 'PENDING', ?5, ?6, ?6, ?6
      WHERE coalesce((SELECT count FROM tembo_usage WHERE userId = ?3 AND day = ?4), 0) < ?7 AND ${OPEN_QUESTION}
      ON CONFLICT (messageId) DO UPDATE SET status = 'PENDING', claim = excluded.claim, day = excluded.day,
        claimedAt = excluded.claimedAt, updatedAt = max(tembo_ask.updatedAt, excluded.updatedAt)
      WHERE tembo_ask.status = 'FAILED' RETURNING claim`).bind(...params.slice(0, 7)),
    db.prepare(`INSERT INTO tembo_usage (userId, day, count) SELECT ?3, ?4, 1
      WHERE EXISTS (SELECT 1 FROM tembo_ask WHERE messageId = ?1 AND claim = ?5)
      ON CONFLICT (userId, day) DO UPDATE SET count = count + 1`).bind(...params.slice(0, 5)),
    db.prepare(`SELECT a.status, a.claim, a.answerId, (SELECT count FROM tembo_usage WHERE userId = ?3 AND day = ?4) AS used
      FROM (SELECT 1) LEFT JOIN tembo_ask a ON a.messageId = ?1`).bind(...params.slice(0, 4)),
  ]);
  const row = (state?.results as AskRow[] | undefined)?.[0];
  const usage = usageOf(row?.used ?? 0, now);
  if (row?.claim === counted || row?.claim === reclaimed) return { status: "run", claim: row.claim, usage };
  if (row?.status === "ANSWERED") return { status: "answered", answerId: row.answerId, usage };
  if (row?.status === "PENDING") return { status: "pending", usage };
  return usage.used >= usage.limit ? { status: "quota", usage } : { status: "closed", usage };
}

/**
 * A run that did not answer: the ask turns FAILED under a new claim (so a second call changes
 * nothing). With `refund`, the question is also given back to the asker's allowance for the day it
 * was counted: only when no model call was spent on it (closed before the run read it), or the run
 * itself failed (the model, a timeout, the database). A question its asker deleted, or a moderator
 * hid, while the model was answering keeps its count, so deleting a question can't buy another.
 * Nothing changes when the run no longer holds the claim. Returns whether it did.
 */
export async function failAsk(
  db: D1Database, { messageId, claim, now, refund }: { messageId: string; claim: string; now: number; refund: boolean },
): Promise<boolean> {
  const failed = createId();
  const [update] = await db.batch([
    db.prepare(`UPDATE tembo_ask SET status = 'FAILED', claim = ?3, updatedAt = max(updatedAt, ?4)
      WHERE messageId = ?1 AND claim = ?2 AND status = 'PENDING' RETURNING messageId`).bind(messageId, claim, failed, now),
    ...refund ? [db.prepare(`UPDATE tembo_usage SET count = count - 1 WHERE count > 0 AND (userId, day) IN
      (SELECT userId, day FROM tembo_ask WHERE messageId = ?1 AND claim = ?2)`).bind(messageId, failed)] : [],
  ]);
  return (update?.results.length ?? 0) === 1;
}
