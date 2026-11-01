import type { SpaceId } from "../contracts";

/** Canonical entry points shared with the spaces shell. No authority is inferred here. */
export const SPACE_PATHS = {
  cohort: "/dashboard/cohort",
  community: "/dashboard/community",
  mentoring: "/dashboard/mentoring",
  discover: "/dashboard/discover",
  admin: "/admin",
  profile: "/dashboard/me",
} as const satisfies Record<SpaceId, string>;

/**
 * The onboarding welcome step (B-O.4): a page under /dashboard that belongs to no space, so it has no
 * tabs, never saves the last-space cookie and stays outside isNewSpacePath. Routing is in onboarding-routing.ts.
 */
export const WELCOME_PATH = "/dashboard/welcome";

/**
 * Channel pages (B-2.2): `/dashboard/<space>/c/<slug>` for cohort and community channels, and the
 * code of conduct. They exist only while `channels` is on for the caller, and a channel page exists
 * only for a channel the caller can read (space-routing.ts).
 */
export const CHANNEL_SPACES = ["cohort", "community"] as const satisfies readonly SpaceId[];
export type ChannelSpace = (typeof CHANNEL_SPACES)[number];
export const CONDUCT_PATH = "/dashboard/community/conduct";

/** The slug rule the database enforces (channel_slug_check in migration 0028). */
export const CHANNEL_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/** The channel a canonical channel path names. The slug is never decoded: it must be valid as written. */
export function channelRoute(pathname: string): { space: ChannelSpace; slug: string } | null {
  const match = /^\/dashboard\/(cohort|community)\/c\/([^/]+)$/.exec(normalizeSpacePath(pathname));
  return match && CHANNEL_SLUG.test(match[2]) ? { space: match[1] as ChannelSpace, slug: match[2] } : null;
}

/** Pages that exist only while the `channels` flag is on for the caller. */
export function isChannelPagePath(pathname: string): boolean {
  return normalizeSpacePath(pathname) === CONDUCT_PATH || channelRoute(pathname) !== null;
}

export const SPACE_REDIRECTS = [
  ["/dashboard/apply", "/dashboard/cohort/apply"],
  ["/dashboard/application/:id", "/dashboard/cohort/application/:id"],
  ["/dashboard/sessions", "/dashboard/cohort/sessions"],
  ["/dashboard/sessions/:id", "/dashboard/cohort/sessions/:id"],
  ["/dashboard/ask", "/dashboard/cohort/ask"],
  ["/dashboard/mentorship", "/dashboard/mentoring/confirm"],
  ["/dashboard/portfolio", "/dashboard/me/portfolio"],
  ["/dashboard/writing", "/dashboard/me/writing"],
  ["/dashboard/writing/:id", "/dashboard/me/writing/:id"],
  ["/dashboard/opportunities", "/dashboard/me/opportunities"],
  ["/dashboard/leads", "/dashboard/me/leads"],
  ["/dashboard/profile", "/dashboard/account"],
] as const;

export function normalizeSpacePath(pathname: string): string {
  return pathname.replace(/\/$/, "");
}

function mappedPath(path: string, from: string, to: string): string | null {
  if (!from.endsWith("/:id")) return path === from ? to : null;
  const prefix = from.slice(0, -3);
  if (!path.startsWith(prefix)) return null;
  const id = path.slice(prefix.length);
  // Preserve the encoded opaque segment. Never decode it into route syntax.
  if (!id || /[/\\]/.test(id) || /%(?:2f|5c)/i.test(id)) return null;
  return to.slice(0, -3) + id;
}

export function canonicalSpacePath(pathname: string): string | null {
  const path = normalizeSpacePath(pathname);
  for (const [legacy, canonical] of SPACE_REDIRECTS) {
    const match = mappedPath(path, legacy, canonical);
    if (match) return match;
  }
  return null;
}

/** Temporary render targets until U-1.2 migrates the pages; also bounds allowlist aliases. */
export function legacySpacePath(pathname: string): string {
  const path = normalizeSpacePath(pathname);
  if (path === SPACE_PATHS.cohort) return "/dashboard";
  if (path === SPACE_PATHS.mentoring) return "/dashboard/mentorship";
  if (path === SPACE_PATHS.profile) return "/dashboard/portfolio";
  for (const [legacy, canonical] of SPACE_REDIRECTS) {
    const match = mappedPath(path, canonical, legacy);
    if (match) return match;
  }
  return path;
}

export function spaceForPath(pathname: string): SpaceId | null {
  const path = normalizeSpacePath(pathname);
  if (path === "/dashboard/account") return "profile";
  for (const [space, prefix] of Object.entries(SPACE_PATHS)) {
    if (path === prefix || path.startsWith(prefix + "/")) return space as SpaceId;
  }
  return null;
}

export function isNewSpacePath(pathname: string): boolean {
  const path = normalizeSpacePath(pathname);
  return ["/dashboard/cohort", "/dashboard/mentoring", "/dashboard/me", "/dashboard/account"]
    .some(prefix => path === prefix || path.startsWith(prefix + "/"))
    || path.startsWith("/dashboard/community/");
}

export function isAvailableSpacePath(pathname: string): boolean {
  const path = normalizeSpacePath(pathname);
  return Object.values(SPACE_PATHS).some(entry => entry === path)
    || legacySpacePath(path) !== path
    || isChannelPagePath(path);
}
