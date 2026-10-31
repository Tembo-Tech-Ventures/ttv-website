import type { SpaceId } from "@/lib/platform/contracts";
import { SPACE_PATHS } from "@/lib/platform/server/space-routes";

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
