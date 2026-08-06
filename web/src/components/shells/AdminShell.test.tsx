import { describe, expect, it } from "vitest";
import { getAdminLinks } from "./AdminShell";

describe("admin navigation", () => {
  it("links to curriculum management for every admin", () => {
    for (const agentAuthEnabled of [false, true]) {
      expect(getAdminLinks(agentAuthEnabled)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            href: "/admin/curricula",
            label: "Curricula",
          }),
        ])
      );
    }
  });

  it("places curricula before cohorts in the management flow", () => {
    const labels = getAdminLinks(false).map(({ label }) => label);
    expect(labels.indexOf("Curricula")).toBeLessThan(
      labels.indexOf("Cohorts")
    );
  });

  it("shows agent access only when the runtime capability is enabled", () => {
    expect(getAdminLinks(false).map(({ label }) => label)).not.toContain(
      "Agent Access"
    );
    expect(getAdminLinks(true).map(({ label }) => label)).toContain(
      "Agent Access"
    );
  });

  it("shows data migration only when its independent capability is enabled", () => {
    expect(getAdminLinks(false).map(({ label }) => label)).not.toContain(
      "Data Migration"
    );
    expect(getAdminLinks(false, true).map(({ label }) => label)).toContain(
      "Data Migration"
    );
    expect(getAdminLinks(false, false).map(({ label }) => label)).not.toContain(
      "Data Migration"
    );
    const agentOnlyLabels = getAdminLinks(true, false).map(({ label }) => label);
    expect(agentOnlyLabels).not.toContain("Data Migration");
    expect(agentOnlyLabels).toContain("Agent Access");
  });
});
