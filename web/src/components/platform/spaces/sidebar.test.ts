import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Me } from "@/lib/platform/contracts";
import { meByPersona } from "@/lib/platform/fixtures";
import { canonicalSpacePath, isAvailableSpacePath, isNewSpacePath, legacySpacePath } from "@/lib/platform/server/space-routes";
import { STUDENT_DASHBOARD_LINK_IDS, type StudentDashboardLinkId } from "@/lib/student/journey";
import { NOT_OPEN_YET, PAGE_SPACES, SPACE_PAGE_PATHS, spaceSidebar, type SidebarFacts, type SidebarModel, type SpacePageKey } from "./sidebar";

const EVERY_LINK: StudentDashboardLinkId[] = [...STUDENT_DASHBOARD_LINK_IDS];
const NEW_SIGN_IN: StudentDashboardLinkId[] = ["home", "apply", "ask", "account", "logout"];

function facts(me: Me, page: SpacePageKey, overrides: Partial<SidebarFacts> = {}): SidebarFacts {
  return { me, page, visibleLinkIds: EVERY_LINK, unreadLeadCount: 0, certificates: [], ...overrides };
}

function hrefs(model: SidebarModel): string[] {
  return model.groups.flatMap((group) => group.items.map((item) => item.href));
}

function labels(model: SidebarModel): string[] {
  return model.groups.flatMap((group) => group.items.map((item) => item.label));
}

function current(model: SidebarModel): string[] {
  return model.groups.flatMap((group) => group.items.filter((item) => item.current).map((item) => item.label));
}

