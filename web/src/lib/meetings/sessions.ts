import { getConductAcknowledgement } from "@/lib/channels/conduct";
import { ChannelError } from "@/lib/channels/errors";
import { postMessage } from "@/lib/channels/mutations";
import type { ChannelKind, Message } from "@/lib/platform/contracts";
import {
  channelAccessFor, type ChannelAccessTarget, type PlatformCapabilities,
} from "@/lib/platform/server/capabilities";
import { meetingAccessFor, type MeetingAccess } from "./access";
import { LIMIT_MINUTES, notFound } from "./calls";
import { MINUTE_MS } from "./clock";
import { SESSION_BOOK_AHEAD_DAYS, SESSION_SERIES_MAX_WEEKS, type MeetingState } from "./rules";
import {
  cleanTitle, lengthLabel, nairobiFields, SESSION_LENGTHS, SESSION_ZONE_LABEL, sessionClock, sessionDate, sessionDay, shortDate, weekdayOf,
} from "./session-times";

/**
 * Scheduling cohort sessions (README.md beside this file, "Scheduling cohort sessions", slice P8).
 * A session belongs to its cohort: it is scheduled from the cohort's Sessions page, in the cohort's
 * main channel, by that cohort's instructors and TAs or an admin (meetingAccessFor's canHost). A
 * weekly series is a set of separate dates sharing a seriesId; each is moved or cancelled alone.
 * Scheduling only writes `meeting` rows: nothing is made at the provider until a host opens the room.
 * Every refusal (the flag off, a cohort or session the caller can't host or see) is the same 404.
 */

/** The caller, as the session pages know them: capabilities from the database, never from locals. */
export interface SessionCaller {
  userId: string;
  capabilities: PlatformCapabilities;
  /** Effective for the caller (flags.ts REQUIRES): off, and every session page and action is 404. */
  meetings: boolean;
  /** The code of conduct version scheduling needs (a test seam). */
  conductVersion?: number;
}

export interface SessionContext {
  db: D1Database;
  now: number;
  /** The checks a new note gets after the response (note-checks.ts): Clef and the queue notice. */
  afterNote?: (message: Message, channel: { id: string; kind: ChannelKind }) => void;
}

type ChannelFacts = ChannelAccessTarget & { id: string; slug: string };

/** A cohort the caller may schedule sessions for, with the main channel its sessions and notes go to. */
export interface HostableCohort {
  programId: string;
  name: string;
  channel: ChannelFacts;
}

/** A session still to come (or live) that the caller can see, with what they may do with it. */
export interface UpcomingSession {
  id: string;
  title: string;
  scheduledStartAt: number;
  bookedMinutes: number;
  state: Extract<MeetingState, "SCHEDULED" | "LIVE">;
  seriesId: string | null;
  programId: string;
  cohortName: string;
  channel: ChannelFacts;
  access: MeetingAccess;
}

/** One session a host is changing: the call, its channel and its cohort. */
export interface HostedSession {
  id: string;
  title: string;
  scheduledStartAt: number;
  bookedMinutes: number;
  state: MeetingState;
  createdAt: number;
  updatedAt: number;
  cohortName: string;
  channel: ChannelFacts;
  access: MeetingAccess;
}

/** The most upcoming sessions listed at once: more than two cohorts' worth of weekly series. */
export const UPCOMING_LIMIT = 60;

const channelOf = (row: Record<string, unknown>): ChannelFacts => ({
  id: row.channelId as string, slug: row.slug as string, kind: row.kind as ChannelFacts["kind"],
  programId: row.programId as string | null, postingPolicy: row.postingPolicy as ChannelFacts["postingPolicy"],
  archivedAt: row.archivedAt as number | null,
});

/** Which cohorts' sessions a caller's capabilities could reach: every one for an admin, else theirs. */
const cohortScope = (capabilities: PlatformCapabilities, ids: readonly string[]) =>
  [capabilities.isAdmin ? 1 : 0, JSON.stringify(ids)] as const;

