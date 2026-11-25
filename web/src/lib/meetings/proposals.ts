import { getConductAcknowledgement } from "@/lib/channels/conduct";
import { ChannelError } from "@/lib/channels/errors";
import { postMessage } from "@/lib/channels/mutations";
import { postedWorkEligibility } from "@/lib/community/eligibility";
import type { CallEmbed, CallProposalCardState, ChannelKind, Message } from "@/lib/platform/contracts";
import {
  channelAccessFor, type ChannelAccessTarget, type PlatformCapabilities,
} from "@/lib/platform/server/capabilities";
import { meetingAccessFor, type MeetingAccess } from "./access";
import { LIMIT_MINUTES, notFound } from "./calls";
import { attachCard } from "./cards";
import { touchMeetingCard } from "./card-state";
import { MINUTE_MS } from "./clock";
import { hasExpired, pickableTimes, proposalCardState, proposedTimes, touchProposalCard } from "./proposal-card";
import {
  CALL_BOOK_AHEAD_DAYS, CALL_PROPOSALS_PER_DAY, CHECKIN_LIMIT_MINUTES, MAX_PROPOSED_TIMES,
  type CallProposalPurpose, type CallProposalState, type MeetingEndReason, type MeetingRecordingPolicy, type MeetingRecordingState,
  type MeetingState,
} from "./rules";
import { SCHEDULE_TOKEN } from "./sessions";
import { lengthLabel, SESSION_LENGTHS, SESSION_ZONE_LABEL, sessionClock, sessionDay } from "./session-times";

/**
 * Calls between two people (README.md beside this file, "Calls between two people", slice P10). In a
 * direct conversation either person suggests up to MAX_PROPOSED_TIMES times for a call, or for a
 * check-in on one revision of one piece of work; the other picks one, suggests other times, or says
 * "Not now". A suggestion is a `call_proposal` row and its card in the conversation; picking a time
 * books the `meeting` and posts its card. A booked call's time is changed by a new round of times
 * (the booked time stands until one is picked) and it can be cancelled; the other person is told.
 *
 * Only the conversation's two members, never an admin outside it (meetingAccessFor), and only while
 * `meeting_checkins` is on for the caller: every refusal is the same 404. A "Not now" is written on
 * the suggestion alone: nothing outside the conversation (a profile, Discover, an assessment, the
 * other person's Attention) ever learns of it, as with a mentor's set-aside.
 */

/** The caller, as the call pages know them: capabilities from the database, never from locals. */
export interface CallCaller {
  userId: string;
  capabilities: PlatformCapabilities;
  /** `meeting_checkins`, effective for the caller (it needs `meetings` and `mentor_requests`): off, and everything is 404. */
  checkins: boolean;
  /** The code of conduct version posting a card needs (a test seam). */
  conductVersion?: number;
}

/** What a write tells the people involved after the response (call-events.ts): their Attention. */
export type CallEvent =
  | { kind: "proposed"; proposalId: string; countered: boolean }
  | { kind: "booked"; proposalId: string; meetingId: string }
  | { kind: "cancelled"; meetingId: string; byUserId: string };

export interface CallsContext {
  db: D1Database;
  now: number;
  /** The checks a new card or note gets after the response (note-checks.ts): Clef and the queue notice. */
  afterNote?: (message: Message, channel: { id: string; kind: ChannelKind }) => void;
  /** Attention for the other person, after the response. */
  afterEvent?: (event: CallEvent) => void;
}

/** A direct conversation's access facts. */
export type ConversationTarget = ChannelAccessTarget & { id: string };

/** The other member of a conversation. */
export interface Counterpart {
  id: string;
  name: string;
}

/** Posted work a check-in can be about: either member's, at its current revision. */
export interface CheckinWork {
  journeyId: string;
  title: string;
  version: number;
  ownerId: string;
}

/** A suggestion as the pages show it: the card's facts, with the conversation and what the caller may do. */
export interface CallProposal {
  id: string;
  channelId: string;
  purpose: CallProposalPurpose;
  /** As its card says: an open suggestion whose times have all started is expired. */
  state: CallProposalCardState;
  proposedBy: string;
  /** True when the caller suggested it: they may withdraw it, and the other person answers it. */
  mine: boolean;
  times: number[];
  bookedMinutes: number;
  askToRecord: boolean;
  work: { journeyId: string | null; title: string | null; version: number } | null;
  /** The call it booked, or the booked call whose time it would change. */
  call: { id: string; state: MeetingState; scheduledStartAt: number; bookedMinutes: number } | null;
  counterpart: Counterpart;
  createdAt: number;
}

/** A booked call between two people, as its page shows it. */
export interface BookedCall {
  id: string;
  channelId: string;
  purpose: CallProposalPurpose;
  title: string;
  state: MeetingState;
  scheduledStartAt: number;
  bookedMinutes: number;
  limitMinutes: number;
  recordingPolicy: MeetingRecordingPolicy;
  journeyVersion: number | null;
  createdAt: number;
  updatedAt: number;
  counterpart: Counterpart;
  channel: ConversationTarget;
  access: MeetingAccess;
  /** A round of new times for it still waiting for an answer, when there is one. */
  pendingChange: string | null;
}

const invalid = (message: string) => new ChannelError("validation", message, 400);
const conflict = (message: string) => new ChannelError("conflict", message, 409);
const DAY_MS = 24 * 60 * MINUTE_MS;

/** The lengths a call can be booked for; a check-in is always CHECKIN_LIMIT_MINUTES. */
export const CALL_LENGTHS = SESSION_LENGTHS;

const ANSWERED = "This suggestion was already answered.";
const PASSED = "These times have passed. Suggest new ones.";
const WAITING = "There's already a suggestion waiting in this conversation. Answer it or withdraw it first.";
const STARTED = "This call has already started or was cancelled, so it can't be changed.";

/** A JSON value a subquery handed over as text (the JSON subtype is lost there). */
function parsedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

function counterpartOf(value: unknown): Counterpart | null {
  const pair = parsedJson(value);
  return Array.isArray(pair) && typeof pair[0] === "string" ? { id: pair[0], name: typeof pair[1] === "string" && pair[1].trim() ? pair[1].trim() : "The other person" } : null;
}

/** The other member of the conversation `channel` names (SQL), for the caller `viewer` (SQL), as a JSON pair. */
const counterpartColumn = (channel: string, viewer: string) => `(SELECT json_array(u.id, coalesce(u.name, '')) FROM channel_member o
    JOIN "user" u ON u.id = o.userId WHERE o.channelId = ${channel} AND o.userId <> ${viewer} ORDER BY o.userId LIMIT 1)`;

const targetOf = (row: Record<string, unknown>): ConversationTarget => ({
  id: row.channelId as string, kind: row.kind as ChannelKind, programId: row.programId as string | null,
  postingPolicy: row.postingPolicy as ConversationTarget["postingPolicy"], archivedAt: row.archivedAt as number | null,
});

