import { describe, expect, it } from "vitest";
import { adminNavEntries, adminSpaceEntries, NO_ADMIN_FACTS } from "./admin-nav";

describe("the admin navigation", () => {
  it("lists the existing admin shell's destinations, in order, with Moderation only while channels are on", () => {
    expect(adminNavEntries(NO_ADMIN_FACTS).map((entry) => entry.href)).toEqual([
      "/dashboard", "/admin", "/admin/access-requests", "/admin/users", "/admin/applications", "/admin/profiles", "/admin/feedback",
      "/admin/projects", "/admin/curricula", "/admin/programs", "/admin/recordings", "/admin/settings/integrations",
      "/admin/platform-flags", "/admin/personal-access-tokens", "/auth/logout",
    ]);
    const on = adminNavEntries({ ...NO_ADMIN_FACTS, pendingAccessRequests: 2, pendingModeration: 0 });
    expect(on.slice(1, 4).map(({ key, badge, badgeLabel }) => ({ key, badge, badgeLabel }))).toEqual([
      { key: "home", badge: undefined, badgeLabel: undefined },
      { key: "accessRequests", badge: 2, badgeLabel: "pending" },
      { key: "moderation", badge: 0, badgeLabel: "waiting" },
    ]);
  });

  it("adds the staging demo, data migration and agent access only where they exist, before Logout", () => {
    const all = adminNavEntries({ ...NO_ADMIN_FACTS, stagingDemoEnabled: true, dataMigrationEnabled: true, agentAuthEnabled: true });
    expect(all.slice(-4).map((entry) => entry.key)).toEqual(["demo", "migration", "agentAccess", "logout"]);
  });

  it("gives the Admin space the same entries in sentence case, without the way back or Logout", () => {
    const entries = adminSpaceEntries({ ...NO_ADMIN_FACTS, dataMigrationEnabled: true, agentAuthEnabled: true });
    expect(entries.map((entry) => entry.key)).not.toContain("back");
    expect(entries.map((entry) => entry.key)).not.toContain("logout");
    expect(entries.map((entry) => entry.label)).toEqual([
      "Admin home", "Access requests", "Users", "Applications", "Profiles", "Feedback", "Client projects", "Curricula", "Cohorts",
      "Recordings", "Integrations", "Feature flags", "Personal access tokens", "Data migration", "Agent access",
    ]);
  });
});
