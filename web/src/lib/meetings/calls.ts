import { createId } from "@paralleldrive/cuid2";
import { ChannelError } from "@/lib/channels/errors";
import { getConductAcknowledgement } from "@/lib/channels/conduct";
import type { CreateMeeting, FlagKey, Meeting, MeetingJoin } from "@/lib/platform/contracts";
import type { ChannelAccessTarget, PlatformCapabilities } from "@/lib/platform/server/capabilities";
import type { Flags } from "@/lib/platform/server/flags";
import { meetingAccessFor, type MeetingAccess } from "./access";
import { advanceMeeting, cancelMeeting, endMeeting, openMeeting, type CallContext } from "./clock";
import { presenceRecording, type FakePresence } from "./fake-presence";
import { CallProviderError } from "./provider";
import { abandonClaim, attachParticipant, claimSeat, revokeParticipants, vacateSeat } from "./seats";
import {
  CALL_LIMIT_MINUTES, CHECKIN_LIMIT_MINUTES,
  type MeetingEndReason, type MeetingPurpose, type MeetingRecordingPolicy, type MeetingRecordingState, type MeetingSeatRole,
  type MeetingSeatState, type MeetingState,
} from "./rules";

/**
 * What the meeting routes do once http.ts has admitted the caller (README.md beside this file, "The
 * API"). Every call, channel or person the caller may not see is the same 404, whatever the reason:
 * no route confirms that a call exists to anyone outside its channel. A person who can see a call is
 * told its state instead (not started, ended, full: 409) and asked to agree to the code of conduct
 * before they create or join one (403 conduct_required, as when posting).
 */

/** The flag each purpose needs beyond `meetings` (effective only while `meetings` is; flags.ts REQUIRES). */
export const PURPOSE_FLAG: Record<MeetingPurpose, FlagKey> = {
  SESSION: "meetings", CHECKIN: "meeting_checkins", CALL: "meeting_checkins", EVENT: "meeting_events",
};

/** Every call ends this long after its room opens; a check-in, this long after both people are in. */
export const LIMIT_MINUTES: Record<MeetingPurpose, number> = {
  SESSION: CALL_LIMIT_MINUTES, CALL: CALL_LIMIT_MINUTES, EVENT: CALL_LIMIT_MINUTES, CHECKIN: CHECKIN_LIMIT_MINUTES,
};

/** The caller, as the routes know them. Capabilities and flags come from the database, never from locals. */
export interface Caller {
  userId: string;
  capabilities: PlatformCapabilities;
  flags: Flags;
  /** The code of conduct version joining and creating need (a test seam). */
  conductVersion?: number;
}

export const notFound = () => new ChannelError("not_found", "Not found.", 404);
const conflict = (message: string) => new ChannelError("conflict", message, 409);
const ENDED = "This call has ended.";

/** A call with its channel's access facts and the caller's seat. */
interface Target {
  id: string; channelId: string; purpose: MeetingPurpose; title: string; scheduledStartAt: number;
  bookedMinutes: number; limitMinutes: number; recordingPolicy: MeetingRecordingPolicy; state: MeetingState;
  openedAt: number | null; hardEndAt: number | null; endedAt: number | null; endReason: MeetingEndReason | null;
  providerMeetingId: string | null; seatsHeld: number;
  channel: ChannelAccessTarget; isMember: boolean;
  seatRole: MeetingSeatRole | null; seatState: MeetingSeatState | null; viewerName: string;
}

