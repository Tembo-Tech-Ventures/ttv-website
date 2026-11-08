import type { DiscoveryMatch } from "@/lib/community/discovery-contract";
import { DISCOVER_PATH, type Carried } from "./discover-state";

/** "3 entries", "1 confirmed entry". */
export function entryCountLabel(count: number, confirmed = false) {
  return `${count} ${confirmed ? "confirmed " : ""}${count === 1 ? "entry" : "entries"}`;
}

/** How a criterion matched published evidence, in words. */
export const MATCH_LABEL: Record<DiscoveryMatch["status"], string> = {
  supported: "Supported by published evidence",
  partial: "Related evidence",
  unknown: "No published evidence found",
  contradicted: "Evidence says not met",
};

/** A person's profile, by address: a lookup keeps its name so "Back to people" can return to it. */
export function profileHref(id: string, carried?: Pick<Carried, "lookup" | "query">): string {
  const params = new URLSearchParams({ profile: id });
  if (carried?.lookup) {
    params.set("lookup", "1");
    params.set("query", carried.query);
  }
  return `${DISCOVER_PATH}?${params}`;
}

/** The name lookup's form, with a name already in it. */
export function lookupFormHref(query = ""): string {
  return query ? `${DISCOVER_PATH}?lookup=1&query=${encodeURIComponent(query)}` : `${DISCOVER_PATH}?lookup=1`;
}

/** The name lookup's results for `query`. */
export function lookupResultsHref(query: string): string {
  return `${DISCOVER_PATH}?lookup=1&scout=results&query=${encodeURIComponent(query)}`;
}
