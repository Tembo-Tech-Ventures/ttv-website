import type { ScoutCriteria } from "./types";

export interface ScoutLocation {
  criteria: ScoutCriteria;
  step: "criteria" | "results";
  profileId: string | null;
  lookup: boolean;
}
const field = (value: unknown, limit: number) => typeof value === "string" ? value.slice(0, limit) : "";

export function readScoutLocation(url: URL, state: unknown): ScoutLocation {
  const saved = state && typeof state === "object" && "ttvScout" in state ? state.ttvScout : null;
  const context = saved && typeof saved === "object" && "context" in saved ? field(saved.context, 4000) : "";
  return {
    criteria: { skills: field(url.searchParams.get("skills"), 300), query: field(url.searchParams.get("query"), 200), context },
    step: url.searchParams.get("scout") === "results" ? "results" : "criteria",
    profileId: field(url.searchParams.get("profile"), 200) || null,
    lookup: url.searchParams.get("lookup") === "1",
  };
}

export function scoutLocationUrl(current: URL, location: ScoutLocation): URL {
  const url = new URL(current);
  for (const [key, value] of Object.entries({ skills: location.criteria.skills, query: location.criteria.query, scout: location.step, profile: location.profileId, lookup: location.lookup ? "1" : null })) {
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  }
  // Opportunity text stays in this tab's history state, not URLs/referrers.
  url.searchParams.delete("context");
  return url;
}

export function pushScoutLocation(location: ScoutLocation) {
  const url = scoutLocationUrl(new URL(window.location.href), location);
  // Store only user-entered context, never loaded profiles, evidence, answers or credentials.
  window.history.pushState({ ttvScout: { context: location.criteria.context } }, "", url);
}