/** What the caller may do with calls in a conversation: host (suggest, answer, change, cancel) as one of its two members. */
const accessIn = (caller: CallCaller, channel: ConversationTarget, purpose: CallProposalPurpose, isMember: unknown) =>
  meetingAccessFor(caller.capabilities, channel, purpose, { isMember: isMember === 1 });

async function requireConduct(db: D1Database, caller: CallCaller): Promise<void> {
  const agreed = await getConductAcknowledgement(db, caller.userId, { currentVersion: caller.conductVersion });
  if (!agreed?.current) throw new ChannelError("conduct_required", "Agree to how we talk to each other before you suggest or book a call.", 403);
}

/** Whether a card or note reached the conversation. A refused post (a rate limit) leaves the suggestion or call as it is. */
export type NoteOutcome = "posted" | "not_posted";

/**
 * A line in the conversation, through postMessage, the path every post takes (the detectors, the code
 * of conduct, the rate limits), then the checks after the response. There is no system author, so the
 * person who acted posts it. The nonce makes a repeated request post it once. With `card`, the message
 * carries it, and `attach` makes it the suggestion's or the call's card.
 */
async function postLine(
  ctx: CallsContext, caller: CallCaller, channel: ConversationTarget, body: string, nonce: string,
  card?: { embed: CallEmbed; attach: (messageId: string) => Promise<unknown> },
): Promise<NoteOutcome> {
  const { canRead: _, ...capabilities } = channelAccessFor(caller.capabilities, channel, { isMember: true });
  try {
    const { message, created } = await postMessage({
      db: ctx.db, viewerId: caller.userId, now: ctx.now, conductVersion: caller.conductVersion,
      channel: { id: channel.id, kind: channel.kind, programId: channel.programId, archivedAt: channel.archivedAt, capabilities },
    }, { body, clientNonce: nonce, parentId: null, embeds: [] }, card ? { card: card.embed } : {});
    if (created) ctx.afterNote?.(message, channel);
    if (card) await card.attach(message.id);
    return "posted";
  } catch (error) {
    if (error instanceof ChannelError) return "not_posted";
    throw error;
  }
}

