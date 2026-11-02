import type {
  Me, MentorAvailability, MentorCapacity, MentorRequest, MentorRequestFormat, MentorRequestStatus,
} from "@/lib/platform/contracts";
import { CONVERSATION_PATH, MENTOR_PAGE_PATHS } from "@/lib/platform/server/space-routes";
import { ago, dayLabel, firstName, plural } from "@/components/channels/channel-format";
import { conversationPath } from "@/components/channels/paths";
import { NEEDS_MEMBER_MESSAGE } from "@/lib/platform/client/mentor-request-form";

/*
 * Pure display rules for mentor connections (U-4.1): formats, monthly
 * capacity, request statuses from each side, and where things live. No React,
 * so each rule is unit tested on its own.
 *
 * Voice: a mentor's choice not to take a request is neutral. Nothing here
 * calls it a rejection, and nothing suggests it counts against anyone.
 */

/** The pages (B-4.1's routes, space-routes.ts). */
export const MENTORS_PATH = MENTOR_PAGE_PATHS.directory;
export const MENTOR_REQUESTS_PATH = MENTOR_PAGE_PATHS.requests;
export const MENTOR_AVAILABILITY_PATH = MENTOR_PAGE_PATHS.availability;
/** Private conversations' pages live under this prefix. */
export const CONVERSATIONS_PREFIX = CONVERSATION_PATH;
/** A private conversation's page, by its channel id. */
export const conversationHref = (channelId: string) => conversationPath({ id: channelId });

/**
 * Whether mentor connections are open to this person: `mentor_requests` is effective only while
 * `channels` is on (B-4.1), since an accepted request opens a conversation. The server already
 * folds that into the effective flags; checking both keeps the UI dark if it ever does not.
 */
export function mentorRequestsOpen(me: Pick<Me, "flags">): boolean {
  return me.flags.mentor_requests === true && me.flags.channels === true;
}

export const FORMAT_LABELS: Record<MentorRequestFormat, string> = {
  WRITTEN_REVIEW: "Written review",
  CALL_30_MIN: "30-minute call",
  QUICK_QUESTION: "Quick question",
};

/** What each format asks of the mentor, under the choice in the request drawer and the availability editor. */
export const FORMAT_HINTS: Record<MentorRequestFormat, string> = {
  WRITTEN_REVIEW: "Comments on your work, written in the conversation.",
  CALL_30_MIN: "A call you arrange together in the conversation.",
  QUICK_QUESTION: "One focused question, answered in the conversation.",
};

/*
 * One fixed zone, as the channel view does, so the server and the browser
 * name the same month and hydration agrees. Capacity resets on Nairobi's
 * calendar month (B-4.1).
 */
const ZONE = "Africa/Nairobi";
const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: ZONE });
const openingFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: ZONE });

/** "November": this month in Nairobi. */
export function monthName(now: number): string {
  return monthFormat.format(now);
}

/** "1 December". */
export function openingDate(timestamp: number): string {
  return openingFormat.format(timestamp);
}

export function openSpots(capacity: MentorCapacity): number {
  return Math.max(0, capacity.limit - capacity.used);
}

export interface CapacityView {
  /** Spots are open: a request can be sent now. */
  open: boolean;
  /** The line beside the clock: "2 of 3 spots open in November", "Next opening 1 December". */
  text: string;
}

/**
 * How full a mentor is this month, as the directory card says it. A full
 * mentor stays listed, with the next opening when the turn of the month frees
 * a spot; when only waiting requests fill it, there is no date to promise.
 */
export function capacityView(capacity: MentorCapacity, now: number): CapacityView {
  const open = openSpots(capacity);
  const month = monthName(now);
  if (open > 0) {
    return {
      open: true,
      text: capacity.used === 0 ? `${plural(open, "spot")} open in ${month}` : `${open} of ${plural(capacity.limit, "spot")} open in ${month}`,
    };
  }
  return {
    open: false,
    text: capacity.nextOpeningAt !== null ? `Next opening ${openingDate(capacity.nextOpeningAt)}` : "No spots open right now",
  };
}

/** The full card's footer label, where an open card has its "Ask for time" button. */
export const FULL_THIS_MONTH = "Full this month";

/**
 * Why an account with neither a community profile nor a cohort place cannot ask (B-4.1, #304): the
 * API's own words. It does not send anyone to make a profile, because a saved one is discoverable.
 */
export const NEEDS_MEMBER = NEEDS_MEMBER_MESSAGE;

/** "Spots used 1 of 3", as a share for the meter. */
export function usedShare(capacity: MentorCapacity): number {
  return capacity.limit === 0 ? 0 : Math.min(1, capacity.used / capacity.limit);
}

export type StatusTone = "peach" | "ring" | "neutral";
export interface StatusView {
  label: string;
  tone: StatusTone;
  /** A sentence under the request, when the label needs one. */
  detail: string | null;
}

/**
 * A check on the note (B-4.1, "Checks"), in the words the README fixes: never naming who opened it, never
 * "declined". Each applies only to the status the server gives it with (waiting and checking while
 * PENDING, not_sent and closed once WITHDRAWN), so a withdrawal shown before the server answers reads as one.
 */
const REQUESTER_CHECKS: Partial<Record<NonNullable<MentorRequest["check"]>, { status: MentorRequestStatus; view: StatusView }>> = {
  waiting: { status: "PENDING", view: { label: "Waiting for a check", tone: "neutral", detail: "Waiting for a check before it's sent." } },
  checking: { status: "PENDING", view: { label: "Being checked", tone: "neutral", detail: "TTV is checking this request." } },
  not_sent: { status: "WITHDRAWN", view: { label: "Not sent", tone: "neutral", detail: "This request wasn't sent." } },
  closed: { status: "WITHDRAWN", view: { label: "Closed", tone: "neutral", detail: "This request was closed." } },
};

