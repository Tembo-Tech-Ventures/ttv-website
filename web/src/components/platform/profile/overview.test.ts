import { describe, expect, it } from "vitest";
import type { CommunityConfirmation, CommunityJourney } from "@/lib/community/model";
import { STUDENT_DASHBOARD_LINK_IDS } from "@/lib/student/journey";
import { joinNames, opportunityAnchor, OVERVIEW_LIMITS, profileOverview, projectState, summarise, type OverviewFacts } from "./overview";

function confirmation(journeyVersion: number, mentorName: string, id = `${mentorName}-${journeyVersion}`): CommunityConfirmation {
  return { id, journeyId: "j", mentorId: `mentor-${mentorName}`, mentorName, statement: "Checked.", method: "Review", journeyVersion, mentorRole: "MENTOR", createdAt: 1 };
}

function work(id: string, overrides: Partial<CommunityJourney> = {}): CommunityJourney {
  return {
    id, userId: "achieng", title: `Project ${id}`, description: "Fictional work.", evidenceUrl: null, occurredAt: "2026-10-01",
    visibility: "institution", version: 1, createdAt: 1, updatedAt: 1, confirmations: [], ...overrides,
  };
}

const ALUMNA: OverviewFacts = {
  person: { id: "achieng", name: "Achieng Otieno", image: null },
  journeyState: "published",
  visibleLinkIds: [...STUDENT_DASHBOARD_LINK_IDS],
  eligible: true,
  profile: {
    status: "PUBLISHED", handle: "achieng-otieno", headline: "Backend builder", bio: "I build ledger tools.",
    location: "Kisumu", country: "KE", skills: ["TypeScript", "SQL"], publicName: null, publicAvatarUrl: null,
  },
  journey: [],
  leads: { items: [], total: 0 },
  drafts: [],
  opportunities: { gate: "published", items: [] },
  certificates: [{ id: "app-2", programName: "Cohort 02" }],
  mentorRequests: false,
  framing: null,
};

/** A member who has not completed a cohort: no public profile, nothing behind the profile gate. */
const MEMBER: OverviewFacts = {
  ...ALUMNA,
  person: { id: "lucy", name: "Lucy Chebet", image: null },
  journeyState: "no_application",
  visibleLinkIds: ["home", "apply", "ask", "account", "logout"],
  eligible: false,
  profile: null,
  opportunities: { gate: "no_profile", items: [] },
  certificates: [],
};

describe("summarise and joinNames", () => {
  it("keeps the first line, and cuts a long one on a word with an ellipsis", () => {
    expect(summarise("One line.\nSecond line.")).toBe("One line.");
    const long = summarise("word ".repeat(40), 30);
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(31);
    expect(long).not.toMatch(/ …$/);
  });

  it("names one, two or more people", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["David"])).toBe("David");
    expect(joinNames(["David", "Mercy"])).toBe("David and Mercy");
    expect(joinNames(["David", "Mercy", "Wanjiru"])).toBe("David, Mercy and Wanjiru");
  });
});

describe("projectState", () => {
  it("says who confirmed the current revision, once per mentor", () => {
    expect(projectState(work("a", { version: 2, confirmations: [confirmation(2, "David"), confirmation(2, "David", "again"), confirmation(1, "Mercy")] })))
      .toEqual({ kind: "confirmed", text: "Confirmed by David", mentors: ["David"] });
  });

  it("names the latest confirmed revision when a newer one waits", () => {
    expect(projectState(work("a", { version: 3, confirmations: [confirmation(1, "Mercy"), confirmation(2, "David")] })))
      .toEqual({ kind: "newer", text: "David confirmed revision 2", mentors: ["David"] });
  });

  it("says shared work is not confirmed yet, and a private one is a draft only its author sees", () => {
    expect(projectState(work("a"))).toEqual({ kind: "waiting", text: "Not confirmed yet" });
    expect(projectState(work("a", { visibility: "private", confirmations: [confirmation(1, "David")] })))
      .toEqual({ kind: "draft", text: "Draft, only you can see it" });
  });
});