/** "Thu 27 Nov at 17:00 EAT". */
const dayAndTime = (ms: number, now: number) => `${sessionDay(ms, now)} at ${sessionClock(ms)} ${SESSION_ZONE_LABEL}`;
/** "A, B or C". */
function choiceOf(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

/** A call's title, for its card, the room and calendars: never anyone's name, which can change. */
export function callTitle(purpose: CallProposalPurpose, workTitle: string | null): string {
  if (purpose === "CALL") return "Mentoring call";
  const title = workTitle?.trim() ? `Check-in on “${workTitle.trim()}”` : "Project check-in";
  return title.length <= 120 ? title : `${title.slice(0, 117)}…`;
}

/**
 * The line a suggestion's card carries: what kind of call, the times in Nairobi time (its card shows
 * each reader's own) and how long. One line; the card says what to do.
 */
export function suggestedLine({ purpose, workTitle, times, minutes, kind, movesFrom, now }: {
  purpose: CallProposalPurpose; workTitle: string | null; times: readonly number[]; minutes: number;
  kind: "new" | "instead" | "move"; movesFrom: number | null; now: number;
}): string {
  const when = choiceOf(times.map((time) => dayAndTime(time, now)));
  const length = purpose === "CHECKIN" ? `Up to ${CHECKIN_LIMIT_MINUTES} minutes.` : `${lengthLabel(minutes)}.`;
  if (kind === "move" && movesFrom !== null) {
    return `Suggested new times for our call on ${dayAndTime(movesFrom, now)}: ${when}. It stays booked until one is picked.`;
  }
  if (kind === "instead") return `Suggested other times: ${when}. ${length}`;
  const what = purpose === "CHECKIN" ? (workTitle?.trim() ? `a check-in on “${workTitle.trim()}”` : "a project check-in") : "a call";
  return `Suggested ${what}: ${when}. ${length}`;
}

/** The line a picked time's card carries: the booking, in past tense so it stays true. */
export const bookedLine = (purpose: CallProposalPurpose, at: number, minutes: number, now: number) =>
  `Booked ${purpose === "CHECKIN" ? "the check-in" : "the call"} for ${dayAndTime(at, now)}, ${lengthLabel(minutes)}.`;

/** The line a cancelled call posts. A downloaded calendar file can't be taken back, so the other person is told. */
export const cancelledLine = (at: number, now: number) =>
  `Cancelled our call on ${dayAndTime(at, now)}. If you added it to your calendar, remove it there.`;

// ---------------------------------------------------------------------------------------------------
// Reading

/** The conversation, as the suggest form needs it: who else is in it, the work a check-in can be about, and any suggestion waiting. */
export interface CallConversation {
  channel: ConversationTarget;
  counterpart: Counterpart;
  works: CheckinWork[];
  /** A suggestion still waiting for an answer here, if any (only one can be). */
  waiting: { id: string; proposedBy: string; times: number[]; meetingId: string | null } | null;
}

/** The most pieces of work the check-in form offers. */
export const CHECKIN_WORK_LIMIT = 50;

/**
 * The conversation the caller would suggest a call in, in one round trip: only a direct conversation
 * they are one of the two members of and may host calls in, else the same 404.
 */
export async function callConversation(db: D1Database, caller: CallCaller, channelId: string, now: number): Promise<CallConversation> {
  if (!caller.checkins) throw notFound();
  const [conversations, works, waiting] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT c.id AS channelId, c.kind, c.programId, c.postingPolicy, c.archivedAt,
        EXISTS (SELECT 1 FROM channel_member WHERE channelId = c.id AND userId = ?2) AS isMember,
        ${counterpartColumn("c.id", "?2")} AS counterpart
      FROM channel c WHERE c.id = ?1`).bind(channelId, caller.userId),
    // Either member's posted work (the member eligibility rule a shared project follows), the caller's own last.
    db.prepare(`SELECT j.id AS journeyId, j.title, j.version, j.userId AS ownerId FROM communityJourney j
      WHERE j.userId IN (SELECT userId FROM channel_member WHERE channelId = ?1)
        AND EXISTS (SELECT 1 FROM channel_member WHERE channelId = ?1 AND userId = ?2) AND ${postedWorkEligibility("j", true)}
      ORDER BY j.userId = ?2, j.updatedAt DESC, j.id LIMIT ?3`).bind(channelId, caller.userId, CHECKIN_WORK_LIMIT),
    db.prepare(`SELECT id, proposedBy, times, meetingId FROM call_proposal WHERE channelId = ?1 AND state = 'OPEN'
      AND EXISTS (SELECT 1 FROM channel_member WHERE channelId = ?1 AND userId = ?2)`).bind(channelId, caller.userId),
  ]);
  const row = conversations.results[0];
  if (!row) throw notFound();
  const channel = targetOf(row);
  const counterpart = counterpartOf(row.counterpart);
  if (!counterpart || !accessIn(caller, channel, "CALL", row.isMember).canHost) throw notFound();
  const open = waiting.results[0];
  const openTimes = open ? proposedTimes(open.times) : [];
  return {
    channel, counterpart,
    works: works.results.map((work) => ({
      journeyId: work.journeyId as string, title: work.title as string, version: work.version as number, ownerId: work.ownerId as string,
    })),
    waiting: open && !hasExpired(openTimes, now)
      ? { id: open.id as string, proposedBy: open.proposedBy as string, times: openTimes, meetingId: open.meetingId as string | null }
      : null,
  };
}

/** The suggestion's columns as readProposal and the answers read them, over `call_proposal p`, `channel c` and the caller ?2. */
const PROPOSAL_COLUMNS = `p.id, p.channelId, p.purpose, p.state, p.proposedBy, p.times, p.bookedMinutes, p.askToRecord, p.journeyId,
  p.journeyVersion, p.meetingId, p.messageId, p.createdAt, p.decidedAt, c.kind, c.programId, c.postingPolicy, c.archivedAt,
  EXISTS (SELECT 1 FROM channel_member WHERE channelId = c.id AND userId = ?2) AS isMember,
  ${counterpartColumn("c.id", "?2")} AS counterpart,
  (SELECT j.title FROM communityJourney j WHERE j.id = p.journeyId AND ${postedWorkEligibility("j", true)}) AS workTitle,
  p.state = 'DECLINED' AND EXISTS (SELECT 1 FROM call_proposal n WHERE n.channelId = p.channelId AND n.createdAt = p.decidedAt
    AND n.proposedBy <> p.proposedBy) AS countered,
  (SELECT json_array(mt.id, mt.state, mt.scheduledStartAt, mt.bookedMinutes) FROM meeting mt WHERE mt.id = p.meetingId AND mt.channelId = p.channelId) AS call`;

interface ProposalRow {
  proposal: CallProposal;
  stored: CallProposalState;
  channel: ConversationTarget;
  access: MeetingAccess;
  messageId: string | null;
  decidedAt: number | null;
}

async function readProposalRow(db: D1Database, caller: CallCaller, proposalId: string, now: number): Promise<ProposalRow> {
  if (!caller.checkins) throw notFound();
  const row = await db.prepare(`SELECT ${PROPOSAL_COLUMNS} FROM call_proposal p JOIN channel c ON c.id = p.channelId WHERE p.id = ?1`)
    .bind(proposalId, caller.userId).first<Record<string, unknown>>();
  if (!row) throw notFound();
  const channel = targetOf(row);
  const purpose = row.purpose as CallProposalPurpose;
  const access = accessIn(caller, channel, purpose, row.isMember);
  const counterpart = counterpartOf(row.counterpart);
  if (!access.canSee || !counterpart) throw notFound();
  const times = proposedTimes(row.times);
  const stored = row.state as CallProposalState;
  const call = parsedJson(row.call);
  const moved = Array.isArray(call) && call[0] !== row.id ? call : null;
  return {
    proposal: {
      id: row.id as string, channelId: channel.id, purpose,
      state: proposalCardState(stored, times, row.countered === 1, now, moved?.[1] === "CANCELLED"),
      proposedBy: row.proposedBy as string, mine: row.proposedBy === caller.userId, times, bookedMinutes: row.bookedMinutes as number,
      askToRecord: row.askToRecord === 1,
      work: row.journeyVersion === null ? null
        : { journeyId: row.journeyId as string | null, title: row.workTitle as string | null, version: row.journeyVersion as number },
      call: Array.isArray(call) && typeof call[0] === "string"
        ? { id: call[0], state: call[1] as MeetingState, scheduledStartAt: call[2] as number, bookedMinutes: call[3] as number }
        : null,
      counterpart, createdAt: row.createdAt as number,
    },
    stored, channel, access, messageId: row.messageId as string | null, decidedAt: row.decidedAt as number | null,
  };
}

/** One suggestion the caller can see (one of its conversation's two members), or the same 404. */
export async function readProposal(db: D1Database, caller: CallCaller, proposalId: string, now: number): Promise<CallProposal> {
  return (await readProposalRow(db, caller, proposalId, now)).proposal;
}

/**
 * One booked call between two people the caller is in, or the same 404 for anything else (a cohort
 * session included). `pendingChange` is a round of new times for it that can still be answered: open,
 * with a time still to come at `now`.
 */
export async function readBookedCall(db: D1Database, caller: CallCaller, meetingId: string, now: number): Promise<BookedCall> {
  if (!caller.checkins) throw notFound();
  const row = await db.prepare(`SELECT m.id, m.channelId, m.purpose, m.title, m.state, m.scheduledStartAt, m.bookedMinutes, m.limitMinutes,
      m.recordingPolicy, m.journeyVersion, m.createdAt, m.updatedAt, c.kind, c.programId, c.postingPolicy, c.archivedAt,
      EXISTS (SELECT 1 FROM channel_member WHERE channelId = c.id AND userId = ?2) AS isMember,
      ${counterpartColumn("c.id", "?2")} AS counterpart,
      (SELECT p.id FROM call_proposal p WHERE p.meetingId = m.id AND p.state = 'OPEN' AND p.id <> m.id
        AND EXISTS (SELECT 1 FROM json_each(p.times) WHERE value > ?3)) AS pendingChange
    FROM meeting m JOIN channel c ON c.id = m.channelId WHERE m.id = ?1`).bind(meetingId, caller.userId, now).first<Record<string, unknown>>();
  if (!row || (row.purpose !== "CALL" && row.purpose !== "CHECKIN")) throw notFound();
  const channel = targetOf(row);
  const purpose = row.purpose as CallProposalPurpose;
  const access = accessIn(caller, channel, purpose, row.isMember);
  const counterpart = counterpartOf(row.counterpart);
  if (!access.canSee || !counterpart) throw notFound();
  return {
    id: row.id as string, channelId: channel.id, purpose, title: row.title as string, state: row.state as MeetingState,
    scheduledStartAt: row.scheduledStartAt as number, bookedMinutes: row.bookedMinutes as number, limitMinutes: row.limitMinutes as number,
    recordingPolicy: row.recordingPolicy as MeetingRecordingPolicy, journeyVersion: row.journeyVersion as number | null,
    createdAt: row.createdAt as number, updatedAt: row.updatedAt as number, counterpart, channel, access,
    pendingChange: row.pendingChange as string | null,
  };
}

/** A call on the Calls page. */
export interface CallRow {
  id: string;
  purpose: CallProposalPurpose;
  title: string;
  state: MeetingState;
  scheduledStartAt: number;
  bookedMinutes: number;
  openedAt: number | null;
  endedAt: number | null;
  endReason: MeetingEndReason | null;
  recordingPolicy: MeetingRecordingPolicy;
  /** The recording's way in, when one was asked for (P11): what a past call says instead of "Not recorded". */
  capture: MeetingRecordingState | null;
  channelId: string;
  counterpart: Counterpart;
}

/** A suggestion waiting for an answer on the Calls page. */
export interface WaitingRow {
  id: string;
  purpose: CallProposalPurpose;
  /** The caller suggested it, so it waits for the other person; otherwise it waits for the caller. */
  mine: boolean;
  times: number[];
  bookedMinutes: number;
  workTitle: string | null;
  /** The booked call whose time it would change. */
  moves: string | null;
  channelId: string;
  counterpart: Counterpart;
}

export interface CallsList {
  /** Booked calls still to come, and live ones, soonest first. */
  comingUp: CallRow[];
  /** Suggestions waiting for an answer, newest first. */
  waiting: WaitingRow[];
  /** Calls that took place, newest first. */
  past: CallRow[];
}

/** The most calls, and suggestions, the Calls page lists at once. */
export const CALLS_LIST_LIMIT = 100;

/**
 * Every call between two people the caller is in, in one round trip: booked ones still to come, the
 * suggestions waiting for an answer (theirs and the other person's), and calls that took place. A
 * cancelled call, a suggestion answered or withdrawn, and a booked time that passed without the call
 * opening are not listed: there is nothing to do with them, and nothing about who came is kept.
 */
export async function listCalls(db: D1Database, caller: CallCaller, now: number): Promise<CallsList> {
  if (!caller.checkins) throw notFound();
  const [calls, waiting] = await db.batch<Record<string, unknown>>([
    // channel_member_userId_idx, then meeting_channel_idx: the caller's conversations, then their calls.
    db.prepare(`SELECT m.id, m.purpose, m.title, m.state, m.scheduledStartAt, m.bookedMinutes, m.openedAt, m.endedAt, m.endReason,
        m.recordingPolicy, (SELECT mr.state FROM meeting_recording mr WHERE mr.meetingId = m.id) AS capture,
        c.id AS channelId, c.kind, c.programId, c.postingPolicy, c.archivedAt, ${counterpartColumn("c.id", "?1")} AS counterpart
      FROM channel_member cm JOIN channel c ON c.id = cm.channelId AND c.kind = 'DIRECT' JOIN meeting m ON m.channelId = c.id
      WHERE cm.userId = ?1 AND m.purpose IN ('CALL', 'CHECKIN')
        AND (m.state IN ('LIVE', 'ENDED') OR (m.state = 'SCHEDULED' AND m.scheduledStartAt + m.bookedMinutes * ?3 > ?2))
      ORDER BY m.scheduledStartAt DESC, m.id LIMIT ?4`).bind(caller.userId, now, MINUTE_MS, CALLS_LIST_LIMIT),
    db.prepare(`SELECT p.id, p.purpose, p.proposedBy, p.times, p.bookedMinutes, p.meetingId,
        (SELECT j.title FROM communityJourney j WHERE j.id = p.journeyId AND ${postedWorkEligibility("j", true)}) AS workTitle,
        c.id AS channelId, c.kind, c.programId, c.postingPolicy, c.archivedAt, ${counterpartColumn("c.id", "?1")} AS counterpart
      FROM channel_member cm JOIN channel c ON c.id = cm.channelId AND c.kind = 'DIRECT'
        JOIN call_proposal p ON p.channelId = c.id AND p.state = 'OPEN'
      WHERE cm.userId = ?1 AND EXISTS (SELECT 1 FROM json_each(p.times) WHERE value > ?2)
      ORDER BY p.createdAt DESC, p.id LIMIT ?3`).bind(caller.userId, now, CALLS_LIST_LIMIT),
  ]);
  const comingUp: CallRow[] = [];
  const past: CallRow[] = [];
  for (const row of calls.results) {
    const purpose = row.purpose as CallProposalPurpose;
    const counterpart = counterpartOf(row.counterpart);
    if (!counterpart || !accessIn(caller, targetOf(row), purpose, 1).canSee) continue;
    const call: CallRow = {
      id: row.id as string, purpose, title: row.title as string, state: row.state as MeetingState,
      scheduledStartAt: row.scheduledStartAt as number, bookedMinutes: row.bookedMinutes as number,
      openedAt: row.openedAt as number | null, endedAt: row.endedAt as number | null, endReason: row.endReason as MeetingEndReason | null,
      recordingPolicy: row.recordingPolicy as MeetingRecordingPolicy, capture: row.capture as MeetingRecordingState | null,
      channelId: row.channelId as string, counterpart,
    };
    (call.state === "ENDED" ? past : comingUp).push(call);
  }
  comingUp.reverse();
  return {
    comingUp,
    past,
    waiting: waiting.results.flatMap((row): WaitingRow[] => {
      const purpose = row.purpose as CallProposalPurpose;
      const counterpart = counterpartOf(row.counterpart);
      if (!counterpart || !accessIn(caller, targetOf(row), purpose, 1).canSee) return [];
      return [{
        id: row.id as string, purpose, mine: row.proposedBy === caller.userId, times: pickableTimes(proposedTimes(row.times), now),
        bookedMinutes: row.bookedMinutes as number, workTitle: row.workTitle as string | null, moves: row.meetingId as string | null,
        channelId: row.channelId as string, counterpart,
      }];
    }),
  };
}

// ---------------------------------------------------------------------------------------------------
// Suggesting

export interface SuggestInput {
  conversationId: string;
  /** The form's own id, made when it was first shown: the suggestion's id, so a form sent twice suggests once. */
  token: string;
  purpose: CallProposalPurpose;
  /** A check-in's work: posted work of either member, at its current revision. */
  journeyId: string | null;
  /** A call's length; a check-in always takes CHECKIN_LIMIT_MINUTES. */
  bookedMinutes: number;
  /** Up to MAX_PROPOSED_TIMES moments, each still to come. */
  times: readonly number[];
  askToRecord: boolean;
  /** The other person's open suggestion this one answers with other times. */
  instead?: string | null;
  /** The booked call whose time this round would change. */
  change?: string | null;
}

export interface Suggested {
  proposalId: string;
  channelId: string;
  counterpart: Counterpart;
  card: NoteOutcome;
}

/** The server's own check of the times offered, whatever the form sent: 1 to 3, different, each still to come and within the booking window. */
export function checkProposedTimes(times: readonly number[], now: number): number[] {
  const sorted = [...new Set(times)].toSorted((a, b) => a - b);
  if (sorted.length === 0) throw invalid("Suggest at least one time.");
  if (sorted.length > MAX_PROPOSED_TIMES) throw invalid(`Suggest up to ${MAX_PROPOSED_TIMES} times.`);
  for (const time of sorted) {
    if (!Number.isSafeInteger(time) || time <= now) throw invalid("Choose times that haven't passed yet.");
    if (time > now + CALL_BOOK_AHEAD_DAYS * DAY_MS) throw invalid(`Calls can be suggested up to ${CALL_BOOK_AHEAD_DAYS} days ahead.`);
  }
  return sorted;
}

const UNIQUE_OPEN = /UNIQUE constraint failed: call_proposal\.channelId/;
/** What a replay compares: a suggestion a token already holds. */
const HELD_COLUMNS = "channelId, proposedBy, purpose, times, journeyId, bookedMinutes, askToRecord, meetingId, messageId";

/**
 * Suggests up to three times for a call, or a check-in, in a direct conversation, and posts its card
 * there. With `instead`, it answers the other person's open suggestion with other times: that one is
 * declined and this one made in the same write, at the same moment, which is how its card says
 * "suggested other times" rather than "Not now". With `change`, it is a new round of times for a booked
 * call, which keeps its time until one is picked. Everything is checked again here: the caller is one
 * of the two members, the work is posted work of one of them, the times, the per-person daily limit,
 * and the code of conduct. A suggestion whose times have all passed is closed as expired first.
 *
 * One open suggestion per conversation, kept by the database (`call_proposal_open_idx`), so two people
 * suggesting at once get one suggestion and one 409. Idempotent on the form's token, the suggestion's
 * id: the same form again finds its own suggestion and answers as the first did, posting the card only
 * if it never was; the same token with anything else is a 409, someone else's the same 404.
 */
export async function suggestCall(ctx: CallsContext, caller: CallCaller, input: SuggestInput): Promise<Suggested> {
  if (!caller.checkins) throw notFound();
  if (!SCHEDULE_TOKEN.test(input.token)) throw invalid("This form has expired. Open Suggest a call again.");
  const read = await readSuggestionTargets(ctx, caller, input);
  const sent = checkedSuggestion(caller, input, read);
  // The same form again is answered before its times are checked: they may have passed since the first.
  if (read.held) return replayed(ctx, caller, input, { ...sent, row: read.held });
  const times = checkProposedTimes(input.times, ctx.now);
  refuseStale(ctx.now, caller, read);
  await requireConduct(ctx.db, caller);

  const written = await writeSuggestion(ctx, caller, input, { ...sent, times, movesId: read.movesId });
  if (!written) {
    // Nothing was written: the token was used meanwhile, or the suggestion or call changed meanwhile.
    const row = await ctx.db.prepare(`SELECT ${HELD_COLUMNS} FROM call_proposal WHERE id = ?1`).bind(input.token).first<Record<string, unknown>>();
    if (row) return replayed(ctx, caller, input, { ...sent, row });
    throw conflict(read.answered ? ANSWERED : read.moved ? STARTED : WAITING);
  }
  const card = await postProposalCard(ctx, caller, sent.channel, input.token, suggestedLine({
    purpose: sent.purpose, workTitle: sent.workTitle, times, minutes: sent.bookedMinutes,
    kind: read.movesId ? "move" : read.answered ? "instead" : "new",
    movesFrom: (read.moved?.scheduledStartAt as number | undefined) ?? null, now: ctx.now,
  }));
  ctx.afterEvent?.({ kind: "proposed", proposalId: input.token, countered: read.answered !== null });
  return { proposalId: input.token, channelId: sent.channel.id, counterpart: sent.counterpart, card };
}

/** What a suggestion is checked against, read in one round trip. */
interface SuggestionTargets {
  conversation: Record<string, unknown> | null;
  work: Record<string, unknown> | null;
  /** The other person's suggestion this answers, when `instead` names one. */
  answered: Record<string, unknown> | null;
  /** The booked call these times would move, and its id. */
  moved: Record<string, unknown> | null;
  movesId: string | null;
  recent: number;
  /** A suggestion the token already holds (a form sent again). */
  held: Record<string, unknown> | null;
}

async function readSuggestionTargets(ctx: CallsContext, caller: CallCaller, input: SuggestInput): Promise<SuggestionTargets> {
  const { db, now } = ctx;
  const [conversations, works, insteads, changes, recent, held] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT c.id AS channelId, c.kind, c.programId, c.postingPolicy, c.archivedAt,
        EXISTS (SELECT 1 FROM channel_member WHERE channelId = c.id AND userId = ?2) AS isMember, ${counterpartColumn("c.id", "?2")} AS counterpart
      FROM channel c WHERE c.id = ?1`).bind(input.conversationId, caller.userId),
    db.prepare(`SELECT j.id, j.title, j.version FROM communityJourney j WHERE j.id = ?1
      AND j.userId IN (SELECT userId FROM channel_member WHERE channelId = ?2) AND ${postedWorkEligibility("j", true)}`)
      .bind(input.journeyId ?? "", input.conversationId),
    db.prepare("SELECT channelId, proposedBy, state, times, meetingId FROM call_proposal WHERE id = ?1").bind(input.instead ?? ""),
    // The booked call these times would move: the one `change` names, or the one the answered suggestion would.
    db.prepare(`SELECT id, channelId, purpose, state, scheduledStartAt, journeyId, journeyVersion FROM meeting
      WHERE id = coalesce(nullif(?1, ''), (SELECT meetingId FROM call_proposal WHERE id = ?2))`).bind(input.change ?? "", input.instead ?? ""),
    db.prepare("SELECT count(*) AS n FROM call_proposal WHERE proposedBy = ?1 AND createdAt > ?2").bind(caller.userId, now - DAY_MS),
    db.prepare(`SELECT ${HELD_COLUMNS} FROM call_proposal WHERE id = ?1`).bind(input.token),
  ]);
  const answered = input.instead ? insteads.results[0] ?? null : null;
  const movesId = input.change ?? (answered?.meetingId as string | null | undefined) ?? null;
  return {
    conversation: conversations.results[0] ?? null, work: works.results[0] ?? null, answered,
    moved: movesId !== null ? changes.results[0] ?? null : null, movesId,
    recent: Number(recent.results[0]?.n ?? 0), held: held.results[0] ?? null,
  };
}