/** One read: the call, its channel, whether the caller is a member of it, their seat, the held seats and their name. */
async function readTarget(db: D1Database, meetingId: string, userId: string): Promise<Target | null> {
  const row = await db.prepare(`SELECT m.id, m.channelId, m.purpose, m.title, m.scheduledStartAt, m.bookedMinutes, m.limitMinutes,
      m.recordingPolicy, m.state, m.openedAt, m.hardEndAt, m.endedAt, m.endReason, m.providerMeetingId,
      c.kind, c.programId, c.postingPolicy, c.archivedAt,
      EXISTS (SELECT 1 FROM channel_member WHERE channelId = c.id AND userId = ?2) AS isMember,
      s.role AS seatRole, s.state AS seatState,
      (SELECT count(*) FROM meeting_seat WHERE meetingId = m.id AND state = 'HELD') AS seatsHeld,
      coalesce((SELECT name FROM "user" WHERE id = ?2), '') AS viewerName
    FROM meeting m JOIN channel c ON c.id = m.channelId
    LEFT JOIN meeting_seat s ON s.meetingId = m.id AND s.userId = ?2
    WHERE m.id = ?1`).bind(meetingId, userId).first<Record<string, unknown>>();
  if (!row) return null;
  const { kind, programId, postingPolicy, archivedAt, isMember, ...call } = row;
  return {
    ...call as Omit<Target, "channel" | "isMember">,
    channel: { kind, programId, postingPolicy, archivedAt } as ChannelAccessTarget,
    isMember: isMember === 1,
  };
}

/** The call and what the caller may do in it, or the same 404 when they may not see it. */
async function visible(ctx: CallContext, caller: Caller, meetingId: string): Promise<{ target: Target; access: MeetingAccess }> {
  const target = await readTarget(ctx.db, meetingId, caller.userId);
  if (!target || !caller.flags[PURPOSE_FLAG[target.purpose]]) throw notFound();
  const access = meetingAccessFor(caller.capabilities, target.channel, target.purpose, { isMember: target.isMember });
  if (!access.canSee) throw notFound();
  return { target, access };
}

/**
 * The call as it is now: a live call is first brought up to date by the clock (ended at its limit,
 * with nobody in it, with no host), so no route acts on a call that should already have ended.
 */
async function current(ctx: CallContext, caller: Caller, meetingId: string) {
  const found = await visible(ctx, caller, meetingId);
  if (found.target.state !== "LIVE" || await advanceMeeting(ctx, meetingId) === "LIVE") return found;
  return visible(ctx, caller, meetingId);
}

function view({ target, access }: { target: Target; access: MeetingAccess }, now: number): Meeting {
  const removed = target.seatState === "REMOVED";
  const open = target.state === "LIVE" || (target.state === "SCHEDULED" && access.canHost);
  return {
    id: target.id, channelId: target.channelId, purpose: target.purpose, title: target.title,
    scheduledStartAt: target.scheduledStartAt, bookedMinutes: target.bookedMinutes, limitMinutes: target.limitMinutes,
    recordingPolicy: target.recordingPolicy, state: target.state, openedAt: target.openedAt, hardEndAt: target.hardEndAt,
    endedAt: target.endedAt, endReason: target.endReason, seatsHeld: target.seatsHeld,
    you: { canJoin: access.canJoin && open && !removed, canHost: access.canHost, seat: target.seatState, role: target.seatRole },
    now,
  };
}

async function requireConduct(ctx: CallContext, caller: Caller): Promise<void> {
  const agreed = await getConductAcknowledgement(ctx.db, caller.userId, { currentVersion: caller.conductVersion });
  if (!agreed?.current) throw new ChannelError("conduct_required", "Agree to how we talk to each other before you join a call.", 403);
}

function providerOf(ctx: CallContext) {
  if (!ctx.provider) throw new CallProviderError("createMeeting", "Calls have no provider here.");
  return ctx.provider;
}

export async function getMeeting(ctx: CallContext, caller: Caller, meetingId: string): Promise<Meeting> {
  return view(await current(ctx, caller, meetingId), ctx.now);
}

const RECORDING_FOR: Record<CreateMeeting["purpose"], (input: CreateMeeting) => MeetingRecordingPolicy> = {
  SESSION: () => "ALWAYS",
  CALL: () => "BOTH_AGREE",
  EVENT: (input) => input.purpose === "EVENT" && input.record ? "HOST" : "NONE",
};