/**
 * The cohorts the caller may schedule for, newest first: every cohort for an admin, otherwise those
 * they teach (instructor or TA). Only a cohort with an open main channel can take a session.
 */
export async function hostableCohorts(db: D1Database, capabilities: PlatformCapabilities): Promise<HostableCohort[]> {
  if (!capabilities.isAdmin && capabilities.teachingCohortIds.length === 0) return [];
  const { results } = await db.prepare(`SELECT p.id AS programId, p.name, c.id AS channelId, c.slug, c.kind, c.programId,
      c.postingPolicy, c.archivedAt
    FROM program p JOIN channel c ON c.seedKey = 'cohort:' || p.id || ':main' AND c.kind = 'COHORT' AND c.programId = p.id
    WHERE ?1 OR p.id IN (SELECT value FROM json_each(?2))
    ORDER BY p.startDate IS NULL, p.startDate DESC, p.name, p.id`)
    .bind(...cohortScope(capabilities, capabilities.teachingCohortIds)).all<Record<string, unknown>>();
  return results
    .map((row) => ({ programId: row.programId as string, name: (row.name as string).trim() || "Cohort", channel: channelOf(row) }))
    .filter(({ channel }) => meetingAccessFor(capabilities, channel, "SESSION").canHost);
}

/**
 * The sessions coming up in every cohort the caller reads, soonest first: scheduled ones until their
 * booked time is over, and live ones. A cohort channel's sessions are seen by its readers (members,
 * alumni, its instructors, TAs and invited mentors, admins) and hosted by its instructors, TAs and admins.
 */
export async function upcomingSessions(db: D1Database, capabilities: PlatformCapabilities, now: number): Promise<UpcomingSession[]> {
  if (!capabilities.isAdmin && capabilities.cohortIds.length === 0) return [];
  const { results } = await db.prepare(`SELECT m.id, m.title, m.scheduledStartAt, m.bookedMinutes, m.state, m.seriesId,
      c.id AS channelId, c.slug, c.kind, c.programId, c.postingPolicy, c.archivedAt, p.name AS cohortName
    FROM meeting m JOIN channel c ON c.id = m.channelId JOIN program p ON p.id = c.programId
    WHERE m.purpose = 'SESSION' AND c.kind = 'COHORT' AND (?1 OR c.programId IN (SELECT value FROM json_each(?2)))
      AND (m.state = 'LIVE' OR (m.state = 'SCHEDULED' AND m.scheduledStartAt + m.bookedMinutes * ?4 > ?3))
    ORDER BY m.scheduledStartAt, m.id LIMIT ?5`)
    .bind(...cohortScope(capabilities, capabilities.cohortIds), now, MINUTE_MS, UPCOMING_LIMIT).all<Record<string, unknown>>();
  return results.flatMap((row) => {
    const channel = channelOf(row);
    const access = meetingAccessFor(capabilities, channel, "SESSION");
    if (!access.canSee) return [];
    return [{
      id: row.id as string, title: row.title as string, scheduledStartAt: row.scheduledStartAt as number,
      bookedMinutes: row.bookedMinutes as number, state: row.state as UpcomingSession["state"], seriesId: row.seriesId as string | null,
      programId: channel.programId as string, cohortName: (row.cohortName as string).trim() || "Cohort", channel, access,
    }];
  });
}

