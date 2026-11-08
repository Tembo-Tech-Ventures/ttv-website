import type {
  Me, MentorAvailability, MentorCapacity, MentorDirectoryItem, MentorRequest, MentorRequestFormat, MentorRequestStatus,
} from "@/lib/platform/contracts";
import { CONDUCT_PATH, CONVERSATION_PATH, MENTOR_PAGE_PATHS } from "@/lib/platform/server/space-routes";
import { ago, dayLabel, firstName, plural } from "@/components/channels/channel-format";
import { sameArea, type DirectoryFilters } from "@/lib/platform/client/mentor-directory";
import { conversationPath } from "@/components/channels/paths";

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

/** What each format asks of the mentor, under the choice in the request drawer and the availability form. */
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
 * One wording whatever is used (QA4-13): "3 of 3 spots open", never "3 spots open" beside "1 of 5 spots open".
 */
export function capacityView(capacity: MentorCapacity, now: number): CapacityView {
  const open = openSpots(capacity);
  const month = monthName(now);
  if (open > 0) {
    return { open: true, text: `${open} of ${plural(capacity.limit, "spot")} open in ${month}` };
  }
  return {
    open: false,
    text: capacity.nextOpeningAt !== null ? `Next opening ${openingDate(capacity.nextOpeningAt)}` : "No spots open right now",
  };
}

/** The full card's footer label, where an open card has its "Ask for time" button. */
export const FULL_THIS_MONTH = "Full this month";

/**
 * Why a full mentor's request didn't go: as B-4.1's 409 says it, with the next opening when the turn
 * of the month frees a spot (the no-JavaScript post checks this before asking the API).
 */
export function fullMessage(mentor: Pick<MentorDirectoryItem, "person" | "capacity">): string {
  const { nextOpeningAt } = mentor.capacity;
  return `${mentor.person.name} has no spots left this month.${nextOpeningAt !== null ? ` The next opening is ${openingDate(nextOpeningAt)}.` : ""}`;
}

/**
 * Said to someone who belongs to an organisation (the INSTITUTION role), so they know what they can do
 * rather than guess (QA4-09): asking is personal, and an affiliation neither grants nor blocks it.
 */
export const AS_YOURSELF = "You can ask a mentor for time as yourself. Requests come from you, not from your organisation.";

/** Where a filter link lands, so the next Tab goes into the results rather than back through the filters (QA4-18). */
export const MENTOR_RESULTS_ID = "mentor-results";

/**
 * The directory's results heading: how many mentors are shown, and which filters chose them, so the
 * selected filters are said in words after every filter link (QA4-18). "2 mentors · Career · Has open spots".
 */
export function resultsHeading(
  count: number,
  filters: DirectoryFilters,
  areas: readonly string[] = [],
): string {
  const wanted = filters.area;
  const area = wanted ? areas.find((option) => sameArea(option, wanted)) ?? wanted : null;
  const chosen = [area, filters.format ? FORMAT_LABELS[filters.format] : null, filters.available ? "Has open spots" : null];
  return [plural(count, "mentor"), ...chosen.filter((label): label is string => label !== null)].join(" · ");
}

/** "Spots used 1 of 3", as a share for the meter. */
export function usedShare(capacity: MentorCapacity): number {
  return capacity.limit === 0 ? 0 : Math.min(1, capacity.used / capacity.limit);
}

/** Peach for what needs someone, the ring for a mentor's part, success for an accepted request, neutral for the rest. */
export type StatusTone = "peach" | "ring" | "success" | "neutral";
export interface StatusView {
  label: string;
  tone: StatusTone;
  /** A sentence under the request, when the label needs one. */
  detail: string | null;
  /** What it means for the person and what they can do next, after the detail (a check's fixed explanation). */
  next?: string;
  /** Where to read more, after `next`. */
  link?: { href: string; label: string };
}

/** A check is routine, and says so: what it is, that it isn't about the person, and what happens next (QA4-02). */
const WHILE_CHECKED = "It isn't a judgement on you, and there's nothing you need to do. You'll get a notice when it's done.";
const ASK_AGAIN = "That came from a check by TTV. You can ask again with a new note, or ask another mentor.";
const HABITS_LINK = { href: CONDUCT_PATH, label: "Read how we talk to each other" };

/**
 * A check on the note (B-4.1, "Checks"), in the words the README fixes: never naming who opened it, never
 * "declined". Each applies only to the status the server gives it with (waiting and checking while
 * PENDING, not_sent and closed once WITHDRAWN), so a withdrawal shown before the server answers reads as one.
 * Each says plainly what a check is and what comes next, the same whoever opened it.
 */
const REQUESTER_CHECKS: Partial<Record<NonNullable<MentorRequest["check"]>, { status: MentorRequestStatus; view: StatusView }>> = {
  waiting: {
    status: "PENDING",
    view: {
      label: "Waiting for a check", tone: "neutral", detail: "Waiting for a check before it's sent.",
      next: `Some requests get a check from TTV before they reach a mentor. ${WHILE_CHECKED}`,
    },
  },
  checking: {
    status: "PENDING",
    view: { label: "Being checked", tone: "neutral", detail: "TTV is checking this request.", next: WHILE_CHECKED },
  },
  not_sent: {
    status: "WITHDRAWN",
    view: { label: "Not sent", tone: "neutral", detail: "This request wasn't sent.", next: ASK_AGAIN, link: HABITS_LINK },
  },
  closed: {
    status: "WITHDRAWN",
    view: { label: "Closed", tone: "neutral", detail: "This request was closed.", next: ASK_AGAIN, link: HABITS_LINK },
  },
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
      return { label: "Accepted", tone: "success", detail: `${mentor} accepted. Your conversation is open.` };
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

type ShownRequest = Pick<MentorRequest, "mentor" | "redirectedTo"> & Partial<Pick<MentorRequest, "check">> & { status: MentorRequestStatus };

/** How "Your requests" counts each standing, in words that read after a number. */
function summaryWord(request: ShownRequest): string {
  if (request.check && REQUESTER_CHECKS[request.check]?.status === request.status) return requesterStatus(request, request.status).label.toLowerCase();
  return { PENDING: "waiting", ACCEPTED: "accepted", REDIRECTED: "with a suggestion", DECLINED: "not this month", WITHDRAWN: "withdrawn" }[request.status];
}

/**
 * "2 waiting · 1 accepted": where the person's requests stand, in one line, for "Your requests" folded
 * above the directory (T06). Each standing once, in the order the newest request with it comes; a check
 * is said as the check ("being checked"), never as the mentor's answer.
 */
export function requestsSummary(requests: readonly ShownRequest[]): string {
  const counts = new Map<string, number>();
  for (const request of requests) {
    const said = summaryWord(request);
    counts.set(said, (counts.get(said) ?? 0) + 1);
  }
  return [...counts].map(([said, count]) => `${count} ${said}`).join(" · ");
}

/**
 * Whether a request has news the person should read where they land (S3): an answer that isn't an
 * acceptance (a suggestion, not this month) or a check. Its notice leads to the directory, so "Your
 * requests" opens there; waiting and accepted requests show on the mentors' cards anyway.
 */
export function requestHasNews(request: ShownRequest): boolean {
  return Boolean(request.check) || request.status === "REDIRECTED" || request.status === "DECLINED";
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
      return { label: "Accepted", tone: "success", detail: null };
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
