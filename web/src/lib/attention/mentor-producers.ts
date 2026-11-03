import type { MentorRequestFormat, MentorRequestStatus } from "@/lib/platform/contracts";
import { MENTOR_SEES } from "@/lib/mentoring/visibility";
import { CONVERSATION_PATH, MENTOR_PAGE_PATHS } from "@/lib/platform/server/space-routes";
import { MODERATION_QUEUE_HREF } from "./channel-producers";
import { audienceFor, bestEffort, persist, type AttentionProducerContext, type EventItem } from "./producers";

/**
 * Attention for mentor requests (B-4.1; README.md beside this file): each move tells the other party
 * once. A new request tells the mentor, in Mentoring; an answer tells the person asking, in Community,
 * at the conversation it opened or at the directory; a withdrawal tells the mentor. Post-commit and
 * best effort like every producer: it reads the committed request and writes only while it is still in
 * the state the move left it in, so a retry adds nothing. Items need `spaces`, `channels` and
 * `mentor_requests` for their recipient. The note and the mentor's reply are never copied here.
 *
 * Checks (src/lib/mentoring/README.md, "Checks"): the mentor hears of a request only while they may
 * see it (MENTOR_SEES), so a request Clef held reaches them only once an admin keeps it ("created"
 * again, the same notice). A check opening ("checking") tells every admin but the two parties, once
 * per opening, in the admin space, at the request notes queue, while the request still waits or was reported.
 * The person asking hears of each change a check makes to their request (QA4-02, `mentor_checked`): it
 * waits for a check, TTV is checking it, it went to the mentor, or it was not sent or closed. The
 * notices say what happens next, are the same whoever opened the check, and never say "declined".
 */

export type MentorRequestEvent = "created" | "accepted" | "redirected" | "declined" | "withdrawn" | "checking" | "decided";

/** The admin moderation page's request notes tab (U-4.1). */
export const MENTOR_REQUEST_QUEUE_HREF = `${MODERATION_QUEUE_HREF}?tab=request-notes`;

/** The status each event leaves a request in. */
const STATUS_AFTER: Record<Exclude<MentorRequestEvent, "checking" | "decided">, MentorRequestStatus> = {
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
  visible: number; caseState: "OPEN" | "DECIDED" | null; openedAt: number | null; reported: number;
  decision: "KEEP" | "REMOVE" | null; decidedAt: number | null; closedRequest: number | null;
}

/**
 * Where a check leaves the request, as the person asking sees it (requests.ts checkFor): waiting (Clef
 * held it, the mentor never saw it), checking (the mentor had read it), sent (an admin kept it, so it
 * waits for the mentor again), not_sent or closed (an admin removed it). null when nothing changed for
 * them: no check, or a decision on a request they had already withdrawn.
 */
type CheckNotice = "waiting" | "checking" | "sent" | "not_sent" | "closed";
function checkNotice(request: RequestState): CheckNotice | null {
  if (request.caseState === "OPEN") return request.status === "PENDING" ? request.reported ? "checking" : "waiting" : null;
  if (request.caseState !== "DECIDED") return null;
  if (request.decision === "KEEP") return request.status === "PENDING" ? "sent" : null;
  return request.closedRequest ? request.reported ? "closed" : "not_sent" : null;
}

/** What each notice tells the person asking: a fixed, kind explanation and what happens next (QA4-02). */
const CHECK_SUMMARY: Record<CheckNotice, (mentor: string) => string> = {
  waiting: () => "Waiting for a check before it's sent. Nothing for you to do: you'll hear here when it's done.",
  checking: () => "TTV is checking your request. Nothing for you to do: you'll hear here when it's done.",
  sent: (mentor) => `Checked and sent. It's waiting for ${mentor} now.`,
  not_sent: () => "It wasn't sent, after a check. You can ask again with a new note.",
  closed: () => "It was closed, after a check. You can ask again with a new note.",
};

function checkItem(request: RequestState): EventItem | null {
  const notice = checkNotice(request);
  if (notice === null) return null;
  const at = notice === "waiting" || notice === "checking" ? request.openedAt : request.decidedAt;
  return {
    userId: request.requesterId, actorId: null, space: "community", kind: "mentor_checked",
    subject: { kind: "mentorRequest", id: request.id, href: MENTOR_PAGE_PATHS.directory, label: `Your request to ${nameOf(request.mentorName)}` },
    // access.ts reads the notice at $[2] of this key, to show "waiting" and "checking" only while the check is open: keep its place.
    summary: CHECK_SUMMARY[notice](nameOf(request.mentorName)), eventKey: JSON.stringify(["mentor_checked", request.id, notice, at]),
  };
}

const nameOf = (name: string | null) => name?.trim() || "a member";

function itemFor(event: Exclude<MentorRequestEvent, "checking" | "decided">, request: RequestState): EventItem {
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

/** The open check on a request, for every admin but its two parties. */
async function checkItems(context: AttentionProducerContext, request: RequestState): Promise<EventItem[]> {
  // A withdrawn Clef hold is moot; a reported request stays the admins' to decide.
  if (request.caseState !== "OPEN" || request.openedAt === null || (request.status !== "PENDING" && !request.reported)) return [];
  const { results: admins } = await context.db.prepare(`SELECT DISTINCT ur.userId FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId
    WHERE r.name = 'ADMIN' AND ur.userId NOT IN (?1, ?2)`).bind(request.requesterId, request.mentorId).all<{ userId: string }>();
  const subject = { kind: "mentorRequest" as const, id: request.id, href: MENTOR_REQUEST_QUEUE_HREF, label: "Request notes" };
  const summary = request.reported ? "A mentor reported the note on a request." : "A request's note is waiting for a check.";
  return admins.map(({ userId }) => ({ userId, actorId: null, kind: "moderation_pending" as const, space: "admin" as const, subject, summary,
    eventKey: JSON.stringify(["mentor_request_check", request.id, request.openedAt]) }));
}

export function mentorRequestAttention(context: AttentionProducerContext, requestId: string, event: MentorRequestEvent) {
  return bestEffort(async () => {
    const audience = await audienceFor(context, "mentor_requests");
    if (audience === "OFF") return;
    const request = await context.db.prepare(`SELECT r.id, r.requesterId, r.mentorId, r.status, r.format, r.channelId,
        ru.name AS requesterName, mu.name AS mentorName, tu.name AS targetName, ${MENTOR_SEES("r")} AS visible,
        c.state AS caseState, c.openedAt, EXISTS (SELECT 1 FROM mentor_request_report rp WHERE rp.requestId = r.id) AS reported,
        c.decision, c.decidedAt, c.closedRequest
      FROM mentor_request r JOIN "user" ru ON ru.id = r.requesterId JOIN "user" mu ON mu.id = r.mentorId
        LEFT JOIN "user" tu ON tu.id = r.redirectedToId LEFT JOIN mentor_request_case c ON c.requestId = r.id
      WHERE r.id = ?1`).bind(requestId).first<RequestState>();
    if (!request) return;
    if (event === "checking" || event === "decided") {
      const asker = checkItem(request);
      await persist(context, audience, [...event === "checking" ? await checkItems(context, request) : [], ...asker ? [asker] : []]);
      return;
    }
    if (request.status !== STATUS_AFTER[event] || (event === "accepted" && request.channelId === null)) return;
    if ((event === "created" || event === "withdrawn") && !request.visible) return;
    // A mentor who reported the request has read it: no "new request" notice for it.
    if (event === "created" && request.reported) return;
    await persist(context, audience, [itemFor(event, request)]);
  });
}