/** A session the caller can see (`host: false`) or host, or the same 404 for anything else. */
export async function readSession(db: D1Database, caller: SessionCaller, meetingId: string, { host = true } = {}): Promise<HostedSession> {
  if (!caller.meetings) throw notFound();
  const row = await db.prepare(`SELECT m.id, m.title, m.scheduledStartAt, m.bookedMinutes, m.state, m.createdAt, m.updatedAt, m.purpose,
      c.id AS channelId, c.slug, c.kind, c.programId, c.postingPolicy, c.archivedAt, p.name AS cohortName,
      EXISTS (SELECT 1 FROM channel_member WHERE channelId = c.id AND userId = ?2) AS isMember
    FROM meeting m JOIN channel c ON c.id = m.channelId JOIN program p ON p.id = c.programId
    WHERE m.id = ?1`).bind(meetingId, caller.userId).first<Record<string, unknown>>();
  if (!row || row.purpose !== "SESSION") throw notFound();
  const channel = channelOf(row);
  const access = meetingAccessFor(caller.capabilities, channel, "SESSION", { isMember: row.isMember === 1 });
  if (!(host ? access.canHost : access.canSee)) throw notFound();
  return {
    id: row.id as string, title: row.title as string, scheduledStartAt: row.scheduledStartAt as number,
    bookedMinutes: row.bookedMinutes as number, state: row.state as MeetingState, createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number, cohortName: (row.cohortName as string).trim() || "Cohort", channel, access,
  };
}

const invalid = (message: string) => new ChannelError("validation", message, 400);
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * The server's own check of a session's time and length, whatever the form sent: a start that hasn't
 * passed, within SESSION_BOOK_AHEAD_DAYS, and a length from SESSION_LENGTHS (up to the call limit).
 */
export function checkSessionTime(startAt: number, minutes: number, now: number): void {
  if (!Number.isSafeInteger(startAt) || startAt <= now) throw invalid("Choose a time that hasn't passed yet.");
  if (startAt > now + SESSION_BOOK_AHEAD_DAYS * DAY_MS) throw invalid("Sessions can be booked up to a year ahead.");
  if (!SESSION_LENGTHS.includes(minutes)) throw invalid(`Choose a length of up to ${LIMIT_MINUTES.SESSION} minutes.`);
}

function checkTitle(title: string): string {
  const cleaned = cleanTitle(title);
  if (cleaned.length === 0 || cleaned.length > 120) throw invalid("Enter a title of up to 120 characters.");
  return cleaned;
}

async function requireConduct(db: D1Database, caller: SessionCaller): Promise<void> {
  const agreed = await getConductAcknowledgement(db, caller.userId, { currentVersion: caller.conductVersion });
  if (!agreed?.current) {
    throw new ChannelError("conduct_required", "Agree to how we talk to each other before you schedule a session.", 403);
  }
}

/** Whether the one-line note reached the channel. A refused post (a rate limit) leaves the sessions as they are. */
export type NoteOutcome = "posted" | "not_posted";

/**
 * The one-line note in the session's channel, through postMessage, the path every post takes (the
 * detectors, the code of conduct, the rate limits), then the checks after the response (`afterNote`:
 * Clef and the queue notice, as channels/http.ts gives a post). There is no system author, so the
 * host who acted posts it, as the mentor-request flow does. The nonce makes a repeated request post it once.
 */
async function postNote(ctx: SessionContext, caller: SessionCaller, channel: ChannelFacts, body: string, nonce: string): Promise<NoteOutcome> {
  const { canRead: _, ...capabilities } = channelAccessFor(caller.capabilities, channel);
  try {
    const { message, created } = await postMessage({
      db: ctx.db, viewerId: caller.userId, now: ctx.now, conductVersion: caller.conductVersion,
      channel: { id: channel.id, kind: channel.kind, programId: channel.programId, archivedAt: channel.archivedAt, capabilities },
    }, { body, clientNonce: nonce, parentId: null, embeds: [] });
    if (created) ctx.afterNote?.(message, channel);
    return "posted";
  } catch (error) {
    if (error instanceof ChannelError) return "not_posted";
    throw error;
  }
}

export interface ScheduleInput {
  programId: string;
  /**
   * The form's own id, made when it was first shown: the series id and the base of each date's id,
   * so a form sent twice schedules once (a cuid, `SCHEDULE_TOKEN`).
   */
  token: string;
  title: string;
  /** Each date's start, in the order scheduled. One date is "just once"; more are a weekly series. */
  startTimes: readonly number[];
  bookedMinutes: number;
  /** The series dates left out ("2026-12-18"), for the note. */
  skipped?: readonly string[];
}