/**
 * A new scheduled call in a channel the caller hosts in. The purpose decides everything else: its
 * channel's kind (a session only in a cohort channel, which ties it to that cohort), its limit and
 * how it is recorded. Nothing is made at the provider until a host opens the room.
 */
export async function createMeeting(ctx: CallContext, caller: Caller, input: CreateMeeting): Promise<Meeting> {
  if (!caller.flags[PURPOSE_FLAG[input.purpose]]) throw notFound();
  const channel = await ctx.db.prepare(`SELECT kind, programId, postingPolicy, archivedAt,
      EXISTS (SELECT 1 FROM channel_member WHERE channelId = channel.id AND userId = ?2) AS isMember
    FROM channel WHERE id = ?1`).bind(input.channelId, caller.userId).first<ChannelAccessTarget & { isMember: number }>();
  if (!channel) throw notFound();
  const access = meetingAccessFor(caller.capabilities, channel, input.purpose, { isMember: channel.isMember === 1 });
  if (!access.canHost) throw notFound();
  await requireConduct(ctx, caller);
  const id = createId();
  await ctx.db.prepare(`INSERT INTO meeting (id, channelId, purpose, title, scheduledStartAt, bookedMinutes, limitMinutes,
      recordingPolicy, state, createdBy, createdAt, updatedAt)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'SCHEDULED', ?9, ?10, ?10)`).bind(
    id, input.channelId, input.purpose, input.title, input.scheduledStartAt, input.bookedMinutes, LIMIT_MINUTES[input.purpose],
    RECORDING_FOR[input.purpose](input), caller.userId, ctx.now,
  ).run();
  return view(await visible(ctx, caller, id), ctx.now);
}

/**
 * Takes a seat and returns this tab's token. A host joining a scheduled call opens it; anyone else
 * waits for a host. The role is the server's: a host of the call joins as HOST, everyone else as
 * MEMBER. A join from a second tab replaces the first, whose token stops working.
 */
export async function joinMeeting(ctx: CallContext, caller: Caller, meetingId: string): Promise<MeetingJoin> {
  const provider = providerOf(ctx);
  let { target, access } = await current(ctx, caller, meetingId);
  if (!access.canJoin || target.seatState === "REMOVED") throw notFound();
  if (target.state === "ENDED" || target.state === "CANCELLED") throw conflict(ENDED);
  if (target.state === "SCHEDULED" && !access.canHost) throw conflict("This call hasn't started yet. It opens when a host joins.");
  await requireConduct(ctx, caller);
  if (target.state === "SCHEDULED") {
    await openMeeting(ctx, meetingId, target.title);
    ({ target, access } = await visible(ctx, caller, meetingId));
    if (target.state !== "LIVE") throw conflict(ENDED);
  }
  const providerMeetingId = target.providerMeetingId;
  if (!providerMeetingId) throw new Error("A live call has no provider meeting.");

  const claim = await claimSeat(ctx, meetingId, caller.userId, access.canHost ? "HOST" : "MEMBER");
  if (claim.outcome !== "held") {
    throw claim.outcome === "removed" ? notFound() : conflict(claim.outcome === "full" ? "This call is full." : ENDED);
  }

  let participant: { participantId: string; token: string };
  try {
    participant = await provider.addParticipant({ providerMeetingId, userId: caller.userId, name: target.viewerName });
  } catch (error) {
    await abandonClaim(ctx, meetingId, caller.userId);
    throw error;
  }
  const attached = await attachParticipant(ctx, meetingId, caller.userId, participant.participantId);
  if (!attached.attached) {
    // Removed, or the call ended, while the provider was adding them: their new token dies too.
    await revokeParticipants(ctx, meetingId, providerMeetingId, [participant.participantId]);
    const now = await visible(ctx, caller, meetingId);
    if (now.target.seatState === "REMOVED") throw notFound();
    throw conflict(ENDED);
  }
  // The participant an earlier tab held: its token stops working.
  await revokeParticipants(ctx, meetingId, providerMeetingId, [attached.replaced]);
  return { meeting: view(await visible(ctx, caller, meetingId), ctx.now), provider: provider.kind, token: participant.token };
}

