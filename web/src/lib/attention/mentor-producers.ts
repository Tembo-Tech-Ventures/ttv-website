import type { MentorRequestFormat, MentorRequestStatus } from "@/lib/platform/contracts";
import { CONVERSATION_PATH, MENTOR_PAGE_PATHS } from "@/lib/platform/server/space-routes";
import { audienceFor, bestEffort, persist, type AttentionProducerContext, type EventItem } from "./producers";

/**
 * Attention for mentor requests (B-4.1; README.md beside this file): each move tells the other party
 * once. A new request tells the mentor, in Mentoring; an answer tells the person asking, in Community,
 * at the conversation it opened or at the directory; a withdrawal tells the mentor. Post-commit and
 * best effort like every producer: it reads the committed request and writes only while it is still in
 * the state the move left it in, so a retry adds nothing. Items need `spaces`, `channels` and
 * `mentor_requests` for their recipient. The note and the mentor's reply are never copied here.
 */

export type MentorRequestEvent = "created" | "accepted" | "redirected" | "declined" | "withdrawn";

/** The status each event leaves a request in. */
const STATUS_AFTER: Record<MentorRequestEvent, MentorRequestStatus> = {
  created: "PENDING", accepted: "ACCEPTED", redirected: "REDIRECTED", declined: "DECLINED", withdrawn: "WITHDRAWN",
};

const ASKED_FOR: Record<MentorRequestFormat, string> = {
  WRITTEN_REVIEW: "Asked you for a written review.",
  CALL_30_MIN: "Asked you for a 30-minute call.",
  QUICK_QUESTION: "Asked you a quick question.",
};

interface RequestState {
  id: string; requesterId: string; mentorId: string; status: MentorRequestStatus; format: MentorRequestFormat;
  channelId: string | null; requesterName: string | null; mentorName: string | null; targetName: string | null;
}

const nameOf = (name: string | null) => name?.trim() || "a member";

function itemFor(event: MentorRequestEvent, request: RequestState): EventItem {
  const subject = (href: string, label: string) => ({ kind: "mentorRequest" as const, id: request.id, href, label });
  const eventKey = JSON.stringify([`mentor_${event}`, request.id]);
  const toMentor = { userId: request.mentorId, actorId: request.requesterId, space: "mentoring" as const, eventKey };
  const toRequester = { userId: request.requesterId, actorId: request.mentorId, space: "community" as const, eventKey };
  const fromRequester = subject(MENTOR_PAGE_PATHS.requests, `Request from ${nameOf(request.requesterName)}`);
  const yourRequest = subject(MENTOR_PAGE_PATHS.directory, `Your request to ${nameOf(request.mentorName)}`);
  switch (event) {
    case "created":
      return { ...toMentor, kind: "mentor_request", subject: fromRequester, summary: ASKED_FOR[request.format] };
    case "withdrawn":
      return { ...toMentor, kind: "mentor_withdrawn", subject: fromRequester, summary: "Withdrew their request." };
    case "accepted":
      return { ...toRequester, kind: "mentor_accepted",
        subject: subject(`${CONVERSATION_PATH}/${encodeURIComponent(request.channelId ?? "")}`, `Conversation with ${nameOf(request.mentorName)}`),
        summary: "Accepted your request. Your conversation is open." };
    case "redirected":
      return { ...toRequester, kind: "mentor_redirected", subject: yourRequest,
        summary: request.targetName?.trim() ? `Suggested you ask ${request.targetName.trim()} instead.` : "Suggested you ask another mentor." };
    case "declined":
      return { ...toRequester, kind: "mentor_declined", subject: yourRequest, summary: "Can't take your request this month." };
  }
}

export function mentorRequestAttention(context: AttentionProducerContext, requestId: string, event: MentorRequestEvent) {
  return bestEffort(async () => {
    const audience = await audienceFor(context, "mentor_requests");
    if (audience === "OFF") return;
    const request = await context.db.prepare(`SELECT r.id, r.requesterId, r.mentorId, r.status, r.format, r.channelId,
        ru.name AS requesterName, mu.name AS mentorName, tu.name AS targetName
      FROM mentor_request r JOIN "user" ru ON ru.id = r.requesterId JOIN "user" mu ON mu.id = r.mentorId
        LEFT JOIN "user" tu ON tu.id = r.redirectedToId
      WHERE r.id = ?1`).bind(requestId).first<RequestState>();
    if (!request || request.status !== STATUS_AFTER[event] || (event === "accepted" && request.channelId === null)) return;
    await persist(context, audience, [itemFor(event, request)]);
  });
}