describe("profileOverview for an alumna", () => {
  it("shows the published card with only the parts that exist, and links to the public page and the editor", () => {
    const model = profileOverview(ALUMNA);
    expect(model.title).toBe("Your profile");
    expect(model.card).toMatchObject({
      name: "Achieng Otieno", meta: ["Backend builder", "Kisumu", "Cohort 02"], skills: ["TypeScript", "SQL"],
      status: { label: "Published", tone: "ring" }, publicHref: "/talent/achieng-otieno",
    });
    expect(model.actions).toEqual({ view: "/talent/achieng-otieno", edit: { href: "/dashboard/me/portfolio", label: "Edit" } });
    expect(model.noProfile).toBeNull();
    expect(model.certificates).toEqual([{ id: "app-2", programName: "Cohort 02", href: "/certificate/app-2" }]);
  });

  it("prefers the moderated public name and photo, and falls back to the country", () => {
    const model = profileOverview({
      ...ALUMNA,
      person: { ...ALUMNA.person, image: "https://example.invalid/account.png" },
      profile: { ...ALUMNA.profile!, publicName: "Achieng O.", publicAvatarUrl: "https://example.invalid/public.png", location: " ", headline: null },
      certificates: [],
    });
    expect(model.card).toMatchObject({ name: "Achieng O.", avatar: { src: "https://example.invalid/public.png" }, meta: ["KE"] });
  });

  it("offers no public page for a draft or suspended profile, and a draft profile needs publishing", () => {
    const draft = profileOverview({ ...ALUMNA, profile: { ...ALUMNA.profile!, status: "DRAFT" } });
    expect(draft.actions.view).toBeNull();
    expect(draft.card?.status).toEqual({ label: "Draft", tone: "neutral" });
    expect(draft.needs.map((need) => need.text)).toContain("Your public profile is a draft");
    expect(profileOverview({ ...ALUMNA, profile: { ...ALUMNA.profile!, status: "SUSPENDED" } }).actions.view).toBeNull();
  });

  it("encodes the handle and the certificate id as one path segment", () => {
    const model = profileOverview({ ...ALUMNA, profile: { ...ALUMNA.profile!, handle: "a/b" }, certificates: [{ id: "x/../y", programName: "Cohort 01" }] });
    expect(model.actions.view).toBe("/talent/a%2Fb");
    expect(model.certificates[0]!.href).toBe("/certificate/x%2F..%2Fy");
  });

  it("lists what needs the person: unopened messages, newer revisions, then drafts", () => {
    const model = profileOverview({
      ...ALUMNA,
      journey: [
        work("ledger", { title: "Chama ledger", version: 3, confirmations: [confirmation(2, "David")] }),
        work("notes", { title: "Callback notes", visibility: "private" }),
        work("stock", { confirmations: [confirmation(1, "Mercy")] }),
      ],
      leads: { items: [{ id: "l1", fromName: "Njeri", organization: "Mzigo Logistics" }, { id: "l2", fromName: "Otieno", organization: null }], total: 2 },
      drafts: [{ id: "post 1", title: "What duplicate callbacks taught me" }],
    });
    expect(model.needs.map(({ text, action }) => [text, action.label, action.href])).toEqual([
      ["Njeri from Mzigo Logistics wrote to you", "Read", "/dashboard/me/leads"],
      ["Otieno wrote to you", "Read", "/dashboard/me/leads"],
      ["Chama ledger: revision 3 isn't confirmed yet", "Open", "/dashboard/community"],
      ["Draft: “Callback notes”", "Finish", "/dashboard/community"],
      ["Draft: “What duplicate callbacks taught me”", "Finish", "/dashboard/me/writing/post%201"],
    ]);
    // Each link's name starts with its visible words (WCAG 2.5.3) and says what it opens.
    for (const need of model.needs) expect(need.action.name.startsWith(need.action.label)).toBe(true);
  });

  it("sends a newer revision to the mentor directory while mentor requests are open", () => {
    const model = profileOverview({ ...ALUMNA, mentorRequests: true, journey: [work("a", { version: 2, confirmations: [confirmation(1, "David")] })] });
    expect(model.needs[0]!.action).toMatchObject({ label: "Ask a mentor", href: "/dashboard/community/mentors" });
  });

  it("shows the first messages and counts the rest", () => {
    const items = Array.from({ length: OVERVIEW_LIMITS.leads }, (_, index) => ({ id: `l${index}`, fromName: `Visitor ${index}`, organization: null }));
    const model = profileOverview({ ...ALUMNA, leads: { items, total: OVERVIEW_LIMITS.leads + 2 } });
    expect(model.needs).toHaveLength(OVERVIEW_LIMITS.leads + 1);
    expect(model.needs.at(-1)).toMatchObject({ text: "2 more messages from visitors", action: { label: "See all" } });
  });

  it("shows the newest work first up to the limit, and counts it all", () => {
    const journey = Array.from({ length: OVERVIEW_LIMITS.projects + 2 }, (_, index) => work(`w${index}`));
    const model = profileOverview({ ...ALUMNA, journey });
    expect(model.projects.items.map((project) => project.id)).toEqual(journey.slice(0, OVERVIEW_LIMITS.projects).map((entry) => entry.id));
    expect(model.projects).toMatchObject({ total: OVERVIEW_LIMITS.projects + 2, available: true });
  });

  it("drops a sentence's closing full stop from a row's summary, and keeps an ellipsis", () => {
    const model = profileOverview({ ...ALUMNA, journey: [work("a", { description: "Receipts into a ledger." }), work("b", { description: "Wait..." })] });
    expect(model.projects.items.map((project) => project.summary)).toEqual(["Receipts into a ledger", "Wait..."]);
  });

  it("says when the work could not be read, rather than that there is none", () => {
    expect(profileOverview({ ...ALUMNA, journey: null }).projects).toEqual({ items: [], total: 0, available: false });
  });

  it("lists approved client projects while the gate is open, and says when there are more", () => {
    const items = Array.from({ length: OVERVIEW_LIMITS.opportunities + 1 }, (_, index) => ({ id: `p${index}`, title: `Project ${index}`, organization: "Shop", interested: index === 0 }));
    const model = profileOverview({ ...ALUMNA, opportunities: { gate: "published", items } });
    expect(model.opportunities?.items).toHaveLength(OVERVIEW_LIMITS.opportunities);
    expect(model.opportunities?.items[0]!.interested).toBe(true);
    // "Raise hand" opens the project's own card on the Opportunities page, where the hand is raised.
    expect(model.opportunities?.items[1]!.href).toBe("/dashboard/me/opportunities#project-p1");
    expect(opportunityAnchor("a b/c")).toBe("project-a%20b%2Fc");
    expect(model.opportunities?.more).toBe(true);
    expect(profileOverview({ ...ALUMNA, opportunities: { gate: "not_published", items: [] } }).opportunities).toBeNull();
  });
});

