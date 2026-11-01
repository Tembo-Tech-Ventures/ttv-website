import type { SpaceId } from "@/lib/platform/contracts";

/** Shown once per browser session: a hint, not a banner that comes back on every visit. */
export const LANDING_HINT_KEY = "ttv-last-space-hint";

export interface LandingFacts {
  /** The space this page belongs to. */
  space: SpaceId;
  /** The ttv-last-space preference this request carried. */
  lastSpace: SpaceId | null;
  /** Where the page is. */
  path: string;
  /** The space's home. */
  home: string;
  /** Whether this navigation followed a same-origin redirect (PerformanceNavigationTiming.redirectCount). */
  redirected: boolean;
  /** Whether the hint was already shown in this browser session. */
  seen: boolean;
}

/**
 * `/dashboard` opens the space a person used last, which surprised testers who
 * expected the same page every time (QA1-23). Say so when that is what just
 * happened: a redirect landed on the home of the remembered space. Picking a
 * tab, reloading or following a link to a space never shows it. Only the
 * /dashboard entry redirects to a space home (every legacy redirect lands on a
 * deeper page; space-routes.test.ts holds that), so a redirect here means it.
 */
export function landedOnLastSpace({ space, lastSpace, path, home, redirected, seen }: LandingFacts): boolean {
  return redirected && !seen && lastSpace === space && path.replace(/\/$/, "") === home;
}

/** Reads the browser's side of the facts. Storage can be unavailable (private modes); then the hint just shows. */
export function browserLanding(): Pick<LandingFacts, "path" | "redirected" | "seen"> {
  const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return { path: window.location.pathname, redirected: (navigation?.redirectCount ?? 0) > 0, seen: hintSeen() };
}

function hintSeen(): boolean {
  try {
    return sessionStorage.getItem(LANDING_HINT_KEY) !== null;
  } catch {
    return false;
  }
}

export function rememberLandingHint() {
  try {
    sessionStorage.setItem(LANDING_HINT_KEY, "1");
  } catch {
    // Without storage the hint may show again next time; nothing else depends on it.
  }
}
