import { describe, expect, it } from "vitest";
import { dashboardLinks } from "./DashboardShell";

describe("dashboard navigation", () => {
  it("links authenticated users to project boards", () => {
    expect(dashboardLinks).toContainEqual(
      expect.objectContaining({
        href: "/dashboard/boards",
        label: "Project Boards",
      })
    );
  });
});
