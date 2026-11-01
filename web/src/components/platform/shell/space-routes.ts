import type { SpaceId } from "@/lib/platform/contracts";
import { normalizeSpacePath, SPACE_PATHS, spaceForPath } from "@/lib/platform/server/space-routes";

/**
 * Where each space starts, and the account destinations in the avatar menu.
 *
 * Space homes are B-1.2's canonical SPACE_PATHS, the routes the server
 * redirects and guards. That module is a pure path map, safe in islands.
 */
export const SPACE_HOME: Readonly<Record<SpaceId, string>> = SPACE_PATHS;

export const SPACE_LABEL: Readonly<Record<SpaceId, string>> = {
  cohort: "Cohort",
  community: "Community",
  mentoring: "Mentoring",
  discover: "Discover",
  admin: "Admin",
  profile: "Profile",
};

export const ACCOUNT_HREF = "/dashboard/account";
export const SIGN_OUT_HREF = "/auth/logout";

/** Space pages outside any space's path prefix: the entry (it redirects into a space), attention and feedback. */
const SHELL_PATHS: ReadonlySet<string> = new Set(["/dashboard", "/dashboard/attention", "/dashboard/feedback"]);

/**
 * Whether a path opens in the spaces shell, for someone already in it. Admin
 * is one of their spaces but keeps its own frame. Used only to decide whether
 * the card-file transition can finish on the next page; it grants nothing.
 */
export function opensInShell(pathname: string): boolean {
  const path = normalizeSpacePath(pathname);
  const space = spaceForPath(path);
  return (space !== null && space !== "admin") || SHELL_PATHS.has(path);
}