/** What the form asked for, once checked: what a replay must match, and what the card says. */
interface SentSuggestion {
  channel: ConversationTarget;
  counterpart: Counterpart;
  purpose: CallProposalPurpose;
  journeyId: string | null;
  journeyVersion: number | null;
  workTitle: string | null;
  bookedMinutes: number;
}

/**
 * The conversation, the suggestion answered and the call moved must be the caller's own, else the same
 * 404. A round of new times for a booked call keeps what the call is: its purpose and its work; a new
 * check-in names posted work of one of the two members. A check-in is always CHECKIN_LIMIT_MINUTES.
 */
function checkedSuggestion(caller: CallCaller, input: SuggestInput, { conversation, work, answered, moved, movesId }: SuggestionTargets): SentSuggestion {
  if (!conversation) throw notFound();
  const channel = targetOf(conversation);
  const counterpart = counterpartOf(conversation.counterpart);
  if (!counterpart || !accessIn(caller, channel, "CALL", conversation.isMember).canHost) throw notFound();
  if (input.instead && answered?.channelId !== channel.id) throw notFound();
  if (movesId !== null && (moved?.channelId !== channel.id || (moved.purpose !== "CALL" && moved.purpose !== "CHECKIN"))) throw notFound();

  const purpose = moved ? moved.purpose as CallProposalPurpose : input.purpose;
  const journey = journeyOf(purpose, moved, work);
  const bookedMinutes = purpose === "CHECKIN" ? CHECKIN_LIMIT_MINUTES : input.bookedMinutes;
  if (!CALL_LENGTHS.includes(bookedMinutes) || bookedMinutes > LIMIT_MINUTES[purpose]) throw invalid(`Choose a length of up to ${LIMIT_MINUTES.CALL} minutes.`);
  return { channel, counterpart, purpose, ...journey, bookedMinutes };
}