/** The page file that renders a path today, through B-1.2's rewrite bridge. */
function pageFile(href: string): string | null {
  const path = legacySpacePath(href.split(/[?#]/, 1)[0]!);
  const pages = resolve(import.meta.dirname, "../../../pages");
  const candidates = path.startsWith("/certificate/")
    ? [`${pages}/certificate/[id].astro`]
    : [`${pages}${path}.astro`, `${pages}${path}/index.astro`];
  return candidates.find((file) => existsSync(file)) ?? null;
}

describe("space sidebars", () => {
  it("mark exactly one entry current for every page, in each space the page opens in", () => {
    for (const page of Object.keys(PAGE_SPACES) as SpacePageKey[]) {
      for (const space of PAGE_SPACES[page]) {
        const me = space === "community" ? meByPersona.lucy : meByPersona.amina;
        expect(current(spaceSidebar(space, facts(me, page))), `${page} in ${space}`).toHaveLength(1);
      }
    }
  });

  it("link only to pages that exist, at their space paths", () => {
    const people = Object.values(meByPersona);
    const pages = Object.keys(PAGE_SPACES) as SpacePageKey[];
    for (const me of people) {
      for (const space of me.spaces) {
        for (const page of pages) {
          const model = spaceSidebar(space, facts(me, page, { certificates: [{ id: "app/1", programName: "Cohort 02" }], unreadLeadCount: 2 }));
          for (const href of hrefs(model)) {
            expect(pageFile(href), `${me.user.name} ${space}: ${href}`).not.toBeNull();
            const path = href.split("#", 1)[0]!;
            if (!path.startsWith("/dashboard")) continue;
            // A canonical space path the router serves, or an unmoved page; never a legacy URL that redirects.
            expect(canonicalSpacePath(path), `redirects: ${href}`).toBeNull();
            expect(isAvailableSpacePath(path) || !isNewSpacePath(path), `served: ${href}`).toBe(true);
          }
        }
      }
    }
  });

  it("give the cohort the overview, sessions once unlocked, Ask Tembo and applying", () => {
    const accepted = spaceSidebar("cohort", facts(meByPersona.wanjiku, "cohort"));
    expect(labels(accepted)).toEqual(["Overview", "Sessions", "Ask Tembo", "Apply"]);
    expect(current(accepted)).toEqual(["Overview"]);
    expect(hrefs(accepted)).toEqual(["/dashboard/cohort", "/dashboard/cohort/sessions", "/dashboard/cohort/ask", "/dashboard/cohort/apply"]);

    const applicant = spaceSidebar("cohort", facts(meByPersona.wanjiku, "apply", { visibleLinkIds: NEW_SIGN_IN }));
    expect(labels(applicant)).toEqual(["Overview", "Ask Tembo", "Apply"]);
    expect(current(applicant)).toEqual(["Apply"]);
  });

  it("put the way into a cohort in Community for a member without one", () => {
    const lucy = spaceSidebar("community", facts(meByPersona.lucy, "journey", { visibleLinkIds: NEW_SIGN_IN }));
    expect(lucy.groups.map((group) => group.label)).toEqual([undefined, "Public directory", "Cohorts"]);
    expect(lucy.groups.at(-1)!.items).toEqual([
      expect.objectContaining({ label: "Apply to a cohort", href: "/dashboard/cohort/apply", current: false }),
    ]);
    expect(labels(lucy)).toContain("Ask Tembo");
    expect(current(spaceSidebar("community", facts(meByPersona.lucy, "apply")))).toEqual(["Apply to a cohort"]);
    expect(current(spaceSidebar("community", facts(meByPersona.lucy, "ask")))).toEqual(["Ask Tembo"]);

    // With a cohort, applying and Ask Tembo live in the Cohort space instead.
    const wanjiku = spaceSidebar("community", facts(meByPersona.wanjiku, "journey"));
    expect(labels(wanjiku)).toEqual(["Your journey", "Members", "Mentors"]);
  });

  it("say the directories are the public website's pages, before anyone follows them", () => {
    for (const me of [meByPersona.lucy, meByPersona.wanjiku]) {
      const directory = spaceSidebar("community", facts(me, "journey")).groups.find((group) => group.label === "Public directory")!;
      expect(directory.items.map(({ label, href, publicPage }) => ({ label, href, publicPage }))).toEqual([
        { label: "Members", href: "/community/members", publicPage: true },
        { label: "Mentors", href: "/community/mentors", publicPage: true },
      ]);
    }
    // Every other entry stays in the app.
    const inApp = Object.values(meByPersona).flatMap((me) => me.spaces.map((space) => spaceSidebar(space, facts(me, "journey"))))
      .flatMap((model) => model.groups.flatMap((group) => group.items))
      .filter((entry) => entry.publicPage);
    expect(new Set(inApp.map((entry) => entry.href))).toEqual(new Set(["/community/members", "/community/mentors"]));
  });

  it("label requests and availability as not open yet, in the overview's own words", () => {
    const david = spaceSidebar("mentoring", facts(meByPersona.david, "confirm"));
    expect(david.groups[0]!.items.map(({ label, note, current: isCurrent }) => ({ label, note, current: isCurrent }))).toEqual([
      { label: "Overview", note: undefined, current: false },
      { label: "Confirm work", note: undefined, current: true },
      { label: "Requests", note: "Not open yet", current: false },
      { label: "Availability", note: "Not open yet", current: false },
    ]);
    expect(hrefs(david).slice(2)).toEqual(["/dashboard/mentoring#requests", "/dashboard/mentoring#availability"]);
    // The page those entries open says the same thing, so the sidebar and the page never disagree.
    const overview = readFileSync(resolve(import.meta.dirname, "MentoringOverview.astro"), "utf8");
    expect(overview).toContain(NOT_OPEN_YET);
    expect(overview).not.toMatch(/\bSoon\b/);
  });

  it("count the shared work waiting for the mentor's confirmation on Confirm work, and nothing when none waits or it is unknown", () => {
    const confirm = (me: Me) => spaceSidebar("mentoring", facts(me, "mentoring")).groups[0]!.items.find((item) => item.key === "confirm")!;
    expect(confirm({ ...meByPersona.david, mentoring: { awaitingConfirmation: 4 } })).toMatchObject({
      count: 4, countLabel: "waiting for your confirmation", current: false,
    });
    for (const me of [{ ...meByPersona.david, mentoring: { awaitingConfirmation: 0 } }, meByPersona.david]) {
      expect(confirm(me)).not.toHaveProperty("count");
      expect(confirm(me)).not.toHaveProperty("countLabel");
    }
  });

  it("keep the admin mentor review in the Admin space", () => {
    const amina = spaceSidebar("admin", facts(meByPersona.amina, "confirm"));
    expect(labels(amina)).toEqual(["Admin home", "Mentor review"]);
    expect(current(amina)).toEqual(["Mentor review"]);
    expect(hrefs(amina)).toEqual(["/admin", SPACE_PAGE_PATHS.confirm]);
  });

  it("show the profile's pages as the journey unlocks them, with visitor messages counted", () => {
    const newcomer = spaceSidebar("profile", facts(meByPersona.lucy, "portfolio", { visibleLinkIds: NEW_SIGN_IN }));
    expect(labels(newcomer)).toEqual(["Public profile", "Account", "Your feedback"]);
    expect(current(newcomer)).toEqual(["Public profile"]);

    const alumna = spaceSidebar("profile", facts(meByPersona.achieng, "leads", {
      unreadLeadCount: 3,
      certificates: [{ id: "application-2", programName: "Cohort 02" }],
    }));
    expect(alumna.groups.map((group) => group.label)).toEqual([undefined, "Certificates", "Settings"]);
    expect(labels(alumna)).toEqual(["Public profile", "Writing", "Opportunities", "Visitor messages", "Cohort 02", "Account", "Your feedback"]);
    expect(alumna.groups[0]!.items.find((item) => item.key === "leads")).toMatchObject({ count: 3, current: true });
    expect(hrefs(alumna)).toContain("/certificate/application-2");

    const quiet = spaceSidebar("profile", facts(meByPersona.achieng, "account"));
    expect(quiet.groups[0]!.items.find((item) => item.key === "leads")).not.toHaveProperty("count");
    expect(current(quiet)).toEqual(["Account"]);
  });

  it("encode certificate ids as one path segment", () => {
    const model = spaceSidebar("profile", facts(meByPersona.achieng, "portfolio", { certificates: [{ id: "a/../b", programName: "Cohort 01" }] }));
    expect(hrefs(model)).toContain("/certificate/a%2F..%2Fb");
  });

  it("drop links a restricted identity may not follow, and empty groups with them", () => {
    const onlyJourney = spaceSidebar("community", facts(meByPersona.lucy, "journey", { allowed: (href) => href === "/dashboard/community" }));
    expect(onlyJourney.groups).toEqual([{ items: [expect.objectContaining({ label: "Your journey" })] }]);
  });

  it("give Discover its workspace", () => {
    const joseph = spaceSidebar("discover", facts(meByPersona.joseph, "discover"));
    expect(labels(joseph)).toEqual(["Discover people"]);
    expect(current(joseph)).toEqual(["Discover people"]);
  });
});
