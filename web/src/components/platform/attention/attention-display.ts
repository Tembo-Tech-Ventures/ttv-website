import type { AttentionFilter, AttentionItem, AuthorSummary, Me, SpaceId } from "@/lib/platform/contracts";
import { SPACE_LABEL } from "@/components/platform/shell/space-routes";

/** Where the phone's attention page lives. The bell leads here below the wide layout. */
export const ATTENTION_PAGE_HREF = "/dashboard/attention";

export const ATTENTION_FILTERS: readonly { filter: AttentionFilter; label: string; empty: string }[] = [
  { filter: "all", label: "All", empty: "Nothing needs you right now." },
  { filter: "mentions", label: "Mentions", empty: "No mentions, replies or Tembo answers yet." },
  { filter: "requests", label: "Requests", empty: "No mentoring requests yet." },
  { filter: "updates", label: "Updates", empty: "No updates yet." },
];

/**
 * Requests holds requests for a mentor's time and their answers, and, for
 * administrators, requests for access. A person's own access request is not
 * one of them: it lives in Account, and its empty tab says so, rather than
 * reading as if the request were lost (QAO-01). Without onboarding there are
 * no access requests, and the line stays as it was.
 */
function requestsEmpty(viewer: AttentionViewer): string {
  if (!viewer.onboarding) return "No mentoring requests yet.";
  return viewer.admin
    ? "No requests for mentoring time or access yet."
    : "No requests for mentoring time yet. Your own requests for mentor or organisation access are in Account.";
}

/** Who is reading the list, as far as its empty lines depend on it. */
export interface AttentionViewer {
  admin: boolean;
  onboarding: boolean;
}

/**
 * The empty list's line. Attention holds notifications only; shared work
 * waiting for a mentor's confirmation is derived elsewhere (Me.mentoring), so
 * "Nothing needs you" is said only when nothing is known to be waiting there.
 */
export function attentionEmpty(filter: AttentionFilter, awaiting: number | null, viewer: AttentionViewer): string {
  if (filter === "all" && awaiting !== 0) return "No new notifications.";
  if (filter === "requests") return requestsEmpty(viewer);
  return (ATTENTION_FILTERS.find((entry) => entry.filter === filter) ?? ATTENTION_FILTERS[0]!).empty;
}

/** The viewer from Me: an administrator has the Admin space. */
export function attentionViewer(me: Pick<Me, "spaces" | "flags">): AttentionViewer {
  return { admin: me.spaces.includes("admin"), onboarding: me.flags.onboarding };
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