describe("profileOverview without a public profile", () => {
  it("tells a member the page opens with a completed cohort, and offers applying", () => {
    const model = profileOverview(MEMBER);
    expect(model.card).toBeNull();
    expect(model.actions).toEqual({ view: null, edit: null });
    expect(model.noProfile).toMatchObject({
      kind: "locked", title: "Your public builder page opens when you complete a cohort",
      action: { href: "/dashboard/cohort/apply", label: "Apply to a cohort" },
    });
    expect(model.opportunities).toBeNull();
    expect(model.needs).toEqual([]);
  });

  it("does not ask someone already in a cohort to apply again", () => {
    for (const journeyState of ["pending", "accepted", "audit"] as const) {
      expect(profileOverview({ ...MEMBER, journeyState }).noProfile?.action).toBeNull();
    }
  });

  it("shows a profile that exists as it is, even after the completion behind it changed", () => {
    const model = profileOverview({ ...ALUMNA, eligible: false });
    expect(model.card?.status.label).toBe("Published");
    expect(model.noProfile).toBeNull();
    expect(model.actions).toEqual({ view: "/talent/achieng-otieno", edit: { href: "/dashboard/me/portfolio", label: "Edit" } });
  });

  it("invites a graduate without a profile to create one", () => {
    expect(profileOverview({ ...ALUMNA, profile: null }).noProfile).toMatchObject({
      kind: "create", action: { href: "/dashboard/me/portfolio", label: "Create your profile" },
    });
  });

  it("leaves mentors and organisations to the partner note, never asking them to apply (QAO-07)", () => {
    expect(profileOverview({ ...MEMBER, framing: "partner" }).noProfile).toMatchObject({ kind: "partner", action: null });
  });

  it("hides what the journey has not unlocked: visitor messages and writing drafts", () => {
    const model = profileOverview({
      ...MEMBER,
      leads: { items: [{ id: "l1", fromName: "Njeri", organization: null }], total: 1 },
      drafts: [{ id: "d1", title: "Draft" }],
    });
    expect(model.needs).toEqual([]);
  });
});

describe("the overview's words", () => {
  it("describe only what exists, in community voice, without rescue framing", () => {
    const models = [
      profileOverview(ALUMNA),
      profileOverview(MEMBER),
      profileOverview({ ...ALUMNA, profile: null }),
      profileOverview({ ...MEMBER, journeyState: "accepted" }),
    ];
    const text = JSON.stringify(models);
    for (const word of [/empower/i, /uplift/i, /underserved/i, /give back/i, /rescue/i, /guarantee/i, /verified/i]) {
      expect(text).not.toMatch(word);
    }
  });
});