export interface Scheduled {
  meetingIds: string[];
  cohort: HostableCohort;
  note: NoteOutcome;
}

/** A schedule form's token: a cuid, as createId makes. */
export const SCHEDULE_TOKEN = /^[a-z0-9]{20,32}$/;
/**
 * The rows a token holds, `param` naming it: one date's id, a series' id, or a series date `token-n`
 * (a range on the primary key: "-" sorts just before ".", and a token is letters and digits).
 */
const HOLDS_TOKEN = (param: string) => `(id = ${param} OR seriesId = ${param} OR (id > ${param} || '-' AND id < ${param} || '.'))`;

/**
 * Schedules one session, or a weekly series of separate dates, in the cohort's main channel, then
 * posts one line there saying so (never a card per date). Everything is checked again here: the
 * caller hosts this cohort, every date is still to come and within the limits, the title and length.
 * `cohorts` is the caller's hostableCohorts when the page already read them.
 *
 * Idempotent on the form's token, which is reserved whole: every date's id comes from it, and the
 * dates are written in one statement that writes nothing if anything already holds the token (its own
 * id, its series, or a date `token-n`). The same form again (a double submit, a retry) finds exactly
 * its own dates (the same starts, title and length) and answers as the first did, posting the note
 * only if it never was. The same token with anything else changed (Back, edit, send again) is a 409:
 * nothing is written and nothing is reported as scheduled. A token holding someone else's dates, or
 * dates in another channel, is the same 404.
 */
export async function scheduleSessions(
  ctx: SessionContext, caller: SessionCaller, input: ScheduleInput, { cohorts }: { cohorts?: readonly HostableCohort[] } = {},
): Promise<Scheduled> {
  if (!caller.meetings) throw notFound();
  const cohort = (cohorts ?? await hostableCohorts(ctx.db, caller.capabilities)).find(({ programId }) => programId === input.programId);
  if (!cohort) throw notFound();
  if (!SCHEDULE_TOKEN.test(input.token)) throw invalid("This form has expired. Open Schedule a session again.");
  const title = checkTitle(input.title);
  const starts = [...new Set(input.startTimes)].toSorted((a, b) => a - b);
  if (starts.length === 0) throw invalid("Tick at least one date to schedule.");
  if (starts.length > SESSION_SERIES_MAX_WEEKS) throw invalid(`A series can cover up to ${SESSION_SERIES_MAX_WEEKS} weeks.`);
  for (const start of starts) checkSessionTime(start, input.bookedMinutes, ctx.now);
  await requireConduct(ctx.db, caller);

  const seriesId = starts.length > 1 ? input.token : null;
  const ids = starts.length > 1 ? starts.map((_, index) => `${input.token}-${index + 1}`) : [input.token];
  const rows = JSON.stringify(ids.map((id, index) => ({ id, start: starts[index] })));
  // One statement: every date, or none of them when anything already holds the token (?9).
  const { results } = await ctx.db.prepare(`INSERT INTO meeting (id, channelId, purpose, title, seriesId,
      scheduledStartAt, bookedMinutes, limitMinutes, recordingPolicy, state, createdBy, createdAt, updatedAt)
    SELECT json_extract(r.value, '$.id'), ?2, 'SESSION', ?3, ?4, json_extract(r.value, '$.start'), ?5, ?6, 'ALWAYS', 'SCHEDULED', ?7, ?8, ?8
    FROM json_each(?1) r
    WHERE NOT EXISTS (SELECT 1 FROM meeting WHERE ${HOLDS_TOKEN("?9")})
    RETURNING id`).bind(
    rows, cohort.channel.id, title, seriesId, input.bookedMinutes, LIMIT_MINUTES.SESSION, caller.userId, ctx.now, input.token,
  ).all<{ id: string }>();
  if (results.length !== ids.length) {
    // Nothing was written: this token was sent before. It is a replay only when it holds exactly this.
    const { results: held } = await ctx.db.prepare(`SELECT id, channelId, purpose, title, scheduledStartAt, bookedMinutes, createdBy
      FROM meeting WHERE ${HOLDS_TOKEN("?1")}`).bind(input.token)
      .all<{ id: string; channelId: string; purpose: string; title: string; scheduledStartAt: number; bookedMinutes: number; createdBy: string | null }>();
    if (held.some((row) => row.createdBy !== caller.userId || row.channelId !== cohort.channel.id || row.purpose !== "SESSION")) throw notFound();
    const start = new Map(ids.map((id, index) => [id, starts[index]]));
    const same = held.length === ids.length && held.every((row) =>
      start.get(row.id) === row.scheduledStartAt && row.title === title && row.bookedMinutes === input.bookedMinutes);
    if (!same) throw new ChannelError("conflict", "This form was already sent. Open Schedule a session again.", 409);
  }
  const body = scheduledNote({ title, starts, minutes: input.bookedMinutes, skipped: input.skipped ?? [], now: ctx.now });
  const note = await postNote(ctx, caller, cohort.channel, body, `session-scheduled-${input.token}`);
  return { meetingIds: ids, cohort, note };
}