/** A suggestion's work: the moved call's, or, for a new check-in, the posted work it names; none for a plain call. */
function journeyOf(
  purpose: CallProposalPurpose, moved: Record<string, unknown> | null, work: Record<string, unknown> | null,
): Pick<SentSuggestion, "journeyId" | "journeyVersion" | "workTitle"> {
  if (moved) {
    return moved.journeyVersion === null ? { journeyId: null, journeyVersion: null, workTitle: null }
      : { journeyId: moved.journeyId as string | null, journeyVersion: moved.journeyVersion as number, workTitle: null };
  }
  if (purpose !== "CHECKIN") return { journeyId: null, journeyVersion: null, workTitle: null };
  if (!work) throw invalid("Choose the work this check-in is about.");
  return { journeyId: work.id as string, journeyVersion: work.version as number, workTitle: work.title as string };
}

/** The refusals a new suggestion gets for what changed since the form was shown: answered, started, or the day's limit. */
function refuseStale(now: number, caller: CallCaller, { answered, moved, recent }: SuggestionTargets): void {
  if (answered) {
    if (answered.proposedBy === caller.userId) throw notFound();
    if (answered.state !== "OPEN" || hasExpired(proposedTimes(answered.times), now)) throw conflict(ANSWERED);
  }
  if (moved && moved.state !== "SCHEDULED") throw conflict(STARTED);
  if (recent >= CALL_PROPOSALS_PER_DAY) {
    throw new ChannelError("rate_limited", `You can suggest up to ${CALL_PROPOSALS_PER_DAY} calls a day. Try again tomorrow.`, 429);
  }
}

