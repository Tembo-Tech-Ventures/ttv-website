import { proposedTimes } from "@/lib/meetings/proposal-card";
import { SESSION_ZONE_LABEL, sessionClock, sessionDay } from "@/lib/meetings/session-times";
import { bookedCallPath, proposalPath } from "@/lib/platform/server/space-routes";
import { audienceFor, bestEffort, persist, type AttentionProducerContext } from "./producers";

/**
 * Attention for calls between two people (in-app calls P10; README.md beside this file, "Calls"): to
 * the other member of the conversation when one suggests times (Requests) or answers with other times,
 * and when a time is picked or a booked call is cancelled (Updates). Each shows only while it still
 * applies (access.ts). Saying "Not now" and withdrawing write nothing: the suggestion's notice simply
 * leaves the bell, and nothing outside the conversation learns of the answer. Best effort and
 * post-commit like every producer; they need `meeting_checkins` (with everything it needs) for their
 * recipient. Every item is in Profile, beside the Calls page it opens.
 */

const LABEL = { CALL: "Call", CHECKIN: "Project check-in" } as const;
type Purpose = keyof typeof LABEL;

/** A name to start a sentence with, as the attention row sets it in bold. */
const leadOf = (name: string | null) => {
  const named = name?.trim() || "The other person";
  return named.charAt(0).toUpperCase() + named.slice(1);
};
/** "Thu 27 Nov at 17:00 EAT". */
const when = (ms: number, now: number) => `${sessionDay(ms, now)} at ${sessionClock(ms)} ${SESSION_ZONE_LABEL}`;

/**
 * A new suggestion, to the other person: "Wanjiku Mwangi suggested times for a call." Other times for
 * theirs (`countered`), or new times for a booked call, say so. Only while it is open.
 */
export function callProposedAttention(context: AttentionProducerContext, proposalId: string, countered: boolean, now = Date.now()) {
  return bestEffort(async () => {
    const audience = await audienceFor(context, "meeting_checkins");
    if (audience === "OFF") return;
    const { results } = await context.db.prepare(`SELECT p.purpose, p.proposedBy, p.meetingId, o.userId AS recipient, u.name AS proposerName
      FROM call_proposal p JOIN channel c ON c.id = p.channelId AND c.kind = 'DIRECT'
        JOIN channel_member o ON o.channelId = c.id AND o.userId <> p.proposedBy
        JOIN channel_member s ON s.channelId = c.id AND s.userId = p.proposedBy
        LEFT JOIN "user" u ON u.id = p.proposedBy
      WHERE p.id = ?1 AND p.state = 'OPEN'`).bind(proposalId)
      .all<{ purpose: Purpose; proposedBy: string; meetingId: string | null; recipient: string; proposerName: string | null }>();
    await persist(context, audience, results.map((row) => {
      const kind = countered ? "call_countered" : "call_proposed";
      const who = leadOf(row.proposerName);
      const summary = countered ? `${who} suggested other times.`
        : row.meetingId ? `${who} suggested new times for your call.`
          : `${who} suggested times for ${row.purpose === "CHECKIN" ? "a project check-in" : "a call"}.`;
      return {
        userId: row.recipient, actorId: row.proposedBy, kind, space: "profile" as const, eventKey: JSON.stringify([kind, proposalId]),
        subject: { kind: "callProposal" as const, id: proposalId, href: proposalPath(proposalId), label: LABEL[row.purpose] }, summary,
      };
    }), now);
  });
}

/**
 * A picked time, to the person who suggested it: "David Kamau picked Thu 27 Nov at 17:00 EAT." Its key
 * carries the time, so a call moved again is told again, and only the notice of the time the call
 * still has stays in the bell.
 */
export function callBookedAttention(context: AttentionProducerContext, proposalId: string, meetingId: string, now = Date.now()) {
  return bestEffort(async () => {
    const audience = await audienceFor(context, "meeting_checkins");
    if (audience === "OFF") return;
    const row = await context.db.prepare(`SELECT p.proposedBy, p.times, m.purpose, m.scheduledStartAt, o.userId AS picker, u.name AS pickerName
      FROM call_proposal p JOIN meeting m ON m.id = p.meetingId AND m.id = ?2 AND m.state = 'SCHEDULED'
        JOIN channel c ON c.id = p.channelId AND c.kind = 'DIRECT' AND m.channelId = c.id
        JOIN channel_member o ON o.channelId = c.id AND o.userId <> p.proposedBy
        JOIN channel_member s ON s.channelId = c.id AND s.userId = p.proposedBy
        LEFT JOIN "user" u ON u.id = o.userId
      WHERE p.id = ?1 AND p.state = 'ACCEPTED'`).bind(proposalId, meetingId)
      .first<{ proposedBy: string; times: string; purpose: Purpose; scheduledStartAt: number; picker: string; pickerName: string | null }>();
    if (!row || !proposedTimes(row.times).includes(row.scheduledStartAt)) return;
    await persist(context, audience, [{
      userId: row.proposedBy, actorId: row.picker, kind: "call_booked", space: "profile",
      eventKey: JSON.stringify(["call_booked", meetingId, row.scheduledStartAt]),
      subject: { kind: "meeting", id: meetingId, href: bookedCallPath(meetingId), label: LABEL[row.purpose] },
      summary: `${leadOf(row.pickerName)} picked ${when(row.scheduledStartAt, now)}. It's in your calls.`,
    }], now);
  });
}

/** A cancelled call, to the other person: "Wanjiku Mwangi cancelled your call on Thu 27 Nov at 17:00 EAT." */
export function callCancelledAttention(context: AttentionProducerContext, meetingId: string, byUserId: string, now = Date.now()) {
  return bestEffort(async () => {
    const audience = await audienceFor(context, "meeting_checkins");
    if (audience === "OFF") return;
    const { results } = await context.db.prepare(`SELECT m.purpose, m.scheduledStartAt, o.userId AS recipient, u.name AS cancellerName
      FROM meeting m JOIN channel c ON c.id = m.channelId AND c.kind = 'DIRECT'
        JOIN channel_member o ON o.channelId = c.id AND o.userId <> ?2
        JOIN channel_member s ON s.channelId = c.id AND s.userId = ?2
        LEFT JOIN "user" u ON u.id = ?2
      WHERE m.id = ?1 AND m.state = 'CANCELLED' AND m.purpose IN ('CALL', 'CHECKIN')`).bind(meetingId, byUserId)
      .all<{ purpose: Purpose; scheduledStartAt: number; recipient: string; cancellerName: string | null }>();
    await persist(context, audience, results.map((row) => ({
      userId: row.recipient, actorId: byUserId, kind: "call_cancelled" as const, space: "profile" as const,
      eventKey: JSON.stringify(["call_cancelled", meetingId]),
      subject: { kind: "meeting" as const, id: meetingId, href: bookedCallPath(meetingId), label: LABEL[row.purpose] },
      summary: `${leadOf(row.cancellerName)} cancelled your ${row.purpose === "CHECKIN" ? "check-in" : "call"} on ${when(row.scheduledStartAt, now)}.`,
    })), now);
  });
}
