import { afterEach, describe, expect, it, vi } from "vitest";
import { meByPersona } from "@/lib/platform/fixtures";
import { createCapabilityDatabase } from "@/lib/platform/server/capabilities.test-support";
import { DEMO_PERSONAS } from "@/lib/staging-demo-policy";

const mocks = vi.hoisted(() => ({ getSpaceContext: vi.fn(), getOnboardingState: vi.fn(), recordError: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("@/lib/platform/server/space-context", () => ({ getSpaceContext: mocks.getSpaceContext }));
vi.mock("@/lib/onboarding/service", () => ({ getOnboardingState: mocks.getOnboardingState }));
vi.mock("@/lib/observability/errors", () => ({ recordError: mocks.recordError }));
import { DASHBOARD_LINKS } from "@/components/shells/DashboardShell";
import type { StudentNextStep } from "@/lib/student/journey";
import {
  inSpacesWords,
  linkAllowed,
  loadCertificates,
  loadOnboarding,
  pickSpace,
  resolveSpacePage,
  restrictedHrefs,
  restrictedNextStep,
  restrictionsFor,
} from "./space-page";

const locals = { user: { id: "synthetic" } } as unknown as App.Locals;
const off = { ...meByPersona.amina, flags: { ...meByPersona.amina.flags, spaces: false } };

afterEach(() => {
  mocks.getSpaceContext.mockReset();
  mocks.getOnboardingState.mockReset();
  mocks.recordError.mockReset();
});

const PENDING = {
  stage: "DONE", intents: ["MENTOR"], inferred: [], roles: [],
  requests: [{ id: "r1", role: "MENTOR", status: "PENDING", note: "Backend reviews for small teams.", organisation: null, organisationRole: null, link: null, decisionMessage: null, createdAt: 1, updatedAt: 1, decidedAt: null, seenAt: null }],
};

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
  it("returns the person, space and page when spaces is on, with how onboarding frames it", async () => {
    mocks.getSpaceContext.mockResolvedValue(meByPersona.lucy);
    mocks.getOnboardingState.mockResolvedValue(PENDING);
    await expect(resolveSpacePage(locals, "apply")).resolves.toMatchObject({
      me: meByPersona.lucy, space: "community", page: "apply", onboarding: { framing: "partner", pending: ["MENTOR"] },
    });
    expect(mocks.getSpaceContext).toHaveBeenCalledWith({ locals });
    expect(mocks.getOnboardingState).toHaveBeenCalledWith("synthetic-d1", meByPersona.lucy.user.id);
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

describe("loadOnboarding", () => {
  const lucy = meByPersona.lucy;
  const flagOff = { ...lucy, flags: { ...lucy.flags, onboarding: false } };

  it("reads the person's onboarding for the landing pages, Account and every Community page", async () => {
    mocks.getOnboardingState.mockResolvedValue(PENDING);
    for (const [space, page] of [["community", "journey"], ["community", "apply"], ["cohort", "cohort"], ["mentoring", "mentoring"], ["discover", "discover"], ["profile", "account"]] as const) {
      expect.soft(await loadOnboarding(locals, lucy, space, page)).toMatchObject({ cards: [{ kind: "pending", role: "MENTOR" }] });
    }
  });

  it("reads nothing for other pages, which onboarding does not change", async () => {
    for (const [space, page] of [["cohort", "sessions"], ["profile", "portfolio"], ["mentoring", "confirm"], ["cohort", "apply"]] as const) {
      await expect(loadOnboarding(locals, lucy, space, page)).resolves.toBeNull();
    }
    expect(mocks.getOnboardingState).not.toHaveBeenCalled();
  });

  it("is null, and reads nothing, while onboarding is off for the person: the pages stay exactly as they were", async () => {
    await expect(loadOnboarding(locals, flagOff, "community", "journey")).resolves.toBeNull();
    await expect(loadOnboarding(locals, { ...lucy, flags: { ...lucy.flags, spaces: false } }, "community", "journey")).resolves.toBeNull();
    expect(mocks.getOnboardingState).not.toHaveBeenCalled();
  });

  it("never shows to restricted synthetic identities, personal access tokens or an agent's delegated session", async () => {
    const restricted = [
      { stagingFixture: { persona: "member" } },
      { stagingDemo: { persona: "mentor", expiresAt: 0 } },
      { stagingQa: { persona: "member-noncohort" } },
      { personalAccessToken: { id: "pat" } },
      { session: { userAgent: "ttv-agent:01EXAMPLE" } },
    ];
    for (const extra of restricted) {
      expect.soft(await loadOnboarding({ ...locals, ...extra } as unknown as App.Locals, lucy, "community", "journey")).toBeNull();
    }
    expect(mocks.getOnboardingState).not.toHaveBeenCalled();
  });

  it("keeps the framing from before onboarding when the read fails, and records why", async () => {
    mocks.getOnboardingState.mockRejectedValue(new Error("D1 unavailable"));
    await expect(loadOnboarding(locals, lucy, "community", "journey")).resolves.toBeNull();
    expect(mocks.recordError).toHaveBeenCalledWith("synthetic-d1", expect.objectContaining({ route: "/dashboard/community", level: "warning" }));
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

describe("restricted identities", () => {
  const fixture = restrictionsFor({ stagingFixture: { persona: "member" } } as unknown as App.Locals);
  const qa = { qaPersona: "member-noncohort" as keyof typeof DEMO_PERSONAS };
  const sessions: StudentNextStep = {
    title: "Start with your cohort sessions",
    description: "You are part of the cohort. Revisit each session and use Ask AI as you build with the community.",
    detail: "Cohort 05",
    action: { href: "/dashboard/sessions", label: "Watch sessions" },
  };
  const apply: StudentNextStep = { ...sessions, title: "Apply to Cohort 06", action: { href: "/dashboard/apply", label: "Apply" } };

  it("are never offered a next step they cannot open", () => {
    expect(restrictedNextStep({}, sessions)).toBe(sessions);
    expect(restrictedNextStep(fixture, apply)).toBe(apply);
    const fixtureStep = restrictedNextStep(fixture, sessions);
    expect(fixtureStep.action.href).toBe("/dashboard/community");
    expect(fixtureStep.description).toContain("synthetic staging account");
    expect(linkAllowed(fixture, fixtureStep.action.href)).toBe(true);
    // A QA persona keeps its existing replacement step, word for word.
    expect(restrictedNextStep(qa, sessions).description).toContain("not available in this session");
  });

  it("see only the existing dashboard links their allowlists open; everyone else sees them all", () => {
    const hrefs = DASHBOARD_LINKS.map((link) => link.href);
    expect(restrictedHrefs({}, hrefs)).toBeUndefined();
    expect(restrictedHrefs({ demo: true }, hrefs)).toBeUndefined();
    const forFixture = restrictedHrefs(fixture, hrefs)!;
    expect(forFixture).toContain("/dashboard/community");
    expect(forFixture).not.toContain("/dashboard/sessions");
    expect(forFixture).not.toContain("/dashboard/profile");
    expect(forFixture.every((href) => linkAllowed(fixture, href))).toBe(true);
    expect(restrictedHrefs(qa, hrefs)!.every((href) => linkAllowed(qa, href))).toBe(true);
  });
});

describe("inSpacesWords", () => {
  it("calls the assistant Ask Tembo, as the shell does, and changes nothing else", () => {
    const step: StudentNextStep = {
      title: "Start with your cohort sessions",
      description: "Revisit each session and use Ask AI as you build with the community.",
      detail: null,
      action: { href: "/dashboard/sessions", label: "Watch sessions" },
    };
    expect(inSpacesWords(step)).toEqual({ ...step, description: "Revisit each session and use Ask Tembo as you build with the community." });
    expect(step.description).toContain("Ask AI");
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
