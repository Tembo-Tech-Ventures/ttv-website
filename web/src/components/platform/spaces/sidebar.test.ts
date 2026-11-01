import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Channel, Me } from "@/lib/platform/contracts";
import { channelList, channels, meByPersona } from "@/lib/platform/fixtures";
import { canonicalSpacePath, isAvailableSpacePath, isNewSpacePath, legacySpacePath } from "@/lib/platform/server/space-routes";
import { STUDENT_DASHBOARD_LINK_IDS, type StudentDashboardLinkId } from "@/lib/student/journey";
import { NOT_OPEN_YET, PAGE_SPACES, SPACE_PAGE_PATHS, spaceSidebar, type SidebarFacts, type SidebarModel, type SpacePageKey } from "./sidebar";

const EVERY_LINK: StudentDashboardLinkId[] = [...STUDENT_DASHBOARD_LINK_IDS];
const NEW_SIGN_IN: StudentDashboardLinkId[] = ["home", "apply", "ask", "account", "logout"];

function facts(me: Me, page: SpacePageKey, overrides: Partial<SidebarFacts> = {}): SidebarFacts {
  return { me, page, visibleLinkIds: EVERY_LINK, unreadLeadCount: 0, certificates: [], ...overrides };
}

/** The channel and conduct pages exist only with channels: give them what they are a page of. */
const CHANNEL_PAGES: Partial<Record<SpacePageKey, Channel>> = { communityChannel: channels.help, cohortChannel: channels.cohort04, conduct: channels.help };

