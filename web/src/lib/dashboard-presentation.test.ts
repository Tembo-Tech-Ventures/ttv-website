import { describe, expect, it } from "vitest";
import { dashboardNextStep, hasDiscoveryAccess } from "./dashboard-presentation";
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
