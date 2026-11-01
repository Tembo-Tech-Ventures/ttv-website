import { afterEach, describe, expect, it, vi } from "vitest";
import { meByPersona } from "@/lib/platform/fixtures";
import { createCapabilityDatabase } from "@/lib/platform/server/capabilities.test-support";
import { DEMO_PERSONAS } from "@/lib/staging-demo-policy";

const mocks = vi.hoisted(() => ({ getSpaceContext: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/platform/server/space-context", () => ({ getSpaceContext: mocks.getSpaceContext }));
import { DASHBOARD_LINKS } from "@/components/shells/DashboardShell";
import { linkAllowed, loadCertificates, nextStepHref, pickSpace, resolveSpacePage, restrictedDashboardHrefs, restrictionsFor } from "./space-page";

const locals = { user: { id: "synthetic" } } as unknown as App.Locals;
const off = { ...meByPersona.amina, flags: { ...meByPersona.amina.flags, spaces: false } };

afterEach(() => {
  mocks.getSpaceContext.mockReset();
});

describe("pickSpace", () => {
  it("opens applying and Ask Tembo in Community until the person has a cohort", () => {
    expect(pickSpace(meByPersona.lucy, "apply")).toBe("community");
    expect(pickSpace(meByPersona.lucy, "ask")).toBe("community");
    expect(pickSpace(meByPersona.wanjiku, "apply")).toBe("cohort");
    expect(pickSpace(meByPersona.wanjiku, "ask")).toBe("cohort");
  });

  it("keeps the admin mentor review in Admin without opening Mentoring", () => {
    expect(pickSpace(meByPersona.amina, "confirm")).toBe("admin");
    expect(pickSpace(meByPersona.amina, "mentoring")).toBeNull();
    expect(pickSpace(meByPersona.david, "mentoring")).toBe("mentoring");
    expect(pickSpace(meByPersona.david, "confirm")).toBe("mentoring");
  });

  it("returns null for a space the person cannot open, so the page keeps its existing frame", () => {
    expect(pickSpace(meByPersona.lucy, "sessions")).toBeNull();
    expect(pickSpace(meByPersona.lucy, "discover")).toBeNull();
    expect(pickSpace(meByPersona.joseph, "discover")).toBe("discover");
  });

  it("opens nothing while the spaces flag is off or without a person", () => {
    expect(pickSpace(off, "account")).toBeNull();
    expect(pickSpace(null, "account")).toBeNull();
  });
});

describe("resolveSpacePage", () => {
  it("returns the person, space and page when spaces is on", async () => {
    mocks.getSpaceContext.mockResolvedValue(meByPersona.lucy);
    await expect(resolveSpacePage(locals, "apply")).resolves.toEqual({ me: meByPersona.lucy, space: "community", page: "apply" });
    expect(mocks.getSpaceContext).toHaveBeenCalledWith({ locals });
  });

  it("keeps the existing dashboard when the flag is off for the person", async () => {
    mocks.getSpaceContext.mockResolvedValue(off);
    await expect(resolveSpacePage(locals, "account")).resolves.toBeNull();
  });

  it("keeps the existing dashboard for denials: flag off, signed out, personal access tokens", async () => {
    for (const status of [403, 404]) {
      mocks.getSpaceContext.mockRejectedValueOnce(new Response(null, { status }));
      await expect(resolveSpacePage(locals, "account")).resolves.toBeNull();
    }
  });

  it("keeps the existing dashboard, and grants nothing, when the context cannot load", async () => {
    mocks.getSpaceContext.mockRejectedValue(new Error("D1 unavailable"));
    await expect(resolveSpacePage(locals, "account")).resolves.toBeNull();
  });
});

describe("linkAllowed", () => {
  it("lets ordinary sessions follow every link", () => {
    expect(linkAllowed({}, "/dashboard/me/leads")).toBe(true);
    expect(restrictionsFor({} as App.Locals)).toEqual({ qaPersona: null, demo: false, fixture: false });
  });

  it("applies a synthetic fixture's allowlist to canonical paths and anchors", () => {
    const fixture = restrictionsFor({ stagingFixture: { persona: "member" } } as unknown as App.Locals);
    expect(linkAllowed(fixture, "/dashboard/community")).toBe(true);
    expect(linkAllowed(fixture, "/dashboard/mentoring/confirm")).toBe(true);
    expect(linkAllowed(fixture, "/dashboard/mentoring#requests")).toBe(true);
    expect(linkAllowed(fixture, "/dashboard/account")).toBe(false);
    // B-1.5 opens the Apply form (GET only) so a no-cohort fixture sees its Apply link.
    expect(linkAllowed(fixture, "/dashboard/cohort/apply")).toBe(true);
    expect(linkAllowed(fixture, "/dashboard/attention")).toBe(true);
    expect(linkAllowed(fixture, "/dashboard/me")).toBe(false);
  });

  it("applies the demo and QA allowlists", () => {
    const demo = restrictionsFor({ stagingDemo: { persona: "mentor", expiresAt: 0 } } as unknown as App.Locals);
    expect(linkAllowed(demo, "/dashboard/community")).toBe(true);
    expect(linkAllowed(demo, "/dashboard/me")).toBe(false);
    const qa = { qaPersona: "institution" as keyof typeof DEMO_PERSONAS };
    expect(linkAllowed(qa, "/dashboard/account")).toBe(false);
  });
});

describe("nextStepHref", () => {
  it("goes straight to the space path in the shell, and keeps the legacy path without it", () => {
    expect(nextStepHref({}, "/dashboard/sessions", true)).toBe("/dashboard/cohort/sessions");
    expect(nextStepHref({}, "/dashboard/apply", true)).toBe("/dashboard/cohort/apply");
    expect(nextStepHref({}, "/dashboard/sessions", false)).toBe("/dashboard/sessions");
    expect(nextStepHref({}, "/dashboard/community", true)).toBe("/dashboard/community");
  });

  it("offers no button a restricted fixture could only follow into a 403", () => {
    const fixture = restrictionsFor({ stagingFixture: { persona: "member" } } as unknown as App.Locals);
    for (const inSpaces of [true, false]) {
      expect(nextStepHref(fixture, "/dashboard/sessions", inSpaces)).toBeNull();
      expect(nextStepHref(fixture, "/dashboard/application/app-1", inSpaces)).toBeNull();
      expect(nextStepHref(fixture, "/dashboard/portfolio", inSpaces)).toBeNull();
      expect(nextStepHref(fixture, "/dashboard/leads", inSpaces)).toBeNull();
    }
    expect(nextStepHref(fixture, "/dashboard/apply", true)).toBe("/dashboard/cohort/apply");
    expect(nextStepHref(fixture, "/dashboard/community", false)).toBe("/dashboard/community");
  });

  it("applies the QA allowlist too", () => {
    const qa = { qaPersona: "institution" as keyof typeof DEMO_PERSONAS };
    expect(nextStepHref(qa, "/dashboard/profile", true)).toBeNull();
  });
});

describe("restrictedDashboardHrefs", () => {
  const hrefs = DASHBOARD_LINKS.map((link) => link.href);

  it("leaves ordinary and demo sessions every link", () => {
    expect(restrictedDashboardHrefs({}, hrefs)).toBeUndefined();
    expect(restrictedDashboardHrefs({ demo: true, qaPersona: null, fixture: false }, hrefs)).toBeUndefined();
  });

  it("gives a staging fixture's flag-off sidebar only the pages it may open", () => {
    const fixture = restrictionsFor({ stagingFixture: { persona: "member" } } as unknown as App.Locals);
    expect(restrictedDashboardHrefs(fixture, hrefs)).toEqual([
      "/dashboard", "/dashboard/discover", "/dashboard/community", "/dashboard/apply", "/auth/logout",
    ]);
  });

  it("still applies a QA persona's allowlist", () => {
    const qa = { qaPersona: "institution" as keyof typeof DEMO_PERSONAS };
    expect(restrictedDashboardHrefs(qa, hrefs)).not.toContain("/dashboard/profile");
  });
});

describe("loadCertificates", () => {
  it("lists only the person's valid completions, newest first", async () => {
    const { database, db } = createCapabilityDatabase();
    try {
      database.exec(`
        INSERT INTO program (id,name,description,curriculumId) VALUES ('cohort-c','Synthetic cohort C','Test','curriculum'),('cohort-d','Synthetic cohort D','Test','curriculum');
        INSERT INTO programApplication (id,userId,programId,status,application,completedAt) VALUES
          ('done-old','synthetic-wanjiku','cohort-a','COMPLETED','{}',1700000000),
          ('done-new','synthetic-wanjiku','cohort-b','COMPLETED','{}',1750000000),
          ('legacy-no-date','synthetic-wanjiku','cohort-c','COMPLETED','{}',NULL),
          ('approved','synthetic-wanjiku','cohort-d','APPROVED','{}',NULL),
          ('someone-else','synthetic-otieno','cohort-a','COMPLETED','{}',1760000000);`);
      await expect(loadCertificates(db, "synthetic-wanjiku")).resolves.toEqual([
        { id: "done-new", programName: "Synthetic cohort B" },
        { id: "done-old", programName: "Synthetic cohort A" },
      ]);
      await expect(loadCertificates(db, "nobody")).resolves.toEqual([]);
    } finally {
      database.close();
    }
  });
});
