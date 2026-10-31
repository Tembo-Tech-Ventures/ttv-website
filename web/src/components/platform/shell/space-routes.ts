import type { SpaceId } from "@/lib/platform/contracts";

/**
 * Where each space starts, and the account destinations in the avatar menu.
 *
 * The paths are the canonical ones from PLAN.md §4 ("Proposed routes"). Route
 * moves and redirects belong to B-1.2; this map is the one place the shell
 * reads them from, so switching it to B-1.2's helper is a one-line change.
 */
export const SPACE_HOME: Readonly<Record<SpaceId, string>> = {
  cohort: "/dashboard/cohort",
  community: "/dashboard/community",
  mentoring: "/dashboard/mentoring",
  discover: "/dashboard/discover",
  admin: "/admin",
  profile: "/dashboard/me",
};

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