export interface SessionChange {
  title: string;
  startAt: number;
  bookedMinutes: number;
}

export interface Changed {
  session: HostedSession;
  /** Whether the time moved, which is what the channel is told about. */
  moved: boolean;
  note: NoteOutcome | null;
}

const NOT_SCHEDULED = "This session has already started or been cancelled, so it can't be changed.";

/**
 * Each change moves `updatedAt` on by at least a second, so the calendar file's SEQUENCE (whole
 * seconds since the session was made) rises with every one.
 */
const nextUpdate = (now: string) => `max(${now}, updatedAt + 1000)`;

/**
 * Changes one date of a session that hasn't opened: its title, time or length. Every other date of
 * its series stays as it is. A changed time is told to the channel in one line. A date that keeps its
 * time may be renamed or shortened even once that time has passed; a moved one must still be to come.
 * `known` is the session as the page already read it for this caller (readSession, as a host).
 */
export async function changeSession(
  ctx: SessionContext, caller: SessionCaller, meetingId: string, change: SessionChange, { known }: { known?: HostedSession } = {},
): Promise<Changed> {
  const before = known?.id === meetingId && caller.meetings && known.access.canHost ? known : await readSession(ctx.db, caller, meetingId);
  if (before.state !== "SCHEDULED") throw new ChannelError("conflict", NOT_SCHEDULED, 409);
  const title = checkTitle(change.title);
  const moved = before.scheduledStartAt !== change.startAt;
  if (moved) checkSessionTime(change.startAt, change.bookedMinutes, ctx.now);
  else if (!SESSION_LENGTHS.includes(change.bookedMinutes)) throw invalid(`Choose a length of up to ${LIMIT_MINUTES.SESSION} minutes.`);
  await requireConduct(ctx.db, caller);
  const updated = await ctx.db.prepare(`UPDATE meeting SET title = ?2, scheduledStartAt = ?3, bookedMinutes = ?4, updatedAt = ${nextUpdate("?5")}
    WHERE id = ?1 AND state = 'SCHEDULED' AND purpose = 'SESSION' RETURNING title, scheduledStartAt, bookedMinutes, state, updatedAt`)
    .bind(meetingId, title, change.startAt, change.bookedMinutes, ctx.now)
    .first<Pick<HostedSession, "title" | "scheduledStartAt" | "bookedMinutes" | "state" | "updatedAt">>();
  if (!updated) throw new ChannelError("conflict", NOT_SCHEDULED, 409);
  const session: HostedSession = { ...before, ...updated };
  const note = moved
    ? await postNote(ctx, caller, before.channel, movedNote({ title, from: before.scheduledStartAt, to: change.startAt, now: ctx.now }),
      `session-moved-${meetingId}-${session.updatedAt}`)
    : null;
  return { session, moved, note };
}

const STARTED = "This session has already started, so it can't be cancelled. End it from the call instead.";

