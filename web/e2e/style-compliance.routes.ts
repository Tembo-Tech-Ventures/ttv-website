import type { PersonaKey } from "./platform-personas";

/**
 * Every signed-in route `style-compliance.spec.ts` checks, and as whom.
 *
 * A route with an id (`/admin/users/[id]`) is reached through its list: the
 * spec opens `from` and follows the first link whose path matches `link`,
 * so it works against the local seed and an agent preview's fixtures alike,
 * and skips when there is nothing to open.
 *
 * `pending` holds the checks a route does not pass yet, each with a TODO
 * naming the work that fixes it. The spec skips those checks only. Against the
 * local seed it fails a pending check that has started to pass, so the list
 * only ever shrinks: when your PR fixes a page, delete its entry here.
 */

/** What the spec asserts on every route. */
export type StyleCheck =
  /** Exactly one visible h1, in the display face (Mattone). */
  | "h1"
  /** At most one peach (primary) action in view. */
  | "peach"
  /** Every button and button-like link comes from the kit, and no link borrows the peach. */
  | "kit-controls"
  /** axe WCAG 2.2 A and AA at 1440. */
  | "axe"
  /** The same at 320, on a phone. */
  | "axe-320"
  /** Every control at least 44px on a coarse pointer (Pixel 7). */
  | "targets"
  /** No sideways scroll at 320. */
  | "overflow";

/** Checks that run in the desktop project (1440x900). */
export const DESKTOP_CHECKS: readonly StyleCheck[] = ["h1", "peach", "kit-controls", "axe"];
/** Checks that run in the phone project (Pixel 7, then 320 wide). */
export const MOBILE_CHECKS: readonly StyleCheck[] = ["targets", "overflow", "axe-320"];

/** A seeded persona: one of the shared keys, or a person seeded only locally. */
export type StylePersona = PersonaKey | "newcomer";

export interface StyleRoute {
  path: string;
  persona: StylePersona;
  /** For a route with an id: the list to open, and the pattern of the link to follow from it. */
  detail?: { from: string; link: RegExp };
  /** The h1 the route may carry instead of a display one (decision D3: conversation pages). */
  namedH1?: true;
  pending?: { checks: readonly StyleCheck[]; todo: string };
}

/** A detail page under `base`: one more segment, never one of the static pages beside it. */
const ID = (base: string) => new RegExp(`^${base}/(?!(?:new|import|upload|themes)$)[^/?#]+$`);

const LANE_M = (page: string) => `TODO(lane M, ${page}): the page goes onto the kit in its own PR`;
const ALL: readonly StyleCheck[] = [...DESKTOP_CHECKS, ...MOBILE_CHECKS];

