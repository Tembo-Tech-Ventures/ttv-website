import { describe, expect, it } from "vitest";
import { dashboardNextStep, hasDiscoveryAccess, restrictedQaNextStep } from "./dashboard-presentation";
const memberStep = { title: "Find your next cohort", description: "Apply", detail: null, action: { href: "/dashboard/apply", label: "Apply" } };
describe("institution dashboard presentation", () => {
  it.each([[false, false, false], [false, true, true], [true, false, true], [true, true, true]])("admin %s institution %s gives discovery %s", (isAdmin, isInstitution, expected) => {
    const allowed = hasDiscoveryAccess({ isAdmin, isInstitution });
    expect(allowed).toBe(expected);
    expect(dashboardNextStep(memberStep, allowed).action.href).toBe(expected ? "/dashboard/discover" : "/dashboard/apply");
  });
  it("preserves the original member next step", () => expect(dashboardNextStep(memberStep, false)).toBe(memberStep));
});

it("replaces a disallowed QA next-step CTA without changing ordinary journeys", () => {
  expect(restrictedQaNextStep(memberStep, true)).toBe(memberStep);
  expect(restrictedQaNextStep(memberStep, false).action.href).toBe("/dashboard/community");
  expect(restrictedQaNextStep(memberStep, false).description).toContain("not available in this session");
});