/** A request the person asking sent, from their side. */
export function requesterStatus(
  request: Pick<MentorRequest, "mentor" | "redirectedTo"> & Partial<Pick<MentorRequest, "check">>, status: MentorRequestStatus,
): StatusView {
  const checked = request.check ? REQUESTER_CHECKS[request.check] : undefined;
  if (checked?.status === status) return checked.view;
  const mentor = firstName(request.mentor.name);
  switch (status) {
    case "PENDING":
      return { label: `Waiting for ${mentor}`, tone: "ring", detail: null };
    case "ACCEPTED":
      return { label: "Accepted", tone: "peach", detail: `${mentor} accepted. Your conversation is open.` };
    case "REDIRECTED":
      return {
        label: "Another mentor suggested", tone: "neutral",
        detail: request.redirectedTo
          ? `${mentor} suggested ${request.redirectedTo.name}, who may be better placed to help.`
          : `${mentor} suggested another mentor, whose account has since closed.`,
      };
    case "DECLINED":
      return {
        label: "Not this month", tone: "neutral",
        detail: `${mentor} can't take this one this month. Mentors choose how much time they give; you're welcome to ask again or ask someone else.`,
      };
    case "WITHDRAWN":
      return { label: "Withdrawn", tone: "neutral", detail: null };
  }
}

/** A request a mentor received, once it has moved on. */
export function mentorStatus(
  request: Pick<MentorRequest, "requester" | "redirectedTo"> & Partial<Pick<MentorRequest, "check">>, status: MentorRequestStatus,
): StatusView {
  // A report replaces what the status says, whatever it is. Once closed, it never says who closed it: an
  // admin's removal and the person withdrawing while TTV checked look the same from here.
  if (request.check === "reported") {
    return status === "PENDING"
      ? { label: "Reported", tone: "neutral", detail: "You reported this request. TTV is checking it, and it stays closed for you unless they send it back." }
      : { label: "Reported", tone: "neutral", detail: "You reported this request. It's closed." };
  }
  const requester = firstName(request.requester.name);
  switch (status) {
    case "PENDING":
      return { label: "Waiting for you", tone: "peach", detail: null };
    case "ACCEPTED":
      return { label: "Accepted", tone: "peach", detail: null };
    case "REDIRECTED":
      return { label: request.redirectedTo ? `Suggested ${request.redirectedTo.name}` : "Suggested another mentor", tone: "neutral", detail: null };
    case "DECLINED":
      return { label: "Not this month", tone: "neutral", detail: null };
    case "WITHDRAWN":
      return { label: "Withdrawn", tone: "neutral", detail: `${requester} withdrew this request.` };
  }
}

/**
 * What opened a private conversation, from the reader's side: "You accepted Wanjiku's request for
 * a written review", "David accepted your request for a written review". A date follows.
 */
export function conversationContext(request: Pick<MentorRequest, "requester" | "mentor" | "format">, viewerId: string): string {
  const format = FORMAT_LABELS[request.format].toLowerCase();
  const article = /^[aeiou]/.test(format) ? "an" : "a";
  return viewerId === request.mentor.id
    ? `You accepted ${firstName(request.requester.name)}'s request for ${article} ${format}`
    : `${firstName(request.mentor.name)} accepted your request for ${article} ${format}`;
}

/** "today", "yesterday", "on Saturday", "on Monday 13 October": a day inside a sentence. */
export function dayPhrase(timestamp: number, now: number): string {
  const label = dayLabel(timestamp, now);
  return label === "Today" || label === "Yesterday" ? label.toLowerCase() : `on ${label}`;
}

/** "Written review · asked 2 h ago". */
export function requestMeta(request: Pick<MentorRequest, "format" | "createdAt">, now: number): string {
  return `${FORMAT_LABELS[request.format]} · asked ${ago(request.createdAt, now)}`;
}

/** The cohort or role a person is known by on a request card: "Cohort 04", "Alumni · Cohort 02". */
export function personContext(person: Pick<MentorRequest["requester"], "roleBadges">): string | null {
  const badge = person.roleBadges.find(b => b.kind === "COHORT" || b.kind === "ALUMNI") ?? person.roleBadges.find(b => b.kind !== "AI");
  return badge?.label ?? null;
}

/**
 * Why the directory does or does not show a mentor, from their saved
 * availability. Listing is the server's decision (`listed`); this only
 * explains it.
 */
export function listingNote(saved: Pick<MentorAvailability, "listed" | "paused" | "monthlyCapacity" | "headline">): string {
  if (saved.listed) return "Members can find you in the mentor directory and ask for your time.";
  if (saved.headline.trim() === "") return "Not listed yet. Save a headline, your areas and a monthly number to appear in the mentor directory.";
  if (saved.paused) return "Paused. You're not in the mentor directory, and nobody can send you a new request. Requests already waiting stay with you.";
  if (saved.monthlyCapacity === 0) return "Not listed. Set a monthly number above zero to appear in the mentor directory.";
  return "Not listed in the mentor directory right now.";
}

/** "1 request waiting for you". */
/** "3 requests waiting for you"; with `more` (only a first page was read), "20+ requests waiting for you". */
export function waitingText(count: number, more = false): string {
  return more ? `${count}+ requests waiting for you` : `${plural(count, "request")} waiting for you`;
}
