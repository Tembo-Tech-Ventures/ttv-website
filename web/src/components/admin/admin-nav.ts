/*
 * The admin navigation, as data: the same destinations in the existing admin shell (AdminShell)
 * and in the Admin space's sidebar (spaces shell, components/platform/spaces/sidebar.ts). Pure, so
 * each shell only chooses its icons and frame. Nothing here grants anything: the middleware
 * requires ADMIN for /admin/*, and each page checks its own flags.
 */

export const ADMIN_HOME_HREF = "/admin";
export const ACCESS_REQUESTS_HREF = "/admin/access-requests";
export const MODERATION_HREF = "/admin/moderation";

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
    { key: "home", href: ADMIN_HOME_HREF, label: "Admin Home" },
    // People waiting on a decision come straight after home, with how many are waiting.
    { key: "accessRequests", href: ACCESS_REQUESTS_HREF, label: "Access requests", badge: facts.pendingAccessRequests, badgeLabel: "pending" },
    ...(facts.pendingModeration === null
      ? []
      : [{ key: "moderation" as const, href: MODERATION_HREF, label: "Moderation", badge: facts.pendingModeration, badgeLabel: "waiting" }]),
    { key: "users", href: "/admin/users", label: "Users" },
    { key: "applications", href: "/admin/applications", label: "Applications" },
    { key: "profiles", href: "/admin/profiles", label: "Profiles" },
    { key: "feedback", href: "/admin/feedback", label: "Feedback" },
    { key: "projects", href: "/admin/projects", label: "Client Projects" },
    { key: "curricula", href: "/admin/curricula", label: "Curricula" },
    { key: "cohorts", href: "/admin/programs", label: "Cohorts" },
    { key: "recordings", href: "/admin/recordings", label: "Recordings" },
    { key: "integrations", href: "/admin/settings/integrations", label: "Integrations" },
    { key: "flags", href: "/admin/platform-flags", label: "Feature flags" },
    { key: "tokens", href: "/admin/personal-access-tokens", label: "Personal Access Tokens" },
    ...(facts.stagingDemoEnabled ? [{ key: "demo" as const, href: "/demo", label: "Staging demo personas" }] : []),
    ...(facts.dataMigrationEnabled ? [{ key: "migration" as const, href: "/admin/data-migration", label: "Data Migration" }] : []),
    ...(facts.agentAuthEnabled ? [{ key: "agentAccess" as const, href: "/admin/agent-access", label: "Agent Access" }] : []),
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