/**
 * The suggestion's one batch: an open suggestion whose times have all started is closed as expired
 * (leaving the way open); the one answered is declined, at this very moment, and its card moved; then
 * this one is made, only if the token is unused, the daily limit allows it, the answered one was
 * declined by this write, and any call it moves still waits. True when it was made.
 */
async function writeSuggestion(
  ctx: CallsContext, caller: CallCaller, input: SuggestInput, sent: SentSuggestion & { times: number[]; movesId: string | null },
): Promise<boolean> {
  const { db, now } = ctx;
  const instead = input.instead ?? "";
  // ?1 conversation, ?2 the caller, ?3 now, ?4 the token, ?5 the answered suggestion, ?6 the daily limit's window start, ?7 the limit.
  const allowed = `NOT EXISTS (SELECT 1 FROM call_proposal WHERE id = ?4)
    AND (SELECT count(*) FROM call_proposal WHERE proposedBy = ?2 AND createdAt > ?6) < ?7`;
  const answeredNow = "EXISTS (SELECT 1 FROM call_proposal WHERE id = ?5 AND state = 'DECLINED' AND decidedAt = ?3)";
  const base = [input.conversationId, caller.userId, now, input.token, instead, now - DAY_MS, CALL_PROPOSALS_PER_DAY] as const;
  const statements = [
    db.prepare(`UPDATE call_proposal SET state = 'EXPIRED', decidedAt = ?2, updatedAt = ?2
      WHERE channelId = ?1 AND state = 'OPEN' AND id <> ?3 AND NOT EXISTS (SELECT 1 FROM json_each(times) WHERE value > ?2)`)
      .bind(input.conversationId, now, instead),
  ];
  if (instead) {
    statements.push(
      db.prepare(`UPDATE call_proposal SET state = 'DECLINED', decidedAt = ?3, updatedAt = ?3
        WHERE id = ?5 AND channelId = ?1 AND state = 'OPEN' AND proposedBy <> ?2
          AND EXISTS (SELECT 1 FROM json_each(times) WHERE value > ?3) AND ${allowed}`).bind(...base),
      db.prepare(touchProposalCard("?1", "EXISTS (SELECT 1 FROM call_proposal WHERE id = ?1 AND state = 'DECLINED' AND decidedAt = ?2)"))
        .bind(instead, now),
    );
  }
  statements.push(db.prepare(`INSERT INTO call_proposal (id, channelId, proposedBy, purpose, journeyId, journeyVersion, times,
      bookedMinutes, askToRecord, state, meetingId, createdAt, updatedAt)
    SELECT ?4, ?1, ?2, ?8, ?9, ?10, ?11, ?12, ?13, 'OPEN', ?14, ?3, ?3
    WHERE ${allowed} AND (?5 = '' OR ${answeredNow})
      AND (?14 IS NULL OR EXISTS (SELECT 1 FROM meeting WHERE id = ?14 AND channelId = ?1 AND state = 'SCHEDULED'))
    RETURNING id`).bind(
    ...base, sent.purpose, sent.journeyId, sent.journeyVersion, JSON.stringify(sent.times), sent.bookedMinutes, input.askToRecord ? 1 : 0, sent.movesId,
  ));
  try {
    const results = await db.batch(statements);
    return results.at(-1)?.results.length === 1;
  } catch (error) {
    // Another suggestion is open here (two people suggesting at once): the database keeps it to one.
    if (error instanceof Error && UNIQUE_OPEN.test(error.message)) throw conflict(WAITING);
    throw error;
  }
}

/**
 * A form sent again: its own suggestion, the same in every respect, answers as the first did (posting
 * its card only if the first couldn't); the same token with anything else changed is a 409, and a
 * token holding someone else's suggestion, or one in another conversation, the same 404.
 */
async function replayed(
  ctx: CallsContext, caller: CallCaller, input: SuggestInput, sent: SentSuggestion & { row: Record<string, unknown> },
): Promise<Suggested> {
  const { channel, counterpart, row } = sent;
  if (row.proposedBy !== caller.userId || row.channelId !== channel.id) throw notFound();
  const times = proposedTimes(row.times);
  const asked = [...new Set(input.times)].toSorted((a, b) => a - b);
  const same = row.purpose === sent.purpose && (row.journeyId ?? null) === sent.journeyId && row.bookedMinutes === sent.bookedMinutes
    && (row.askToRecord === 1) === input.askToRecord && times.length === asked.length && times.every((time, i) => time === asked[i]);
  if (!same) throw conflict("This form was already sent. Open Suggest a call again.");
  // Only the card a first request couldn't post is posted again; the nonce keeps it to one.
  const card = row.messageId !== null ? "posted"
    : await postProposalCard(ctx, caller, channel, input.token, suggestedLine({
      purpose: sent.purpose, workTitle: null, times, minutes: sent.bookedMinutes, kind: row.meetingId ? "move" : "new", movesFrom: null, now: ctx.now,
    }));
  return { proposalId: input.token, channelId: channel.id, counterpart, card };
}

