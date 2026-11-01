import type { Me, SearchScope } from "@/lib/platform/contracts";
import type { ApiError } from "@/lib/platform/client/apiClient";
import type { SearchItem } from "@/lib/platform/client/search";

export interface ScopeOption {
  scope: SearchScope;
  label: string;
  /** A cohort scope shows the cohort's dot, a community one its dot and ring. */
  glyph?: "cohort" | "community";
}

/**
 * Where a person can search. "Your cohort" only for someone who belongs to
 * one (it searches their own cohort's sessions); messages are not offered
 * until channel search exists, so no scope promises results it cannot have.
 */
export function scopesFor(me: Me): ScopeOption[] {
  // "All" of the scopes below, not everywhere: search covers only what they name.
  const options: ScopeOption[] = [{ scope: "all", label: "All" }];
  if (searchesSessions(me)) {
    options.push({ scope: "cohort", label: "Your cohort", glyph: "cohort" });
  }
  if (me.spaces.includes("community")) options.push({ scope: "community", label: "Community", glyph: "community" });
  options.push({ scope: "people", label: "People" }, { scope: "projects", label: "Projects" });
  return options;
}

/** Whether search reaches this person's session moments: only their own cohorts' sessions, so only in one. */
export function searchesSessions(me: Me): boolean {
  return me.spaces.includes("cohort") && me.capabilities.cohortIds.length > 0;
}

/**
 * What this person's search covers, said plainly (QA1-11). People are public
 * profiles; projects are the ones shared with institutions, which only
 * institutions and staff see beyond their own; session moments come only from
 * the person's own cohorts, so staff outside a cohort get none.
 */
export function searchCoverage(me: Me): { label: string; hint: string } {
  const sessions = searchesSessions(me);
  const projects = me.capabilities.isInstitution || me.capabilities.isAdmin ? "projects shared with institutions" : "your shared projects";
  return {
    label: sessions ? "Search people, projects and your sessions" : "Search people and projects",
    hint: sessions
      ? `Finds people with public profiles, ${projects}, and moments from your own cohort's sessions.`
      : `Finds people with public profiles and ${projects}.`,
  };
}

/** The groups in the order the keyboard walks them (the store's item order). */
export const GROUP_LABEL: Record<SearchItem["group"], string> = {
  messages: "Messages",
  people: "People",
  projects: "Projects",
  sessionMoments: "Moments in your sessions",
};

/** "34:12", or "1:02:05" past the hour. */
export function timestamp(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = String(whole % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** The query's words, as search matches them: lower case, two letters or more. */
function queryWords(query: string): string[] {
  return Array.from(new Set(query.toLowerCase().split(/\s+/).filter((word) => word.length > 1)));
}

export type Highlighted = { text: string; match: boolean }[];

/**
 * Marks where the words of the query appear. Matching is plain and
 * case-insensitive, like the search itself; it only decorates the server's
 * text and never changes it.
 */
export function highlight(text: string, query: string): Highlighted {
  const words = queryWords(query);
  if (words.length === 0) return [{ text, match: false }];
  const pattern = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, match: words.includes(part.toLowerCase()) }));
}

/** Whether the query shows up in `text`: the whole query, as the server matches, or one of its words. */
export function mentions(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const whole = query.trim().toLowerCase();
  return (whole.length > 0 && lower.includes(whole)) || queryWords(query).some((word) => lower.includes(word));
}

/** About `length` characters of `text` from near `at`, cut between words, with an ellipsis where it was cut. */
function windowAt(text: string, at: number, length: number): string {
  if (text.length <= length) return text;
  // Start a little before `at`, but never so late that the window runs short at the end.
  let start = Math.max(0, Math.min(at - Math.floor(length / 4), text.length - length));
  // Begin on a whole word: move forward to the next one, as long as that stays before the match.
  if (start > 0 && text[start - 1] !== " ") {
    const next = text.indexOf(" ", start);
    if (next >= 0 && next < at) start = next + 1;
  }
  let end = Math.min(text.length, start + length);
  // End on a whole word too, unless that would cut the match.
  if (end < text.length && text[end] !== " ") {
    const space = text.lastIndexOf(" ", end);
    if (space > at) end = space;
  }
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * The part of `text` around its first match, so the reason for a result is on
 * screen rather than somewhere in five hundred characters. Null when the query
 * is not in the text at all.
 */
export function matchingPart(text: string, query: string, length = 160): string | null {
  const lower = text.toLowerCase();
  const whole = query.trim().toLowerCase();
  const found = (whole && lower.includes(whole) ? [lower.indexOf(whole)] : queryWords(query).map((word) => lower.indexOf(word)))
    .filter((index) => index >= 0);
  return found.length > 0 ? windowAt(text, Math.min(...found), length) : null;
}

/** The opening of `text`, about `length` characters, for a result whose match is in its title. */
export function opening(text: string, length = 160): string {
  return windowAt(text, 0, length);
}

export type SearchProblem = { message: string; retry: boolean; signIn: boolean };

/** What a failed search means to the person, and what they can do next. */
export function searchProblem(error: ApiError | null): SearchProblem | null {
  if (!error) return null;
  if (error.code === "validation_error" || error.code === "validation") {
    return { message: "Searches can be up to 500 characters.", retry: false, signIn: false };
  }
  if (error.status === 401) return { message: "You've been signed out. Sign in again to search.", retry: false, signIn: true };
  if (error.status === 404 || error.code === "flag_off") {
    return { message: "Search isn't available right now. If you were signed out, signing in again brings it back.", retry: true, signIn: true };
  }
  if (error.status === 403) return { message: "That search isn't open to you.", retry: false, signIn: false };
  if (error.status === 429) return { message: "That's a lot of searching. Try again in a moment.", retry: true, signIn: false };
  return { message: "Search didn't work this time.", retry: true, signIn: false };
}
