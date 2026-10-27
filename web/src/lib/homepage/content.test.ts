import { describe, expect, it } from "vitest";
import { COHORT, COMMUNITY, HIRE, PRINCIPLES, SECTION_ORDER } from "./content";

describe("homepage content", () => {
  it("keeps the five principles from the original homepage", () => {
    expect(PRINCIPLES.values.map((value) => value.word)).toEqual([
      "COMMUNITY",
      "PHILOSOPHY",
      "EQUITY",
      "CONTINUITY",
      "HONESTY",
    ]);
  });

  it("offers the three community roles in order", () => {
    expect(COMMUNITY.paths.map((path) => path.id)).toEqual(["builder", "mentor", "partner"]);
    for (const path of COMMUNITY.paths) expect(path.href).toMatch(/^\/community\//);
  });

  it("sends signed-out visitors through sign-in and keeps the destination", () => {
    expect(COMMUNITY.join(false)).toBe("/auth/login?next=%2Fdashboard%2Fcommunity");
    expect(COMMUNITY.join(true)).toBe("/dashboard/community");
  });

  it("states approval wherever access is gated", () => {
    const gated = COMMUNITY.paths.filter((path) => path.id !== "builder");
    for (const path of gated) expect(path.detail).toMatch(/approved/);
  });

  it("puts cohorts first and principles last", () => {
    expect(SECTION_ORDER[0]).toBe("cohort");
    expect(SECTION_ORDER.at(-1)).toBe("principles");
    expect(COHORT.apply.href).toBe("/dashboard/apply");
    expect(HIRE.primary.href).toBe("/hire");
  });
});