/** Gives the caller's seat back. Leaving without a seat, or after the call ended, changes nothing. */
export async function leaveMeeting(ctx: CallContext, caller: Caller, meetingId: string): Promise<Meeting> {
  const { target } = await current(ctx, caller, meetingId);
  const { participantId } = await vacateSeat(ctx, meetingId, caller.userId, "RELEASED");
  if (participantId && target.providerMeetingId) {
    await revokeParticipants(ctx, meetingId, target.providerMeetingId, [participantId]);
  }
  return view(await visible(ctx, caller, meetingId), ctx.now);
}

/**
 * A host removes a member: their seat becomes REMOVED, their provider participant is deleted (so
 * their token stops working at once), and they can't join this call again. Only a member who has had
 * a seat in the call can be removed; never a host, or the caller themself. Removing again succeeds.
 */
export async function removeFromMeeting(ctx: CallContext, caller: Caller, meetingId: string, userId: string): Promise<Meeting> {
  const { target, access } = await current(ctx, caller, meetingId);
  if (!access.canHost || userId === caller.userId || target.state !== "LIVE") throw notFound();
  const { found, participantId } = await vacateSeat(ctx, meetingId, userId, "REMOVED");
  if (!found) throw notFound();
  if (participantId && target.providerMeetingId
    && !await revokeParticipants(ctx, meetingId, target.providerMeetingId, [participantId])) {
    throw new CallProviderError("deleteParticipant", "The provider did not remove them yet.");
  }
  return view(await visible(ctx, caller, meetingId), ctx.now);
}

/** A host ends a live call for everyone, or cancels one that never opened. Ending an ended call changes nothing. */
export async function endMeetingAsHost(ctx: CallContext, caller: Caller, meetingId: string): Promise<Meeting> {
  const { target, access } = await current(ctx, caller, meetingId);
  if (!access.canHost) throw notFound();
  if (target.state === "SCHEDULED") await cancelMeeting(ctx, meetingId);
  if (target.state === "LIVE") await endMeeting(ctx, meetingId, "HOST_ENDED");
  return view(await visible(ctx, caller, meetingId), ctx.now);
}

/**
 * Who holds a seat in a call, for the fake room client only (fake-presence.ts): where calls run on
 * any other provider, and for anyone without a seat in a live call, it is the same 404; a call that is
 * over says only that. A real provider tells its own client who is in the room.
 */
export async function meetingPresence(ctx: CallContext, caller: Caller, meetingId: string): Promise<FakePresence> {
  if (ctx.provider?.kind !== "fake") throw notFound();
  const { target } = await current(ctx, caller, meetingId);
  // Who is in a live call is for the people in it. That a call is over, anyone who sees it may read (its seats are gone by then).
  if (target.state !== "LIVE") {
    return { state: target.state, you: target.seatState, recording: "off", people: [] };
  }
  if (!target.seatState) throw notFound();
  // Someone removed, or who left, learns only that: who is still in is for the people in it.
  if (target.seatState !== "HELD") return { state: target.state, you: target.seatState, recording: "off", people: [] };
  const [people, recordings] = await ctx.db.batch<Record<string, unknown>>([
    ctx.db.prepare(`SELECT s.userId, coalesce(u.name, '') AS name FROM meeting_seat s JOIN "user" u ON u.id = s.userId
      WHERE s.meetingId = ?1 AND s.state = 'HELD' ORDER BY s.createdAt, s.userId`).bind(meetingId),
    ctx.db.prepare("SELECT state FROM meeting_recording WHERE meetingId = ?1").bind(meetingId),
  ]);
  const recording = (recordings.results[0]?.state ?? null) as MeetingRecordingState | null;
  return {
    state: target.state,
    you: target.seatState,
    recording: presenceRecording(target.recordingPolicy, target.state, recording),
    people: people.results.map(({ userId, name }) => ({ userId: String(userId), name: String(name) })),
  };
}