export const STYLE_ROUTES: readonly StyleRoute[] = [
  // Cohort
  { path: "/dashboard/cohort", persona: "student" },
  { path: "/dashboard/cohort/sessions", persona: "student" },
  { path: "/dashboard/cohort/sessions/[id]", persona: "student", detail: { from: "/dashboard/cohort/sessions", link: ID("/dashboard/cohort/sessions") } },
  { path: "/dashboard/cohort/ask", persona: "student", namedH1: true, pending: { checks: ALL, todo: LANE_M("Ask Tembo, #403") } },
  { path: "/dashboard/cohort/apply", persona: "community", pending: { checks: ALL, todo: LANE_M("Apply, M11") } },
  { path: "/dashboard/cohort/application/[id]", persona: "student", detail: { from: "/dashboard/cohort/apply", link: ID("/dashboard/cohort/application") }, pending: { checks: ALL, todo: LANE_M("Application, #405") } },
  { path: "/dashboard/cohort/c/[slug]", persona: "student", namedH1: true, detail: { from: "/dashboard/cohort", link: ID("/dashboard/cohort/c") } },

  // Community
  { path: "/dashboard/community", persona: "community" },
  { path: "/dashboard/community/mentors", persona: "community" },
  { path: "/dashboard/community/conduct", persona: "community" },
  { path: "/dashboard/community/c/[slug]", persona: "community", namedH1: true, detail: { from: "/dashboard/community", link: ID("/dashboard/community/c") } },

  // Mentoring (the mentor is seeded locally only)
  { path: "/dashboard/mentoring", persona: "mentor" },
  { path: "/dashboard/mentoring/requests", persona: "mentor" },
  { path: "/dashboard/mentoring/availability", persona: "mentor" },
  { path: "/dashboard/mentoring/confirm", persona: "mentor", pending: { checks: ALL, todo: LANE_M("Confirm work, M17") } },

  // Discover
  { path: "/dashboard/discover", persona: "institution", pending: { checks: ALL, todo: LANE_M("Discover, #400") } },

  // Profile
  { path: "/dashboard/me", persona: "alumna" },
  { path: "/dashboard/me/portfolio", persona: "alumna", pending: { checks: ALL, todo: LANE_M("Public profile editor, M13") } },
  { path: "/dashboard/me/writing", persona: "alumna", pending: { checks: ALL, todo: LANE_M("Writing, #394") } },
  { path: "/dashboard/me/writing/new", persona: "alumna", pending: { checks: ALL, todo: LANE_M("Post editor, M14") } },
  { path: "/dashboard/me/opportunities", persona: "alumna", pending: { checks: ALL, todo: LANE_M("Opportunities, #393") } },
  { path: "/dashboard/me/leads", persona: "alumna", pending: { checks: ALL, todo: LANE_M("Visitor messages, #392") } },
  { path: "/dashboard/account", persona: "alumna", pending: { checks: ALL, todo: LANE_M("Account, M12") } },

  // Outside the spaces
  { path: "/dashboard/attention", persona: "student" },
  { path: "/dashboard/feedback", persona: "student" },
  { path: "/dashboard/welcome", persona: "newcomer" },

  // Admin
  { path: "/admin", persona: "staff" },
  { path: "/admin/access-requests", persona: "staff" },
  { path: "/admin/agent-access", persona: "staff" },
  { path: "/admin/applications", persona: "staff" },
  { path: "/admin/applications/[id]", persona: "staff", detail: { from: "/admin/applications", link: ID("/admin/applications") } },
  { path: "/admin/curricula", persona: "staff" },
  { path: "/admin/curricula/[id]", persona: "staff", detail: { from: "/admin/curricula", link: ID("/admin/curricula") } },
  { path: "/admin/curricula/new", persona: "staff" },
  { path: "/admin/data-migration", persona: "staff", pending: { checks: ALL, todo: LANE_M("Admin data migration, #398") } },
  { path: "/admin/feedback", persona: "staff" },
  { path: "/admin/feedback/[id]", persona: "staff", detail: { from: "/admin/feedback", link: ID("/admin/feedback") } },
  { path: "/admin/feedback/themes", persona: "staff" },
  { path: "/admin/feedback/themes/[id]", persona: "staff", detail: { from: "/admin/feedback/themes", link: ID("/admin/feedback/themes") } },
  { path: "/admin/moderation", persona: "staff" },
  { path: "/admin/personal-access-tokens", persona: "staff" },
  { path: "/admin/platform-flags", persona: "staff" },
  { path: "/admin/profiles", persona: "staff" },
  { path: "/admin/profiles/[id]", persona: "staff", detail: { from: "/admin/profiles", link: ID("/admin/profiles") } },
  { path: "/admin/programs", persona: "staff" },
  { path: "/admin/programs/[id]", persona: "staff", detail: { from: "/admin/programs", link: ID("/admin/programs") } },
  { path: "/admin/programs/new", persona: "staff", pending: { checks: ALL, todo: LANE_M("Admin new cohort, #399") } },
  { path: "/admin/projects", persona: "staff" },
  { path: "/admin/projects/[id]", persona: "staff", detail: { from: "/admin/projects", link: ID("/admin/projects") } },
  { path: "/admin/recordings", persona: "staff" },
  { path: "/admin/recordings/[id]", persona: "staff", detail: { from: "/admin/recordings", link: ID("/admin/recordings") }, pending: { checks: ALL, todo: LANE_M("Admin recording, #395") } },
  { path: "/admin/recordings/import", persona: "staff", pending: { checks: ALL, todo: LANE_M("Admin recording imports, #397") } },
  { path: "/admin/recordings/upload", persona: "staff", pending: { checks: ALL, todo: LANE_M("Admin upload recording, #404") } },
  { path: "/admin/settings/integrations", persona: "staff" },
  { path: "/admin/users", persona: "staff" },
  { path: "/admin/users/[id]", persona: "staff", detail: { from: "/admin/users", link: ID("/admin/users") } },
];