/**
 * Cancels one date of a session that hasn't opened, and tells the channel. Cancelling it again changes
 * nothing. `known` is the session as the page already read it for this caller.
 */
export async function cancelSession(
  ctx: SessionContext, caller: SessionCaller, meetingId: string, { known }: { known?: HostedSession } = {},
): Promise<{ session: HostedSession; note: NoteOutcome | null }> {
  const before = known?.id === meetingId && caller.meetings && known.access.canHost ? known : await readSession(ctx.db, caller, meetingId);
  if (before.state === "CANCELLED") return { session: before, note: null };
  if (before.state !== "SCHEDULED") throw new ChannelError("conflict", STARTED, 409);
  await requireConduct(ctx.db, caller);
  // The same conditional write as the clock's cancelMeeting, moving updatedAt on for the calendar file.
  const cancelled = await ctx.db.prepare(`UPDATE meeting SET state = 'CANCELLED', updatedAt = ${nextUpdate("?2")}
    WHERE id = ?1 AND state = 'SCHEDULED' RETURNING state, updatedAt`).bind(meetingId, ctx.now)
    .first<Pick<HostedSession, "state" | "updatedAt">>();
  if (!cancelled) {
    const now = await readSession(ctx.db, caller, meetingId);
    if (now.state === "CANCELLED") return { session: now, note: null };
    throw new ChannelError("conflict", STARTED, 409);
  }
  const session: HostedSession = { ...before, ...cancelled };
  const note = await postNote(ctx, caller, before.channel, cancelledNote({ title: before.title, at: before.scheduledStartAt, now: ctx.now }),
    `session-cancelled-${meetingId}`);
  return { session, note };
}

/** "Thu 27 Nov at 18:00 EAT". */
const dayAndTime = (ms: number, now: number) => `${sessionDay(ms, now)} at ${sessionClock(ms)} ${SESSION_ZONE_LABEL}`;
/** "Thu 18 Dec", "Thu 18 Dec and Thu 25 Dec", "Thu 11 Dec, Thu 18 Dec and Thu 25 Dec". */
function listOf(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * The line a schedule posts: "Scheduled 5 sessions: “Testing payment callbacks”, Thursdays at 18:00
 * EAT from 20 Nov to 25 Dec, 45 minutes each, with no session on Thu 18 Dec. …" One line, never a card
 * per date (UX review M6).
 */
export function scheduledNote({ title, starts, minutes, skipped, now }: {
  title: string; starts: readonly number[]; minutes: number; skipped: readonly string[]; now: number;
}): string {
  const first = starts[0];
  if (starts.length === 1) {
    return `Scheduled a session: “${title}”, ${dayAndTime(first, now)}, ${lengthLabel(minutes)}. `
      + "It's in Sessions, where you can add it to your calendar.";
  }
  const last = starts.at(-1) as number;
  const gaps = skipped.length > 0 ? `, with no session on ${listOf(skipped.map((date) => sessionDate(date, now)))}` : "";
  return `Scheduled ${starts.length} sessions: “${title}”, ${weekdayOf(nairobiFields(first).date)}s at ${sessionClock(first)} ${SESSION_ZONE_LABEL}`
    + ` from ${shortDate(first, now)} to ${shortDate(last, now)}, ${lengthLabel(minutes)} each${gaps}. `
    + "Each date is separate. They're in Sessions, where you can add them to your calendar.";
}

/** The line a moved date posts. Adding it to a calendar again replaces the old entry (the .ics UID). */
export function movedNote({ title, from, to, now }: { title: string; from: number; to: number; now: number }): string {
  return `Moved “${title}” from ${dayAndTime(from, now)} to ${dayAndTime(to, now)}. `
    + "If you added it to your calendar, add it again from Sessions to update it.";
}

/** The line a cancelled date posts. A downloaded calendar file can't be taken back, so people are told. */
export function cancelledNote({ title, at, now }: { title: string; at: number; now: number }): string {
  return `Cancelled “${title}” on ${dayAndTime(at, now)}. If you added it to your calendar, remove it there.`;
}