function postProposalCard(ctx: CallsContext, caller: CallCaller, channel: ConversationTarget, proposalId: string, body: string): Promise<NoteOutcome> {
  return postLine(ctx, caller, channel, body, `call-proposal-${proposalId}`, {
    embed: { type: "callProposal", proposalId },
    attach: (messageId) => ctx.db.prepare("UPDATE call_proposal SET messageId = ?2 WHERE id = ?1 AND messageId IS NULL").bind(proposalId, messageId).run(),
  });
}

// ---------------------------------------------------------------------------------------------------
// Answering

/** Picking one of the times, saying "Not now" (the other person), or taking it back (the suggester). */
export type ProposalAnswer = { kind: "pick"; at: number } | { kind: "notNow" } | { kind: "withdraw" };

export interface Answered {
  proposal: CallProposal;
  /** The call a picked time booked or moved. */
  meetingId: string | null;
  /** Whether the booked call's card reached the conversation (a new booking only). */
  card: NoteOutcome | null;
}

/**
 * Answers a suggestion. Only the other person picks a time or says "Not now", and only the suggester
 * withdraws: anything else is the same 404. Answering again the same way changes nothing; a suggestion
 * answered otherwise, or whose times have all passed (it is then closed as expired), is a 409 that
 * offers no action. Picking a time books the call (its id is the suggestion's, made in the same write)
 * and posts its card, or, for a round of new times, moves the booked call, which its card shows at once.
 * "Not now" is written on the suggestion and nowhere else.
 */
export async function answerProposal(ctx: CallsContext, caller: CallCaller, proposalId: string, answer: ProposalAnswer): Promise<Answered> {
  const { db, now } = ctx;
  const before = await readProposalRow(db, caller, proposalId, now);
  const { proposal } = before;
  if (!before.access.canHost) throw notFound();
  const byProposer = answer.kind === "withdraw";
  if (proposal.mine !== byProposer) throw notFound();

  const again = alreadyAnswered(before, answer);
  if (again) return { proposal, meetingId: proposal.call?.id ?? null, card: null };
  if (before.stored !== "OPEN") throw conflict(ANSWERED);
  if (proposal.state === "expired") {
    await db.batch([
      db.prepare(`UPDATE call_proposal SET state = 'EXPIRED', decidedAt = ?2, updatedAt = ?2 WHERE id = ?1 AND state = 'OPEN'
        AND NOT EXISTS (SELECT 1 FROM json_each(times) WHERE value > ?2)`).bind(proposalId, now),
      db.prepare(touchProposalCard("?1")).bind(proposalId),
    ]);
    throw conflict(PASSED);
  }

  if (answer.kind !== "pick") {
    const state = answer.kind === "notNow" ? "DECLINED" : "WITHDRAWN";
    const [written] = await db.batch([
      db.prepare(`UPDATE call_proposal SET state = ?3, decidedAt = ?2, updatedAt = ?2
        WHERE id = ?1 AND state = 'OPEN' AND (proposedBy = ?4) = ?5 AND EXISTS (SELECT 1 FROM json_each(times) WHERE value > ?2) RETURNING id`)
        .bind(proposalId, now, state, caller.userId, byProposer ? 1 : 0),
      db.prepare(touchProposalCard("?1", "EXISTS (SELECT 1 FROM call_proposal WHERE id = ?1 AND state = ?3 AND decidedAt = ?2)"))
        .bind(proposalId, now, state),
    ]);
    if (written.results.length !== 1) return settled(ctx, caller, proposalId, answer);
    return { proposal: await readProposal(db, caller, proposalId, now), meetingId: null, card: null };
  }

  if (!proposal.times.includes(answer.at)) throw invalid("Pick one of the times suggested.");
  if (answer.at <= now) throw conflict("That time has passed. Pick another, or suggest new times.");
  await requireConduct(db, caller);
  return proposal.call ? moveBookedCall(ctx, caller, before, answer.at) : bookCall(ctx, caller, before, answer.at);
}

/** Whether this answer was already given: a repeated request (a double submit, a retry) changes nothing. */
function alreadyAnswered({ stored, proposal }: ProposalRow, answer: ProposalAnswer): boolean {
  switch (answer.kind) {
    case "withdraw": return stored === "WITHDRAWN";
    case "notNow": return stored === "DECLINED" && proposal.state === "declined";
    case "pick": return stored === "ACCEPTED" && proposal.call !== null && proposal.call.scheduledStartAt === answer.at;
  }
}

/** After a write that changed nothing: someone answered first. The same answer is a replay; any other, a 409. */
async function settled(ctx: CallsContext, caller: CallCaller, proposalId: string, answer: ProposalAnswer): Promise<Answered> {
  const after = await readProposalRow(ctx.db, caller, proposalId, ctx.now);
  if (alreadyAnswered(after, answer)) return { proposal: after.proposal, meetingId: after.proposal.call?.id ?? null, card: null };
  throw conflict(after.proposal.state === "expired" ? PASSED : after.proposal.call && after.stored === "OPEN" ? STARTED : ANSWERED);
}

/** The picked time books the call: its id is the suggestion's, written with the answer in one batch, then its card is posted. */
async function bookCall(ctx: CallsContext, caller: CallCaller, before: ProposalRow, at: number): Promise<Answered> {
  const { db, now } = ctx;
  const { proposal } = before;
  const title = callTitle(proposal.purpose, proposal.work?.title ?? null);
  // ?1 the suggestion (and the call's id), ?2 the caller, ?3 now, ?4 the picked time.
  const open = `p.id = ?1 AND p.state = 'OPEN' AND p.meetingId IS NULL AND p.proposedBy <> ?2 AND ?4 > ?3
    AND EXISTS (SELECT 1 FROM json_each(p.times) WHERE value = ?4)`;
  const booked = "EXISTS (SELECT 1 FROM meeting WHERE id = ?1 AND createdBy = ?2 AND createdAt = ?3)";
  const results = await db.batch([
    db.prepare(`INSERT INTO meeting (id, channelId, purpose, title, scheduledStartAt, bookedMinutes, limitMinutes, recordingPolicy, state,
        journeyId, journeyVersion, createdBy, createdAt, updatedAt)
      SELECT p.id, p.channelId, p.purpose, ?5, ?4, p.bookedMinutes, ?6, CASE WHEN p.askToRecord = 1 THEN 'BOTH_AGREE' ELSE 'NONE' END,
        'SCHEDULED', p.journeyId, p.journeyVersion, ?2, ?3, ?3
      FROM call_proposal p WHERE ${open} AND NOT EXISTS (SELECT 1 FROM meeting WHERE id = ?1)`)
      .bind(proposal.id, caller.userId, now, at, title, LIMIT_MINUTES[proposal.purpose]),
    db.prepare(`UPDATE call_proposal SET state = 'ACCEPTED', meetingId = ?1, decidedAt = ?3, updatedAt = ?3
      WHERE id = ?1 AND state = 'OPEN' AND ${booked} RETURNING id`).bind(proposal.id, caller.userId, now),
    db.prepare(touchProposalCard("?1", "EXISTS (SELECT 1 FROM call_proposal WHERE id = ?1 AND state = 'ACCEPTED' AND decidedAt = ?2)"))
      .bind(proposal.id, now),
  ]);
  if (results[1]?.results.length !== 1) return settled(ctx, caller, proposal.id, { kind: "pick", at });
  const card = await postLine(ctx, caller, before.channel, bookedLine(proposal.purpose, at, proposal.bookedMinutes, now),
    `call-booked-${proposal.id}`, { embed: { type: "meeting", meetingId: proposal.id }, attach: (messageId) => attachCard(db, proposal.id, messageId) });
  ctx.afterEvent?.({ kind: "booked", proposalId: proposal.id, meetingId: proposal.id });
  return { proposal: await readProposal(db, caller, proposal.id, now), meetingId: proposal.id, card };
}

