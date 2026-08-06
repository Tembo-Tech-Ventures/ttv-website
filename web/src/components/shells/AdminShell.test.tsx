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

  it("places curricula before programs in the management flow", () => {
    const labels = getAdminLinks(false).map(({ label }) => label);
    expect(labels.indexOf("Curricula")).toBeLessThan(
      labels.indexOf("Programs")
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
});
