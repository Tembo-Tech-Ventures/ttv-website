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
  const options: ScopeOption[] = [{ scope: "all", label: "Everywhere" }];
  if (me.spaces.includes("cohort") && me.capabilities.cohortIds.length > 0) {
    options.push({ scope: "cohort", label: "Your cohort", glyph: "cohort" });
  }
  if (me.spaces.includes("community")) options.push({ scope: "community", label: "Community", glyph: "community" });
  options.push({ scope: "people", label: "People" }, { scope: "projects", label: "Projects" });
  return options;
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

export type Highlighted = { text: string; match: boolean }[];

/**
 * Marks where the words of the query appear. Matching is plain and
 * case-insensitive, like the search itself; it only decorates the server's
 * text and never changes it.
 */
export function highlight(text: string, query: string): Highlighted {
  const words = Array.from(new Set(query.toLowerCase().split(/\s+/).filter((word) => word.length > 1)));
  if (words.length === 0) return [{ text, match: false }];
  const pattern = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, match: words.includes(part.toLowerCase()) }));
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
