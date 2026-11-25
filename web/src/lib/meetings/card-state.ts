import { MeetingCardView, type MeetingCardState, type MeetingNotRecordedReason } from "@/lib/platform/contracts";
import type { MeetingPurpose, MeetingRecordingState, MeetingState } from "./rules";

/**
 * A call's card as its channel's readers see it (README.md beside this file, "The session card"): the
 * stored embed names the call, and everything else is worked out on each read of the message from the
 * call and its recording (channels/embeds.ts, meetingCardColumn), never stored. Pure, so the channel
 * reads can use it without the meetings module's writes.
 */

/** What meetingCardColumn reads for one card, or null when its call is gone or in another channel. */
interface CardCheck {
  purpose: MeetingPurpose;
  title: string;
  state: MeetingState;
  scheduledStartAt: number;
  bookedMinutes: number;
  openedAt: number | null;
  endedAt: number | null;
  /** The recording's way in (meeting_recording), when it has one. */
  capture: MeetingRecordingState | null;
  /** 1 when any recording came from this call, whoever may watch it. */
  linked: number;
  /** [id, video stored, transcript ready, processing failed] of the recording the whole channel may watch. */
  recording: unknown;
}

/** A recording still on its way in: the card says it will be here when it's ready. */
const ON_ITS_WAY: ReadonlySet<MeetingRecordingState> = new Set(["STARTING", "RECORDING", "STOPPED", "PROMOTED"]);
const NOT_RECORDED: Partial<Record<MeetingRecordingState, MeetingNotRecordedReason>> = { REFUSED: "limit", TOO_SHORT: "short" };

/** The recording as SQL hands it over: a JSON array, or its text where a subquery dropped the JSON subtype. */
function recordingOf(value: unknown): { id: string; video: boolean; transcript: boolean; failed: boolean } | null {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value) as unknown; } catch { return null; }
  }
  if (!Array.isArray(parsed) || typeof parsed[0] !== "string") return null;
  return { id: parsed[0], video: parsed[1] === 1, transcript: parsed[2] === 1, failed: parsed[3] === 1 };
}

/** How an ended call's card stands: its recording ready, on its way, failed, not made, or no longer shown here. */
function afterTheCall(check: CardCheck): { state: MeetingCardState; recordingId: string | null; transcriptReady: boolean; reason: MeetingNotRecordedReason | null } {
  const none = { recordingId: null, transcriptReady: false, reason: null };
  const recording = recordingOf(check.recording);
  if (recording) {
    if (recording.video || recording.transcript) {
      return { state: "ready", recordingId: recording.id, transcriptReady: recording.transcript, reason: null };
    }
    return { ...none, state: recording.failed ? "failed" : "processing" };
  }
  // A recording exists but the channel may no longer watch it (hidden or removed): never "not recorded".
  if (check.linked === 1) return { ...none, state: "ended" };
  return { ...none, ...captureOutcome(check.capture) };
}

/**
 * How a call that ended with no recording yet stands, from its recording's way in: on its way
 * (processing), failed, or not recorded, with why where TTV knows. No way in at all is "not recorded":
 * nothing was asked of the provider (the fake provider records nothing).
 */
export function captureOutcome(capture: MeetingRecordingState | null): { state: Extract<MeetingCardState, "processing" | "failed" | "notRecorded">; reason: MeetingNotRecordedReason | null } {
  if (capture === "FAILED") return { state: "failed", reason: null };
  if (capture !== null && ON_ITS_WAY.has(capture)) return { state: "processing", reason: null };
  return { state: "notRecorded", reason: capture === null ? null : NOT_RECORDED[capture] ?? null };
}

const CALL_STATE: Record<Exclude<MeetingState, "ENDED">, MeetingCardState> = { SCHEDULED: "scheduled", LIVE: "live", CANCELLED: "cancelled" };

/** The card for a stored meeting embed, from its check; null when its call can't be shown here. */
export function meetingCard(meetingId: string, check: unknown): MeetingCardView | null {
  if (!check || typeof check !== "object" || Array.isArray(check)) return null;
  const facts = check as CardCheck;
  const after = facts.state === "ENDED" ? afterTheCall(facts)
    : { state: CALL_STATE[facts.state], recordingId: null, transcriptReady: false, reason: null };
  const card = MeetingCardView.safeParse({
    type: "meeting", meetingId, purpose: facts.purpose, title: facts.title, state: after.state,
    scheduledStartAt: facts.scheduledStartAt, bookedMinutes: facts.bookedMinutes, openedAt: facts.openedAt, endedAt: facts.endedAt,
    recordingId: after.recordingId, transcriptReady: after.transcriptReady, notRecordedReason: after.reason,
  });
  return card.success ? card.data : null;
}

/**
 * Moves a call's card message to its channel's next changeSeq, so every open page's `since` poll
 * carries the card's new state (channels/README.md, "Reading messages"). `meeting` is the call's id as
 * SQL; `when` an extra condition, so a batch moves the card only once its change really happened. A
 * call without a card changes nothing.
 */
export const touchMeetingCard = (meeting: string, when = "1") => `UPDATE channel_message
  SET changeSeq = (SELECT MAX(x.changeSeq) + 1 FROM channel_message x WHERE x.channelId = channel_message.channelId)
  WHERE id = (SELECT messageId FROM meeting WHERE id = ${meeting}) AND ${when}`;

/**
 * Moves the card of the call a recording came from, when the recording's state changes what the card
 * offers (processed, failed, hidden or shown again). A recording from no call changes nothing.
 */
export async function touchRecordingCard(db: D1Database, recordingId: string): Promise<void> {
  await db.prepare(touchMeetingCard("(SELECT meetingId FROM recording WHERE id = ?1)")).bind(recordingId).run();
}