/**
 * The picked time of a round of new times moves the booked call, while it still hasn't opened: one
 * batch moves it, with the round's length and "Ask to record" (raising updatedAt by at least a second,
 * so its calendar file's SEQUENCE rises), marks the round answered and moves both cards for open pages.
 */
async function moveBookedCall(ctx: CallsContext, caller: CallCaller, before: ProposalRow, at: number): Promise<Answered> {
  const { db, now } = ctx;
  const { proposal } = before;
  const meetingId = proposal.call!.id;
  // ?1 the suggestion, ?2 the call, ?3 the caller, ?4 now, ?5 the picked time.
  const results = await db.batch([
    db.prepare(`UPDATE meeting SET scheduledStartAt = ?5, bookedMinutes = (SELECT bookedMinutes FROM call_proposal WHERE id = ?1),
        recordingPolicy = (SELECT CASE WHEN askToRecord = 1 THEN 'BOTH_AGREE' ELSE 'NONE' END FROM call_proposal WHERE id = ?1),
        updatedAt = max(?4, updatedAt + 1000)
      WHERE id = ?2 AND state = 'SCHEDULED' AND EXISTS (SELECT 1 FROM call_proposal p WHERE p.id = ?1 AND p.state = 'OPEN' AND p.meetingId = ?2
        AND p.proposedBy <> ?3 AND ?5 > ?4 AND EXISTS (SELECT 1 FROM json_each(p.times) WHERE value = ?5))`)
      .bind(proposal.id, meetingId, caller.userId, now, at),
    db.prepare(`UPDATE call_proposal SET state = 'ACCEPTED', decidedAt = ?4, updatedAt = ?4
      WHERE id = ?1 AND state = 'OPEN' AND EXISTS (SELECT 1 FROM meeting WHERE id = ?2 AND state = 'SCHEDULED' AND scheduledStartAt = ?5
        AND updatedAt >= ?4) RETURNING id`).bind(proposal.id, meetingId, caller.userId, now, at),
    db.prepare(touchProposalCard("?1", "EXISTS (SELECT 1 FROM call_proposal WHERE id = ?1 AND state = 'ACCEPTED' AND decidedAt = ?2)"))
      .bind(proposal.id, now),
    db.prepare(touchMeetingCard("?1", "EXISTS (SELECT 1 FROM call_proposal WHERE meetingId = ?1 AND state = 'ACCEPTED' AND decidedAt = ?2)"))
      .bind(meetingId, now),
  ]);
  if (results[1]?.results.length !== 1) return settled(ctx, caller, proposal.id, { kind: "pick", at });
  ctx.afterEvent?.({ kind: "booked", proposalId: proposal.id, meetingId });
  return { proposal: await readProposal(db, caller, proposal.id, now), meetingId, card: null };
}

// ---------------------------------------------------------------------------------------------------
// Cancelling

/**
 * Cancels a booked call that hasn't started, tells the other person in the conversation (and their
 * Attention), and closes any round of new times for it. Cancelling again changes nothing; a call that
 * has started is ended from the call instead (409). `known` is the call as the page already read it.
 */
export async function cancelBookedCall(
  ctx: CallsContext, caller: CallCaller, meetingId: string, { known }: { known?: BookedCall } = {},
): Promise<{ call: BookedCall; note: NoteOutcome | null }> {
  const { db, now } = ctx;
  const before = known?.id === meetingId && caller.checkins ? known : await readBookedCall(db, caller, meetingId, now);
  if (!before.access.canHost) throw notFound();
  if (before.state === "CANCELLED") return { call: before, note: null };
  if (before.state !== "SCHEDULED") throw conflict("This call has already started, so it can't be cancelled. End it from the call instead.");
  // ?1 the call, ?2 now.
  const cancelledNow = "EXISTS (SELECT 1 FROM meeting WHERE id = ?1 AND state = 'CANCELLED' AND updatedAt >= ?2)";
  const [cancelled] = await db.batch([
    db.prepare(`UPDATE meeting SET state = 'CANCELLED', updatedAt = max(?2, updatedAt + 1000) WHERE id = ?1 AND state = 'SCHEDULED'
      RETURNING state, updatedAt`).bind(meetingId, now),
    db.prepare(`UPDATE channel_message SET changeSeq = (SELECT MAX(x.changeSeq) + 1 FROM channel_message x WHERE x.channelId = channel_message.channelId)
      WHERE id IN (SELECT messageId FROM call_proposal WHERE meetingId = ?1 AND state = 'OPEN') AND ${cancelledNow}`).bind(meetingId, now),
    db.prepare(`UPDATE call_proposal SET state = 'WITHDRAWN', decidedAt = ?2, updatedAt = ?2 WHERE meetingId = ?1 AND state = 'OPEN' AND ${cancelledNow}`)
      .bind(meetingId, now),
    db.prepare(touchMeetingCard("?1", cancelledNow)).bind(meetingId, now),
  ]);
  const row = cancelled.results[0] as { state: MeetingState; updatedAt: number } | undefined;
  if (!row) {
    const after = await readBookedCall(db, caller, meetingId, now);
    if (after.state === "CANCELLED") return { call: after, note: null };
    throw conflict("This call has already started, so it can't be cancelled. End it from the call instead.");
  }
  // Cancelling is never held back by the code of conduct: the line saying so is, like any post, and the page says to tell them.
  const note = await postLine(ctx, caller, before.channel, cancelledLine(before.scheduledStartAt, now), `call-cancelled-${meetingId}`);
  ctx.afterEvent?.({ kind: "cancelled", meetingId, byUserId: caller.userId });
  return { call: { ...before, ...row, pendingChange: null }, note };
}