function pageFacts(me: Me, page: SpacePageKey): SidebarFacts {
  const open = CHANNEL_PAGES[page];
  return facts(me, page, open ? { channels: { items: channelList.items, currentId: page === "conduct" ? null : open.id } } : {});
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

/** The page file that renders a channel or the habits: their routes are dynamic. */
function channelPageFile(href: string): string | null {
  const pages = resolve(import.meta.dirname, "../../../pages");
  const match = /^\/dashboard\/(community|cohort)\/c\/[^/]+$/.exec(href);
  const file = match ? `${pages}/dashboard/${match[1]}/c/[slug].astro` : `${pages}${href}.astro`;
  return existsSync(file) ? file : null;
}

describe("space sidebars", () => {
  it("mark exactly one entry current for every page, in each space the page opens in", () => {
    for (const page of Object.keys(PAGE_SPACES) as SpacePageKey[]) {
      for (const space of PAGE_SPACES[page]) {
        const me = space === "community" ? meByPersona.lucy : meByPersona.amina;
        expect(current(spaceSidebar(space, pageFacts(me, page))), `${page} in ${space}`).toHaveLength(1);
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

  describe("Community, framed by onboarding (SPEC §3)", () => {
    const groupLabels = (model: SidebarModel) => model.groups.map((group) => group.label ?? "");

    it("is exactly as before while onboarding is off for the person", () => {
      for (const onboarding of [undefined, null]) {
        expect(spaceSidebar("community", facts(meByPersona.lucy, "journey", { onboarding }))).toEqual(spaceSidebar("community", facts(meByPersona.lucy, "journey")));
      }
    });

    it("keeps the way to apply for members and for someone just looking around", () => {
      for (const framing of ["member", "exploring"] as const) {
        const model = spaceSidebar("community", facts(meByPersona.lucy, "journey", { onboarding: { framing, pending: [] } }));
        expect(labels(model)).toContain("Apply to a cohort");
        expect(labels(model)).toContain("Your journey");
      }
    });

    it("does not ask mentors and organisations to apply, and names their work their own", () => {
      const model = spaceSidebar("community", facts(meByPersona.lucy, "journey", { onboarding: { framing: "partner", pending: [] } }));
      expect(labels(model)).not.toContain("Apply to a cohort");
      expect(groupLabels(model)).not.toContain("Cohorts");
      expect(labels(model)[0]).toBe("Your own work");
      expect(current(model)).toEqual(["Your own work"]);
    });

    it("lists pending requests under Your requests, each opening its own row in Account, as a status and never a tab", () => {
      const model = spaceSidebar("community", facts(meByPersona.lucy, "journey", { onboarding: { framing: "member", pending: ["MENTOR", "INSTITUTION"] } }));
      const requests = model.groups.find((group) => group.label === "Your requests")!;
      expect(requests.items).toEqual([
        expect.objectContaining({ label: "Mentor access", href: "/dashboard/account#taking-part-request-mentor", icon: "mentorRequest", note: "Pending", noteTone: "ring", current: false }),
        expect.objectContaining({ label: "Organisation access", href: "/dashboard/account#taking-part-request-institution", icon: "institutionRequest", note: "Pending" }),
      ]);
      expect(groupLabels(model).at(-1)).toBe("Your requests");
      expect(groupLabels(spaceSidebar("community", facts(meByPersona.lucy, "journey", { onboarding: { framing: "member", pending: [] } })))).not.toContain("Your requests");
    });

    it("lists requests only in Community", () => {
      const onboarding = { framing: "member" as const, pending: ["MENTOR" as const] };
      for (const [space, page] of [["profile", "account"], ["cohort", "cohort"]] as const) {
        expect(labels(spaceSidebar(space, facts(meByPersona.wanjiku, page, { onboarding })))).not.toContain("Mentor access");
      }
    });

    it("drops a request entry a restricted identity could not follow", () => {
      const model = spaceSidebar("community", facts(meByPersona.lucy, "journey", {
        onboarding: { framing: "member", pending: ["MENTOR"] }, allowed: (href) => !href.startsWith("/dashboard/account"),
      }));
      expect(groupLabels(model)).not.toContain("Your requests");
    });
  });

  describe("channels", () => {
    const readable = { items: channelList.items };
    const group = (model: SidebarModel) => model.groups.find((entry) => entry.label === "Channels");
    const off = (me: Me): Me => ({ ...me, flags: { ...me.flags, channels: false } });

    it("leave every sidebar exactly as it was while channels is off for the person", () => {
      // SpacePage passes no channels when the flag is off (sidebar-channels.ts); either way nothing changes.
      for (const me of Object.values(meByPersona)) {
        for (const space of me.spaces) {
          for (const page of Object.keys(PAGE_SPACES) as SpacePageKey[]) {
            const before = spaceSidebar(space, facts(off(me), page));
            for (const absent of [undefined, null]) {
              expect(spaceSidebar(space, facts(off(me), page, { channels: absent })), `${me.user.name} ${space} ${page}`).toEqual(before);
            }
            expect(JSON.stringify(before)).not.toMatch(/"channel|conduct/);
          }
        }
      }
    });

    it("list community channels in Community, in the backend's order, then the way back to the habits", () => {
      const model = spaceSidebar("community", facts(meByPersona.lucy, "journey", { channels: readable }));
      expect(model.groups.map((entry) => entry.label)).toEqual([undefined, "Channels", "Public directory", "Cohorts"]);
      expect(group(model)!.items.map(({ label, href, icon }) => ({ label, href, icon }))).toEqual([
        { label: "introductions", href: "/dashboard/community/c/introductions", icon: "channel" },
        { label: "show-your-work", href: "/dashboard/community/c/show-your-work", icon: "channel" },
        { label: "help", href: "/dashboard/community/c/help", icon: "channel" },
        { label: "opportunities", href: "/dashboard/community/c/opportunities", icon: "channel" },
        { label: "design-crit", href: "/dashboard/community/c/design-crit", icon: "channel" },
        { label: "How we talk to each other", href: "/dashboard/community/conduct", icon: "conduct" },
      ]);
    });

    it("list a cohort's channels in Cohort, each with the lock that says only the cohort reads it, and nothing from another space", () => {
      const model = spaceSidebar("cohort", facts(meByPersona.wanjiku, "cohort", { channels: readable }));
      expect(model.groups.map((entry) => entry.label)).toEqual([undefined, "Channels"]);
      expect(group(model)!.items.map(({ label, href, icon }) => ({ label, href, icon }))).toEqual([
        { label: "cohort-04", href: "/dashboard/cohort/c/cohort-04", icon: "cohortChannel" },
        { label: "c04-help", href: "/dashboard/cohort/c/c04-help", icon: "cohortChannel" },
        { label: "c04-announcements", href: "/dashboard/cohort/c/c04-announcements", icon: "cohortChannel" },
      ]);
      // The habits page is Community's: no Cohort sidebar link changes space.
      expect(hrefs(model)).not.toContain("/dashboard/community/conduct");
    });

    it("keep direct conversations out until mentor requests give them a page", () => {
      const all = (["community", "cohort"] as const).flatMap((space) => hrefs(spaceSidebar(space, facts(meByPersona.amina, space === "community" ? "journey" : "cohort", { channels: readable }))));
      expect(all.join(" ")).not.toContain(channels.davidConversation.slug);
      expect(all.join(" ")).not.toContain("/dm/");
    });

    it("show no Channels group in a space with no channel the person can read", () => {
      const communityOnly = { items: [channels.introductions, channels.help] };
      expect(group(spaceSidebar("cohort", facts(meByPersona.wanjiku, "apply", { channels: communityOnly })))).toBeUndefined();
      expect(group(spaceSidebar("community", facts(meByPersona.lucy, "journey", { channels: { items: [] } })))).toBeUndefined();
    });

    it("bolden unread channels with their count, read ones quieter, and mark the open one", () => {
      const model = spaceSidebar("community", facts(meByPersona.lucy, "communityChannel", { channels: { ...readable, currentId: channels.help.id } }));
      const items = group(model)!.items;
      expect(items.find((entry) => entry.label === "help")).toMatchObject({ emphasis: "unread", count: 3, countLabel: "unread messages", current: true });
      expect(items.find((entry) => entry.label === "introductions")).toMatchObject({ emphasis: "read", current: false });
      expect(items.find((entry) => entry.label === "introductions")).not.toHaveProperty("count");
      expect(current(model)).toEqual(["help"]);
      const one = spaceSidebar("community", facts(meByPersona.lucy, "journey", { channels: { items: [{ ...channels.help, unreadCount: 1 }] } }));
      expect(group(one)!.items[0]).toMatchObject({ count: 1, countLabel: "unread message" });
    });

    it("mark the habits current on their own page, in Community only", () => {
      expect(current(spaceSidebar("community", facts(meByPersona.lucy, "conduct", { channels: readable })))).toEqual(["How we talk to each other"]);
      expect(current(spaceSidebar("cohort", facts(meByPersona.wanjiku, "cohort", { channels: readable })))).toEqual(["Overview"]);
    });

    it("say when a channel is archived, and keep it reachable", () => {
      const archived = { items: [{ ...channels.designCrit, archivedAt: 1 }] };
      expect(group(spaceSidebar("community", facts(meByPersona.lucy, "journey", { channels: archived })))!.items[0]).toMatchObject({ label: "design-crit", note: "Archived" });
    });

    it("drop channel links a restricted identity may not follow, the habits with them", () => {
      const model = spaceSidebar("community", facts(meByPersona.lucy, "journey", { channels: readable, allowed: (href) => !href.includes("/c/") && !href.endsWith("/conduct") }));
      expect(group(model)).toBeUndefined();
    });

    it("link only to channel pages the router serves", () => {
      for (const me of [meByPersona.wanjiku, meByPersona.lucy, meByPersona.amina]) {
        for (const space of ["community", "cohort"] as const) {
          if (!me.spaces.includes(space)) continue;
          for (const href of group(spaceSidebar(space, facts(me, space === "cohort" ? "cohort" : "journey", { channels: readable })))?.items.map((entry) => entry.href) ?? []) {
            expect(channelPageFile(href), `${href}`).not.toBeNull();
            expect(isAvailableSpacePath(href), `served: ${href}`).toBe(true);
          }
        }
      }
    });
  });
});
