import type { CallProvider } from "./provider";
import {
  EMPTY_ROOM_END_MINUTES, NO_HOST_END_MINUTES, NOBODY_CAME_END_MINUTES,
  type MeetingEndReason, type MeetingPurpose, type MeetingSeatRole, type MeetingSeatState, type MeetingState,
} from "./rules";

/**
 * The call state machine (README.md beside this file, "The clock"): SCHEDULED → LIVE → ENDED, or
 * SCHEDULED → CANCELLED. Every step is one conditional write, so running it twice, or from two
 * requests at once, changes nothing the second time, and an ended or cancelled call never moves
 * again. The routes and (from slice P4) the every-minute clock both call advanceMeeting; nothing about
 * a call's end is decided in the browser.
 */

export const MINUTE_MS = 60_000;

/** Everything a step needs: the database, the provider (null where calls have none), and the time. */
export interface CallContext {
  db: D1Database;
  provider: CallProvider | null;
  now: number;
}

/** Purposes with hosts distinct from members: they end when no host has been in for a while. */
const HOSTED: ReadonlySet<MeetingPurpose> = new Set(["SESSION", "EVENT"]);
/** Recordings that exist, or may: a call that has one keeps its consent answers. */
const RECORDED = "('STARTING', 'RECORDING', 'STOPPED', 'PROMOTED')";

/** What the clock reads of a call: its state and times, and every seat it has had (seats go when it ends). */
export interface MeetingClock {
  purpose: MeetingPurpose;
  state: MeetingState;
  openedAt: number | null;
  hardEndAt: number | null;
  limitMinutes: number;
  seats: readonly { role: MeetingSeatRole; state: MeetingSeatState; updatedAt: number }[];
}

/**
 * Why a live call must end at `now`, or null. In order: its limit (a check-in's before both people are
 * in falls back to its limit from opening, which "nobody came" always reaches first); an empty room;
 * no host in a session or an event; the second person never coming to a call between two people.
 */
export function dueEnd(call: MeetingClock, now: number): MeetingEndReason | null {
  if (call.state !== "LIVE" || call.openedAt === null) return null;
  const { openedAt, seats } = call;
  if (now >= (call.hardEndAt ?? openedAt + call.limitMinutes * MINUTE_MS)) return "LIMIT";
  const held = seats.filter(({ state }) => state === "HELD");
  // A seat that is not held changed last when its person left or was removed.
  const since = (rows: MeetingClock["seats"]) => Math.max(openedAt, ...rows.map(({ updatedAt }) => updatedAt));
  if (held.length === 0 && now - since(seats) >= EMPTY_ROOM_END_MINUTES * MINUTE_MS) return "EMPTY";
  if (HOSTED.has(call.purpose)) {
    const hostGone = !held.some(({ role }) => role === "HOST");
    if (hostGone && now - since(seats.filter(({ role }) => role === "HOST")) >= NO_HOST_END_MINUTES * MINUTE_MS) return "NO_HOST";
  } else if (seats.length < 2 && now - openedAt >= NOBODY_CAME_END_MINUTES * MINUTE_MS) {
    return "NOBODY_CAME";
  }
  return null;
}

/** The call and its seats, in one round trip. Null when there is no such call. */
export async function readClock(db: D1Database, meetingId: string): Promise<MeetingClock | null> {
  const [calls, seats] = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT purpose, state, openedAt, hardEndAt, limitMinutes FROM meeting WHERE id = ?1").bind(meetingId),
    db.prepare("SELECT role, state, updatedAt FROM meeting_seat WHERE meetingId = ?1").bind(meetingId),
  ]);
  const call = calls.results[0] as Omit<MeetingClock, "seats"> | undefined;
  return call ? { ...call, seats: seats.results as unknown as MeetingClock["seats"] } : null;
}

/**
 * Applies whatever the clock says is due: ends a live call at its limit, with nobody in it, with no
 * host, or when the other person never came. Returns the call's state afterwards, or null when there
 * is no such call. Safe to call at any time, as often as wanted.
 */
