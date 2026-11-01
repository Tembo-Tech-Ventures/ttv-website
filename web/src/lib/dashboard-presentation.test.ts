import { describe, expect, it } from "vitest";
import { dashboardNextStep, hasDiscoveryAccess, restrictedQaNextStep } from "./dashboard-presentation";
import { getDashboardLinks } from "../components/shells/DashboardShell";
import { getAppNav } from "../components/chat/ChatApp";
const memberStep = { title: "Find your next cohort", description: "Apply", detail: null, action: { href: "/dashboard/apply", label: "Apply" } };
describe("institution dashboard presentation", () => {
  it.each([[false, false, false], [false, true, true], [true, false, true], [true, true, true]])("admin %s institution %s gives discovery %s", (isAdmin, isInstitution, expected) => {
    const allowed = hasDiscoveryAccess({ isAdmin, isInstitution });
    expect(allowed).toBe(expected);
    const links = getDashboardLinks(["home", "apply", "sessions", "account"], 0, false, allowed);
    expect(links.some(link => link.href === "/dashboard/discover")).toBe(expected);
    expect(links.map(link => link.id)).toEqual(expect.arrayContaining(["community", "apply", "sessions", "account"]));
    expect(getAppNav(["home", "ask"], 0, allowed).some(link => link.id === "discover")).toBe(expected);
    expect(dashboardNextStep(memberStep, allowed).action.href).toBe(expected ? "/dashboard/discover" : "/dashboard/apply");
  });
  it("preserves the original member next step", () => expect(dashboardNextStep(memberStep, false)).toBe(memberStep));
});

it("filters only a restricted QA session's unavailable links", () => {
  const ids = ["home", "apply", "ask", "sessions", "account"] as const;
  const ordinary = getDashboardLinks([...ids], 0, false, true);
  const restricted = getDashboardLinks([...ids], 0, false, true, ["/dashboard", "/dashboard/community", "/dashboard/discover"]);
  expect(ordinary.map(link => link.id)).toEqual(expect.arrayContaining(["apply", "ask", "sessions", "account", "logout"]));
  expect(restricted.map(link => link.id)).toEqual(["home", "discover", "community"]);
});

it("replaces a disallowed QA next-step CTA without changing ordinary journeys", () => {
  expect(restrictedQaNextStep(memberStep, true)).toBe(memberStep);
  expect(restrictedQaNextStep(memberStep, false).action.href).toBe("/dashboard/community");
  expect(restrictedQaNextStep(memberStep, false).description).toContain("not available in this session");
  // A staging fixture has no QA sign-out control to point at.
  expect(restrictedQaNextStep(memberStep, false, false)).toMatchObject({ detail: null, action: { href: "/dashboard/community" } });
  expect(restrictedQaNextStep(memberStep, false, false).description).not.toContain("QA");
});
