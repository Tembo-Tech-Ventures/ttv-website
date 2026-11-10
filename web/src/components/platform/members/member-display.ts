import type { MemberCard, MemberFilters } from "@/lib/members/directory";
import { MEMBERS_PATH } from "@/lib/platform/server/space-routes";
import { addHref, profileHref } from "@/components/community/home/home-forms";

/**
 * The Members directory's addresses, filters and words, shared by its two pages
 * (`/dashboard/community/members` and `/members/<handle>`). The filters live in
 * the address, so a GET form sets them, every view can be linked to, and all of
 * it works without JavaScript.
 */

export { MEMBERS_PATH };

/** Where the results heading is, so a search or a page of results lands on it. */
export const MEMBER_RESULTS_ID = "member-results";

/** What the request may ask for, bounded before it reaches the read. */
export const MEMBER_FILTER_LIMITS = { q: 100, skills: 5, skill: 40, cursor: 512 } as const;

export type OpenTo = NonNullable<MemberFilters["openTo"]>;

/** The filters a page shows: the read's, minus the cursor, with nothing left undefined. */
export interface MemberDirectoryFilters {
  q: string;
  skills: string[];
  openTo: OpenTo | null;
}

export const OPEN_TO_LABELS: Record<OpenTo, string> = {
  freelance: "Open to freelance",
  roles: "Open to roles",
};

/**
 * Where in the list a page starts. A cursor names the next person, not a position, so the address
 * carries how many came before (`seen`) for "25–48 of 57". It only words the summary: a changed
 * number changes nothing anyone can see but that.
 */
export interface MemberDirectoryPage {
  cursor: string | null;
  seen: number;
}

/** The address's filters and page, as the read takes them. Anything out of shape is dropped, never refused. */
export function parseMemberUrl(params: URLSearchParams): { filters: MemberDirectoryFilters } & MemberDirectoryPage {
  const q = (params.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, MEMBER_FILTER_LIMITS.q);
  const skills: string[] = [];
  for (const raw of params.getAll("skills").flatMap((value) => value.split(","))) {
    const skill = raw.replace(/\s+/g, " ").trim().slice(0, MEMBER_FILTER_LIMITS.skill);
    if (skill && !skills.some((kept) => kept.toLowerCase() === skill.toLowerCase())) skills.push(skill);
  }
  const open = params.get("open");
  const given = params.get("cursor");
  const cursor = given && given.length <= MEMBER_FILTER_LIMITS.cursor ? given : null;
  const seen = Number(params.get("seen"));
  return {
    filters: {
      q,
      skills: skills.slice(0, MEMBER_FILTER_LIMITS.skills),
      openTo: open === "freelance" || open === "roles" ? open : null,
    },
    cursor,
    seen: cursor && Number.isSafeInteger(seen) && seen > 0 ? seen : 0,
  };
}

export function isFiltered(filters: MemberDirectoryFilters): boolean {
  return Boolean(filters.q || filters.skills.length > 0 || filters.openTo);
}

/** The read's own filters: only what is set, so an empty search is no search. */
export function readFilters(filters: MemberDirectoryFilters, cursor: string | null): MemberFilters {
  return {
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.skills.length > 0 ? { skills: filters.skills } : {}),
    ...(filters.openTo ? { openTo: filters.openTo } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

/** The directory with these filters, from its first page or from a page of it. */
export function directoryHref(filters: MemberDirectoryFilters, page: MemberDirectoryPage | null = null): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.skills.length > 0) params.set("skills", filters.skills.join(", "));
  if (filters.openTo) params.set("open", filters.openTo);
  if (page?.cursor) {
    params.set("cursor", page.cursor);
    if (page.seen > 0) params.set("seen", String(page.seen));
  }
  const query = params.toString();
  return query ? `${MEMBERS_PATH}?${query}` : MEMBERS_PATH;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The results heading: how many people, and whether the filters chose them. */
export function resultsHeading(total: number, filtered: boolean): string {
  if (!filtered) return plural(total, "member", "members");
  return total === 1 ? "1 member matches" : `${total} members match`;
}

/**
 * What follows "Members" in the tab's title, so a tab, the history and a screen reader arriving on a
 * search or a later page say which: ": 3 members match", ": 25–48 of 57" or ": 25–30 of 30 matching".
 * Nothing on the first page of everyone.
 */
export function tabTitleDetail(total: number, filtered: boolean, later: { seen: number; shown: number } | null): string {
  const page = later ? pageSummary(later.seen, later.shown, total) : "";
  if (page) return `: ${page}${filtered ? " matching" : ""}`;
  return filtered ? `: ${resultsHeading(total, true)}` : "";
}

/** Where this page sits in the list: "1–24 of 57", or "57 of 57" for a page of one. */
export function pageSummary(seen: number, shown: number, total: number): string {
  if (shown === 0) return "";
  const first = seen + 1;
  const last = seen + shown;
  return first === last ? `${last} of ${Math.max(total, last)}` : `${first}–${last} of ${Math.max(total, last)}`;
}

/** A card's or profile's work, counted in words: "3 pieces of work", or that there is none yet. */
export function workSummary(postedWorkCount: number): string {
  return postedWorkCount === 0 ? "No work posted yet" : plural(postedWorkCount, "piece of work", "pieces of work");
}

/** How much of it mentors have confirmed at its current revision, or null when none is. */
export function confirmedSummary(confirmedWorkCount: number): string | null {
  return confirmedWorkCount > 0 ? `${confirmedWorkCount} confirmed by a mentor` : null;
}

/** What a person is open to, in the words /talent uses. */
export function openToLabels(card: Pick<MemberCard, "openToFreelance" | "openToRoles">): string[] {
  return [card.openToFreelance && OPEN_TO_LABELS.freelance, card.openToRoles && OPEN_TO_LABELS.roles].filter((label): label is string => Boolean(label));
}

/** How many skills a card shows before "+N more"; the profile shows them all. */
export const CARD_SKILLS = 4;

export function cardSkills(skills: readonly string[]): { shown: string[]; more: number } {
  return { shown: skills.slice(0, CARD_SKILLS), more: Math.max(0, skills.length - CARD_SKILLS) };
}

/** Where a person makes or changes their own profile, and posts work. */
export const profileEditorHref = (): string => profileHref();
export const postWorkHref = (): string => addHref();