export async function advanceMeeting(ctx: CallContext, meetingId: string): Promise<MeetingState | null> {
  const clock = await readClock(ctx.db, meetingId);
  if (!clock) return null;
  const reason = dueEnd(clock, ctx.now);
  return reason ? endMeeting(ctx, meetingId, reason) : clock.state;
}

function requireProvider(ctx: CallContext): CallProvider {
  if (!ctx.provider) throw new Error("Calls have no provider here.");
  return ctx.provider;
}

/**
 * Opens a scheduled call: makes its provider meeting, then marks it live with its hard end (a
 * check-in's waits until both people are in). True when this request opened it; false when it was
 * already open, or was cancelled meanwhile. If two hosts open at once, the loser's provider meeting is
 * never used (provider meetings can't be deleted, and an unused one costs nothing).
 */
export async function openMeeting(ctx: CallContext, meetingId: string, title: string): Promise<boolean> {
  const { providerMeetingId } = await requireProvider(ctx).createMeeting({ title });
  const opened = await ctx.db.prepare(`UPDATE meeting SET state = 'LIVE', openedAt = ?2, providerMeetingId = ?3, updatedAt = ?2,
      hardEndAt = CASE WHEN purpose = 'CHECKIN' THEN NULL ELSE ?2 + limitMinutes * ?4 END
    WHERE id = ?1 AND state = 'SCHEDULED' RETURNING id`).bind(meetingId, ctx.now, providerMeetingId, MINUTE_MS).first();
  return opened !== null;
}

/**
 * Ends a live call for `reason`, in the order that stops spending first: stop its recording, remove
 * everyone from the provider meeting and close it, then mark it ENDED and delete every seat (no record
 * of who attended survives) and, when nothing was recorded, the consent answers. If the provider
 * fails, nothing in D1 changes and the next step tries again. Returns the state afterwards; a call that
 * is not live is left as it is.
 */
export async function endMeeting(ctx: CallContext, meetingId: string, reason: MeetingEndReason): Promise<MeetingState | null> {
  const { db, now } = ctx;
  const call = await db.prepare(`SELECT m.state, m.providerMeetingId, r.providerRecordingId FROM meeting m
    LEFT JOIN meeting_recording r ON r.meetingId = m.id AND r.state IN ('STARTING', 'RECORDING')
    WHERE m.id = ?1`).bind(meetingId).first<{ state: MeetingState; providerMeetingId: string | null; providerRecordingId: string | null }>();
  if (!call || call.state !== "LIVE") return call?.state ?? null;
  if (call.providerMeetingId) {
    const provider = requireProvider(ctx);
    const { providerMeetingId, providerRecordingId } = call;
    if (providerRecordingId) await provider.stopRecording({ providerMeetingId, providerRecordingId });
    await provider.endMeeting({ providerMeetingId });
  }
  const ended = "(SELECT state FROM meeting WHERE id = ?1) = 'ENDED'";
  await db.batch([
    db.prepare(`UPDATE meeting_recording SET state = 'STOPPED', stoppedAt = ?2, updatedAt = ?2
      WHERE meetingId = ?1 AND state IN ('STARTING', 'RECORDING') AND providerRecordingId IS NOT NULL`).bind(meetingId, now),
    db.prepare(`UPDATE meeting SET state = 'ENDED', endedAt = ?2, endReason = ?3, updatedAt = ?2
      WHERE id = ?1 AND state = 'LIVE'`).bind(meetingId, now, reason),
    db.prepare(`DELETE FROM meeting_seat WHERE meetingId = ?1 AND ${ended}`).bind(meetingId),
    db.prepare(`DELETE FROM meeting_consent WHERE meetingId = ?1 AND ${ended}
      AND NOT EXISTS (SELECT 1 FROM meeting_recording WHERE meetingId = ?1 AND state IN ${RECORDED})`).bind(meetingId),
  ]);
  return "ENDED";
}

/** Cancels a call that never opened. True when this request cancelled it. */
export async function cancelMeeting(ctx: CallContext, meetingId: string): Promise<boolean> {
  const cancelled = await ctx.db.prepare(`UPDATE meeting SET state = 'CANCELLED', updatedAt = ?2
    WHERE id = ?1 AND state = 'SCHEDULED' RETURNING id`).bind(meetingId, ctx.now).first();
  return cancelled !== null;
}
