import { CallProposalCardView, type CallProposalCardState } from "@/lib/platform/contracts";
import type { CallProposalPurpose, CallProposalState, MeetingState } from "./rules";

/**
 * A suggested call's card as its conversation reads it (README.md beside this file, "Calls between two
 * people"): the stored embed names the suggestion, and everything else is worked out on each read of
 * the message from the suggestion and the call it booked or would move (channels/embeds.ts,
 * proposalCardColumn), never stored. Pure, so the channel reads can use it without the writes.
 */

/** What proposalCardColumn reads for one card, or null when its suggestion is gone or in another channel. */
interface ProposalCheck {
  purpose: CallProposalPurpose;
  state: CallProposalState;
  proposedBy: string;
  times: unknown;
  bookedMinutes: number;
  askToRecord: number;
  /** 1 when the other person answered it with other times: a newer suggestion, theirs, made as it was declined. */
  countered: number;
  /** [title, revision] of a check-in's work while it is still posted. */
  work: unknown;
  /** [id, state, scheduledStartAt] of the call it booked or would move. */
  call: unknown;
}

/** A value as SQL hands it over: JSON, or its text where a subquery dropped the JSON subtype. */
function parsed(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

/** The moments a suggestion offers, soonest first: its stored JSON array of epoch milliseconds. */
export function proposedTimes(value: unknown): number[] {
  const list = parsed(value);
  if (!Array.isArray(list)) return [];
  return list.filter((time): time is number => Number.isSafeInteger(time) && time >= 0).toSorted((a, b) => a - b);
}

/** Whether an open suggestion has run out: every time it offers has started. Nothing can be picked from it. */
export const hasExpired = (times: readonly number[], now: number) => times.every((time) => time <= now);

/** The times of an open suggestion that can still be picked: those still to start. */
export const pickableTimes = (times: readonly number[], now: number) => times.filter((time) => time > now);

/** Where a suggestion stands, as its card says: an open one whose times have all passed is expired, whatever is stored. */
export function proposalCardState(state: CallProposalState, times: readonly number[], countered: boolean, now: number): CallProposalCardState {
  switch (state) {
    case "OPEN": return hasExpired(times, now) ? "expired" : "open";
    case "ACCEPTED": return "accepted";
    case "DECLINED": return countered ? "countered" : "declined";
    case "WITHDRAWN": return "withdrawn";
    case "EXPIRED": return "expired";
  }
}

function workOf(value: unknown): { title: string; version: number } | null {
  const work = parsed(value);
  if (!Array.isArray(work) || typeof work[0] !== "string" || !Number.isSafeInteger(work[1])) return null;
  return { title: work[0], version: work[1] as number };
}

function callOf(value: unknown): { meetingId: string; state: MeetingState; scheduledStartAt: number } | null {
  const call = parsed(value);
  if (!Array.isArray(call) || typeof call[0] !== "string" || typeof call[1] !== "string" || !Number.isSafeInteger(call[2])) return null;
  return { meetingId: call[0], state: call[1] as MeetingState, scheduledStartAt: call[2] as number };
}

/** The card for a stored suggestion embed, from its check; null when it can't be shown here. */
export function proposalCard(proposalId: string, check: unknown, now = Date.now()): CallProposalCardView | null {
  const facts = parsed(check);
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) return null;
  const row = facts as ProposalCheck;
  const times = proposedTimes(row.times);
  const call = callOf(row.call);
  const card = CallProposalCardView.safeParse({
    type: "callProposal", proposalId, purpose: row.purpose,
    state: proposalCardState(row.state, times, row.countered === 1, now),
    proposedBy: row.proposedBy, times, bookedMinutes: row.bookedMinutes, askToRecord: row.askToRecord === 1,
    work: workOf(row.work), call,
    // A booking's call takes the suggestion's own id (proposals.ts), so a call by any other id is one these times move.
    moves: call !== null && call.meetingId !== proposalId,
  });
  return card.success ? card.data : null;
}

/**
 * Moves a suggestion's card message to its channel's next changeSeq, so every open page's `since` poll
 * carries its new state (as touchMeetingCard does for a call). `proposal` is the suggestion's id as
 * SQL; `when` an extra condition, so a batch moves the card only once its change really happened.
 */
export const touchProposalCard = (proposal: string, when = "1") => `UPDATE channel_message
  SET changeSeq = (SELECT MAX(x.changeSeq) + 1 FROM channel_message x WHERE x.channelId = channel_message.channelId)
  WHERE id = (SELECT messageId FROM call_proposal WHERE id = ${proposal}) AND ${when}`;
