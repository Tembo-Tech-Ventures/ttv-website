import type { Id, MentorDirectoryItem, MentorDirectoryQuery, MentorRequestFormat } from "../contracts";
import { isMentorArea, isMentorRequestFormat } from "./mentor-constants";

/**
 * The mentor directory's state, held in the URL (S-4.1) so a filtered list
 * can be linked, reloaded and used without JavaScript: every filter is a plain
 * link the server renders.
 *
 *   /dashboard/community/mentors?area=Code+review&format=WRITTEN_REVIEW&available=true&ask=<mentorId>
 *
 * - `area`: one of the mentors' areas, matched ignoring case (as the server does).
 * - `format`: mentors who offer it.
 * - `available=true`: only mentors with a spot open now. Anything else lists everyone.
 * - `ask`: the mentor whose request drawer is open, so it survives a reload and
 *   the round trip through agreeing to how we talk to each other.
 *
 * Values that do not validate are dropped rather than refused: a stale link
 * opens the whole directory instead of an error.
 */
export interface DirectoryFilters {
  area: string | null;
  format: MentorRequestFormat | null;
  available: boolean;
}
export interface DirectoryUrlState extends DirectoryFilters {
  ask: Id | null;
}

export const NO_FILTERS: DirectoryFilters = { area: null, format: null, available: false };

const ASK_ID = /^[^\s/\\]{1,255}$/;

/** Reads the directory's state from a query string. */
export function parseDirectoryUrl(params: URLSearchParams): DirectoryUrlState {
  const area = params.get("area");
  const format = params.get("format");
  const ask = params.get("ask");
  return {
    area: isMentorArea(area) ? area.trim() : null,
    format: isMentorRequestFormat(format) ? format : null,
    available: params.get("available") === "true",
    ask: ask !== null && ASK_ID.test(ask) ? ask : null,
  };
}

/** The server query for these filters: the shape GET /api/mentors and the page's server function take. */
export function directoryQuery(filters: DirectoryFilters): MentorDirectoryQuery {
  return {
    ...(filters.area ? { area: filters.area } : {}),
    ...(filters.format ? { format: filters.format } : {}),
    ...(filters.available ? { available: true } : {}),
  };
}

/** The query string for a state, in a stable order; empty when nothing is set. */
export function directorySearch(state: DirectoryFilters & { ask?: Id | null }): string {
  const params = new URLSearchParams();
  if (state.area) params.set("area", state.area);
  if (state.format) params.set("format", state.format);
  if (state.available) params.set("available", "true");
  if (state.ask) params.set("ask", state.ask);
  const search = params.toString();
  return search ? `?${search}` : "";
}

/** A link to the directory with `change` applied to `filters`. Following a filter closes the drawer. */
export function directoryHref(path: string, filters: DirectoryFilters, change: Partial<DirectoryFilters> = {}): string {
  return path + directorySearch({ ...filters, ...change });
}

/** The same directory with one mentor's request drawer open. */
export function askHref(path: string, filters: DirectoryFilters, mentorId: Id): string {
  return path + directorySearch({ ...filters, ask: mentorId });
}

export const sameArea = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The area filters to offer: every area a listed mentor helps with, once
 * (ignoring case, in the spelling first seen), the most shared first, then
 * alphabetically. An active area no mentor lists any more stays offered, so it
 * can be seen and cleared.
 */
export function areaOptions(items: readonly Pick<MentorDirectoryItem, "areas">[], active: string | null = null): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const item of items) {
    const seen = new Set<string>();
    for (const area of item.areas) {
      const key = area.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { label: area.trim(), count: 1 });
    }
  }
  if (active && !counts.has(active.trim().toLowerCase())) counts.set(active.trim().toLowerCase(), { label: active.trim(), count: 0 });
  return [...counts.values()]
    .toSorted((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map(entry => entry.label);
}

/** Whether a mentor has a spot open this month. */
export function hasOpenSpot(item: Pick<MentorDirectoryItem, "capacity">): boolean {
  return item.capacity.used < item.capacity.limit;
}

/**
 * An area as GET /api/mentors compares it: SQLite's `lower(trim(…))`, which drops spaces at either end
 * and folds ASCII letters only.
 */
const serverAreaKey = (area: string) => area.replace(/^ +| +$/g, "").replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/**
 * The directory as GET /api/mentors filters it (`listMentors`), from the unfiltered list: an area one of
 * the mentor's matches, a format they offer, a spot open now. Filtering keeps the server's order, so
 * the page filters its one unfiltered read rather than reading again (while that read is complete), and
 * the fixtures and the DEV harness filter the same way.
 */
export function filterDirectory<T extends Pick<MentorDirectoryItem, "areas" | "formats" | "capacity">>(
  items: readonly T[], filters: DirectoryFilters,
): T[] {
  const area = filters.area === null ? null : serverAreaKey(filters.area);
  return items.filter(item =>
    (area === null || item.areas.some(offered => serverAreaKey(offered) === area))
    && (!filters.format || item.formats.includes(filters.format))
    && (!filters.available || hasOpenSpot(item)));
}
