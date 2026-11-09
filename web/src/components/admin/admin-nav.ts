/*
 * The admin navigation, as data: the Admin space's sidebar (components/platform/spaces/sidebar.ts),
 * in the spaces shell and in PlainFrame alike. Pure, so the sidebar only chooses its icons. Nothing here grants anything: the middleware
 * requires ADMIN for /admin/*, and each page checks its own flags.
 */

export const ADMIN_HOME_HREF = "/admin";
export const ACCESS_REQUESTS_HREF = "/admin/access-requests";
export const MODERATION_HREF = "/admin/moderation";

/** Where each admin page lives. Its sub-pages (a user, a new cohort, feedback themes) sit under it. */
export const ADMIN_PAGE_HREFS = {
  home: ADMIN_HOME_HREF,
  accessRequests: ACCESS_REQUESTS_HREF,
  moderation: MODERATION_HREF,
  users: "/admin/users",
  applications: "/admin/applications",
  profiles: "/admin/profiles",
  feedback: "/admin/feedback",
  projects: "/admin/projects",
  curricula: "/admin/curricula",
  cohorts: "/admin/programs",
  recordings: "/admin/recordings",
  integrations: "/admin/settings/integrations",
  flags: "/admin/platform-flags",
  tokens: "/admin/personal-access-tokens",
  migration: "/admin/data-migration",
  agentAccess: "/admin/agent-access",
} as const satisfies Partial<Record<AdminNavKey, string>>;

/** The admin navigation's entries that are admin pages, which the spaces shell can draw (T02, T14). */
export type AdminPageNavKey = keyof typeof ADMIN_PAGE_HREFS;

/** The admin section a path sits under: the longest admin page path that is it or a parent of it. */
export function adminSectionFor(path: string): AdminPageNavKey | null {
  const keys = Object.keys(ADMIN_PAGE_HREFS) as AdminPageNavKey[];
  const under = keys.filter((key) => path === ADMIN_PAGE_HREFS[key] || path.startsWith(`${ADMIN_PAGE_HREFS[key]}/`));
  return under.toSorted((a, b) => ADMIN_PAGE_HREFS[b].length - ADMIN_PAGE_HREFS[a].length)[0] ?? null;
}

export type AdminNavKey =
  | "back" | "home" | "accessRequests" | "moderation" | "users" | "applications" | "profiles" | "feedback" | "projects"
  | "curricula" | "cohorts" | "recordings" | "integrations" | "flags" | "tokens" | "demo" | "migration" | "agentAccess" | "logout";

export interface AdminNavEntry {
  key: AdminNavKey;
  href: string;
  label: string;
  /** A count beside the entry, and what it counts ("pending", "waiting"). */
  badge?: number;
  badgeLabel?: string;
}

export interface AdminNavFacts {
  agentAuthEnabled: boolean;
  dataMigrationEnabled: boolean;
  stagingDemoEnabled: boolean;
  /** Open mentor and institution requests. */
  pendingAccessRequests: number;
  /**
   * Moderation cases waiting for a decision plus the open request-note checks this admin may decide
   * (QA4-04), or null while `channels` is off for them: there is no queue to link to.
   */
  pendingModeration: number | null;
}

export const NO_ADMIN_FACTS: AdminNavFacts = {
  agentAuthEnabled: false, dataMigrationEnabled: false, stagingDemoEnabled: false, pendingAccessRequests: 0, pendingModeration: null,
};

/**
 * Every admin destination, in order. `back` and `logout` belong to the existing admin shell, which
 * has no space tabs or account menu; the spaces shell leaves them out (adminSpaceEntries).
 */
export function adminNavEntries(facts: AdminNavFacts): AdminNavEntry[] {
  return [
    // Admin is one of the person's spaces: the way back to the rest of the app comes first.
    { key: "back", href: "/dashboard", label: "Back to dashboard" },
    { key: "home", href: ADMIN_PAGE_HREFS.home, label: "Admin Home" },
    // People waiting on a decision come straight after home, with how many are waiting.
    { key: "accessRequests", href: ADMIN_PAGE_HREFS.accessRequests, label: "Access requests", badge: facts.pendingAccessRequests, badgeLabel: "pending" },
    ...(facts.pendingModeration === null
      ? []
      : [{ key: "moderation" as const, href: ADMIN_PAGE_HREFS.moderation, label: "Moderation", badge: facts.pendingModeration, badgeLabel: "waiting" }]),
    { key: "users", href: ADMIN_PAGE_HREFS.users, label: "Users" },
    { key: "applications", href: ADMIN_PAGE_HREFS.applications, label: "Applications" },
    { key: "profiles", href: ADMIN_PAGE_HREFS.profiles, label: "Profiles" },
    { key: "feedback", href: ADMIN_PAGE_HREFS.feedback, label: "Feedback" },
    { key: "projects", href: ADMIN_PAGE_HREFS.projects, label: "Client Projects" },
    { key: "curricula", href: ADMIN_PAGE_HREFS.curricula, label: "Curricula" },
    { key: "cohorts", href: ADMIN_PAGE_HREFS.cohorts, label: "Cohorts" },
    { key: "recordings", href: ADMIN_PAGE_HREFS.recordings, label: "Recordings" },
    { key: "integrations", href: ADMIN_PAGE_HREFS.integrations, label: "Integrations" },
    { key: "flags", href: ADMIN_PAGE_HREFS.flags, label: "Feature flags" },
    { key: "tokens", href: ADMIN_PAGE_HREFS.tokens, label: "Personal Access Tokens" },
    ...(facts.stagingDemoEnabled ? [{ key: "demo" as const, href: "/demo", label: "Staging demo personas" }] : []),
    ...(facts.dataMigrationEnabled ? [{ key: "migration" as const, href: ADMIN_PAGE_HREFS.migration, label: "Data Migration" }] : []),
    ...(facts.agentAuthEnabled ? [{ key: "agentAccess" as const, href: ADMIN_PAGE_HREFS.agentAccess, label: "Agent Access" }] : []),
    { key: "logout", href: "/auth/logout", label: "Logout" },
  ];
}

/** Sentence case for the spaces sidebar, which names every entry that way. */
const SPACE_LABELS: Partial<Record<AdminNavKey, string>> = {
  home: "Admin home",
  projects: "Client projects",
  tokens: "Personal access tokens",
  migration: "Data migration",
  agentAccess: "Agent access",
};

/** The Admin space's entries: the space tabs and the account menu already lead back and sign out. */
export function adminSpaceEntries(facts: AdminNavFacts): AdminNavEntry[] {
  return adminNavEntries(facts)
    .filter((entry) => entry.key !== "back" && entry.key !== "logout")
    .map((entry) => ({ ...entry, label: SPACE_LABELS[entry.key] ?? entry.label }));
}
