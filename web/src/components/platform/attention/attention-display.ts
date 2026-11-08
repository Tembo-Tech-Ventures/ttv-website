import type { AttentionFilter, AttentionItem, AuthorSummary, Me, SpaceId } from "@/lib/platform/contracts";
import { SPACE_LABEL } from "@/components/platform/shell/space-routes";
import { CONVERSATION_PATH } from "@/lib/platform/server/space-routes";

/** Where the phone's attention page lives. The bell leads here below the wide layout. */
export const ATTENTION_PAGE_HREF = "/dashboard/attention";

export const ATTENTION_FILTERS: readonly { filter: AttentionFilter; label: string; empty: string }[] = [
  { filter: "all", label: "All", empty: "You're all caught up." },
  { filter: "mentions", label: "Mentions", empty: "No mentions, replies or Tembo answers yet." },
  { filter: "requests", label: "Requests", empty: "Answers to requests you send to mentors show here." },
  { filter: "updates", label: "Updates", empty: "No updates yet." },
];

/**
 * Requests holds notices about requests: answers to the ones a person sent a
 * mentor (and what a check did to them), requests sent to a mentor, and, for
 * administrators, requests for access. The empty tab says what it holds for
 * this reader, rather than "no requests", which read as if a request someone
 * had just sent were lost (QA4-06). The request itself is under Your requests
 * on the Mentors page. A person's own access request lives in Account, and the
 * tab says so too (QAO-01). Without onboarding there are no access requests.
 */
function requestsEmpty(viewer: AttentionViewer): string {
  const holds = ["answers to requests you send to mentors"];
  if (viewer.mentor) holds.push("requests sent to you as a mentor");
  if (viewer.admin && viewer.onboarding) holds.push("requests for access");
  const list = holds.length === 1 ? holds[0]! : `${holds.slice(0, -1).join(", ")} and ${holds.at(-1)!}`;
  const line = `${list.charAt(0).toUpperCase()}${list.slice(1)} show here.`;
  return viewer.onboarding && !viewer.admin ? `${line} Your own requests for mentor or organisation access are in Account.` : line;
}

/** Who is reading the list, as far as its empty lines depend on it. */
export interface AttentionViewer {
  admin: boolean;
  onboarding: boolean;
  /** Holds the MENTOR role, so requests for their time arrive here too. */
  mentor: boolean;
}

/**
 * The empty list's title. Attention holds notifications only; shared work
 * waiting for a mentor's confirmation is derived elsewhere (Me.mentoring), so
 * "all caught up" is said only when nothing is known to be waiting there.
 */
export function attentionEmpty(filter: AttentionFilter, awaiting: number | null, viewer: AttentionViewer): string {
  if (filter === "all" && awaiting !== 0) return "No new notifications.";
  if (filter === "requests") return requestsEmpty(viewer);
  return (ATTENTION_FILTERS.find((entry) => entry.filter === filter) ?? ATTENTION_FILTERS[0]!).empty;
}

/** What an empty "all" list adds below its title: where new things will appear. Other lists say it all in the title. */
export function attentionEmptyDetail(filter: AttentionFilter, awaiting: number | null): string | null {
  return filter === "all" && awaiting === 0 ? "Mentions, answers to your requests and updates show here as they arrive." : null;
}

/** The viewer from Me: an administrator has the Admin space. */
export function attentionViewer(me: Pick<Me, "spaces" | "flags" | "capabilities">): AttentionViewer {
  return { admin: me.spaces.includes("admin"), onboarding: me.flags.onboarding, mentor: me.capabilities.isMentor };
}

/** The attention page's summary line, which says "all caught up" only when nothing is known to wait. */
export function attentionSummary(total: number, awaiting: number | null): string {
  if (total > 0) return `${total} new`;
  return awaiting === 0 ? "You're all caught up." : "Nothing new.";
}

/**
 * The person to show beside an item, if any. Application decisions are
 * actor-neutral by policy: the deciding admin is never shown to the applicant,
 * even if a future payload carried one. Tembo has its own mark, and an author
 * without an id (a deleted account) is not a person we can show.
 */
export function attentionActor(item: AttentionItem): (AuthorSummary & { id: string }) | null {
  if (item.kind === "application_status" || item.kind === "tembo_answer") return null;
  const actor = item.actor;
  return actor?.id ? { ...actor, id: actor.id } : null;
}

/**
 * The step an item leads to, shown on its row as a button would be: an accepted request opens its
 * conversation (prototype 03). The row stays one link, so the step is its words, not a second control.
 */
export function attentionAction(item: AttentionItem): string | null {
  return item.kind === "mentor_accepted" && item.subject.href.startsWith(`${CONVERSATION_PATH}/`) ? "Open conversation" : null;
}

/** Items for spaces this person cannot open are never shown, even if a response carried one. */
export function visibleAttention(items: readonly AttentionItem[], spaces: readonly SpaceId[]): AttentionItem[] {
  return items.filter((item) => spaces.includes(item.space));
}

/** Unread items lead ("New"); the rest follow ("Earlier"). Order within each is the store's, newest first. */
export function groupAttention(items: readonly AttentionItem[]) {
  return {
    fresh: items.filter((item) => item.readAt === null),
    earlier: items.filter((item) => item.readAt !== null),
  };
}

/** Unread attention across the spaces this person has, the number on the bell. */
export function unreadTotal(counts: Readonly<Record<SpaceId, number>>, spaces: readonly SpaceId[]): number {
  return spaces.reduce((sum, space) => sum + (counts[space] ?? 0), 0);
}

/**
 * Splits a summary so its lead (the actor's name, or the subject it is about)
 * can be set in bold, as the prototype does. Returns null when the summary does
 * not start with it: the text is the server's, and is never rewritten.
 */
export function summaryLead(item: AttentionItem, actorName: string | null): { lead: string; rest: string } | null {
  for (const lead of [actorName, item.subject.label]) {
    if (lead && item.summary.startsWith(lead) && item.summary.length > lead.length) {
      return { lead, rest: item.summary.slice(lead.length) };
    }
  }
  return null;
}

/**
 * Where an item happened: the space, then the place in it ("Community ·
 * #help"). When the place already names the space ("Cohort 04 · #cohort-04")
 * the space is not said twice.
 */
export function attentionPlace(item: AttentionItem): string {
  const space = SPACE_LABEL[item.space];
  const label = item.subject.label;
  return label.toLowerCase().startsWith(space.toLowerCase()) ? label : `${space} · ${label}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/*
 * One fixed zone, so the server and the browser render the same day names and
 * hydration agrees. Most TTV members are in Kenya.
 */
const ZONE = "Africa/Nairobi";
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: ZONE });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: ZONE });
const dayMonthYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: ZONE });
const full = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: ZONE });

/**
 * "now", "10 min", "3 h" within a day; the weekday within a week; then the
 * date. `relative` says whether "ago" belongs after it when read aloud.
 */
export function attentionTime(createdAt: number, now: number): { text: string; relative: boolean; title: string } {
  const title = full.format(createdAt);
  const age = Math.max(0, now - createdAt);
  if (age < MINUTE) return { text: "now", relative: false, title };
  if (age < HOUR) return { text: `${Math.floor(age / MINUTE)} min`, relative: true, title };
  if (age < DAY) return { text: `${Math.floor(age / HOUR)} h`, relative: true, title };
  if (age < 7 * DAY) return { text: weekday.format(createdAt), relative: false, title };
  const sameYear = dayMonthYear.format(createdAt).slice(-4) === dayMonthYear.format(now).slice(-4);
  return { text: (sameYear ? dayMonth : dayMonthYear).format(createdAt), relative: false, title };
}
