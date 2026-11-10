import { describe, expect, it } from "vitest";
import type { CommunityConfirmation, CommunityJourney } from "@/lib/community/model";
import { STUDENT_DASHBOARD_LINK_IDS } from "@/lib/student/journey";
import { joinNames, opportunityAnchor, OVERVIEW_LIMITS, profileOverview, projectState, summarise, type OverviewFacts } from "./overview";

function confirmation(journeyVersion: number, mentorName: string, id = `${mentorName}-${journeyVersion}`): CommunityConfirmation {
  return { id, journeyId: "j", mentorId: `mentor-${mentorName}`, mentorName, statement: "Checked.", method: "Review", journeyVersion, mentorRole: "MENTOR", createdAt: 1 };
}

function work(id: string, overrides: Partial<CommunityJourney> = {}): CommunityJourney {
  return { kind:"contribution" as const, repoFullName:null,
    id, userId: "achieng", title: `Project ${id}`, description: "Fictional work.", evidenceUrl: null, occurredAt: "2026-10-01",
    status: "posted", version: 1, createdAt: 1, updatedAt: 1, confirmations: [], ...overrides,
  };
}

const ALUMNA: OverviewFacts = {
  person: { id: "achieng", name: "Achieng Otieno", image: null },
  visibleLinkIds: [...STUDENT_DASHBOARD_LINK_IDS],
  eligible: true,
  profile: {
    onPublicSite: 1, listed: 1, status: "PUBLISHED", handle: "achieng-otieno", headline: "Backend builder", bio: "I build ledger tools.",
    location: "Kisumu", country: "KE", skills: ["TypeScript", "SQL"], publicName: null, publicAvatarUrl: null,
  },
  journey: [],
  leads: { items: [], total: 0 },
  drafts: [],
  opportunities: { gate: "published", items: [] },
  certificates: [{ id: "app-2", programName: "Cohort 02" }],
  mentorRequests: false,
};

/** A member who has not completed a cohort: no public profile, nothing behind the profile gate. */
const MEMBER: OverviewFacts = {
  ...ALUMNA,
  person: { id: "lucy", name: "Lucy Chebet", image: null },
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

  it("explains held work without claiming it is shared",()=>{
    expect(projectState(work("held",{moderationHold:true}))).toEqual({kind:"held",text:"Saved, waiting for a human review"});
  });
  it("says shared work is not confirmed yet, and a private one is a draft only its author sees", () => {
    expect(projectState(work("a"))).toEqual({ kind: "waiting", text: "Not confirmed yet" });
    expect(projectState(work("a", { status: "draft", confirmations: [confirmation(1, "David")] })))
      .toEqual({ kind: "draft", text: "Draft, only you can see it" });
  });
});

describe("profileOverview for an alumna", () => {
  it("shows the published card with only the parts that exist, and links to her member page, the public page and the editor", () => {
    const model = profileOverview(ALUMNA);
    expect(model.title).toBe("Your profile");
    expect(model.card).toMatchObject({
      name: "Achieng Otieno", meta: ["Backend builder", "Kisumu", "Cohort 02"], skills: ["TypeScript", "SQL"],
      status: { label: "On the public website", tone: "ring" }, memberHref: "/dashboard/community/members/achieng-otieno", publicHref: "/talent/achieng-otieno",
    });
    expect(model.actions).toEqual({
      member: "/dashboard/community/members/achieng-otieno", view: "/talent/achieng-otieno", edit: { href: "/dashboard/me/portfolio", label: "Edit" },
    });
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

  it("offers no public page for an unlisted or suspended profile, and asks only a graduate to list it", () => {
    const draft = profileOverview({ ...ALUMNA, profile: { ...ALUMNA.profile!, status: "DRAFT", onPublicSite: 0 } });
    expect(draft.actions.view).toBeNull();
    expect(draft.card?.status).toEqual({ label: "Members only", tone: "neutral" });
    expect(draft.needs.find((need) => need.key === "profile-draft")).toMatchObject({
      text: "You're not on the public website yet", action: { href: "/dashboard/me/portfolio", label: "List me" },
    });
    // Someone who hasn't completed a cohort can't be listed, so nothing asks them to be.
    const member = profileOverview({ ...ALUMNA, eligible: false, profile: { ...ALUMNA.profile!, status: "DRAFT" } });
    expect(member.needs.find((need) => need.key === "profile-draft")).toBeUndefined();
    expect(profileOverview({ ...ALUMNA, profile: { ...ALUMNA.profile!, status: "SUSPENDED" } }).actions.view).toBeNull();
  });

  it("says where the profile really is, and never asks someone who took themselves off, is held, or is staff to list it", () => {
    const off = { ...ALUMNA.profile!, status: "DRAFT" as const, onPublicSite: 0 };
    const need = (facts: OverviewFacts) => profileOverview(facts).needs.find((item) => item.key === "profile-draft");
    // Listed before and a draft now: they chose to come off, so nothing nags them back.
    expect(need({ ...ALUMNA, profile: { ...off, everListed: true } })).toBeUndefined();
    expect(profileOverview({ ...ALUMNA, profile: { ...off, everListed: true } }).card?.status.label).toBe("Members only");
    // Held by the check: not in the directory and not public, and pressing "List me" would only ask the check again.
    const held = { ...ALUMNA, profile: { ...off, listed: 0 } };
    expect(need(held)).toBeUndefined();
    expect(profileOverview(held).card?.status.label).toBe("Waiting for a check");
    expect(profileOverview({ ...ALUMNA, profile: { ...ALUMNA.profile!, onPublicSite: 0, listed: 0 } }).card?.status.label).toBe("Waiting for a check");
    // Mentors and staff are never listed, whatever the status says.
    const staff = { ...ALUMNA, staff: true, profile: { ...ALUMNA.profile!, onPublicSite: 0, listed: 0 } };
    expect(profileOverview(staff).card?.status.label).toBe("Not listed: mentors and staff");
    expect(need({ ...staff, profile: { ...off, listed: 0 } })).toBeUndefined();
    expect(profileOverview({ ...MEMBER, staff: true }).noProfile?.body).toContain("only you and the team see it");
    expect(profileOverview({ ...MEMBER, staff: true }).noProfile?.body).not.toContain("Everyone signed in");
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
        work("ledger", { kind:"contribution" as const, repoFullName:null, title: "Chama ledger", version: 3, confirmations: [confirmation(2, "David")] }),
        work("notes", { title: "Callback notes", status: "draft" }),
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

  it("caps journey rows in Needs you, and counts the rest on Your journey", () => {
    const extra = 2;
    const newer = Array.from({ length: OVERVIEW_LIMITS.journeyNeeds + extra }, (_, index) => work(`n${index}`, { version: 2, confirmations: [confirmation(1, "David")] }));
    const drafts = Array.from({ length: OVERVIEW_LIMITS.journeyNeeds + 1 }, (_, index) => work(`d${index}`, { status: "draft" }));
    const model = profileOverview({ ...ALUMNA, journey: [...newer, ...drafts] });
    const icons = model.needs.map((need) => need.icon);
    expect(icons.filter((icon) => icon === "revision")).toHaveLength(OVERVIEW_LIMITS.journeyNeeds + 1);
    expect(icons.filter((icon) => icon === "draft")).toHaveLength(OVERVIEW_LIMITS.journeyNeeds + 1);
    expect(model.needs.find((need) => need.key === "journey-more-revisions")).toMatchObject({
      text: "2 more newer revisions on Your journey", action: { label: "See all", href: "/dashboard/community" },
    });
    expect(model.needs.find((need) => need.key === "journey-more-drafts")?.text).toBe("1 more draft on Your journey");
    expect(profileOverview({ ...ALUMNA, journey: newer.slice(0, OVERVIEW_LIMITS.journeyNeeds) }).needs.some((need) => need.key.startsWith("journey-more"))).toBe(false);
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
  it("invites anyone without a profile to make one, and says who sees it", () => {
    const model = profileOverview(MEMBER);
    expect(model.card).toBeNull();
    expect(model.actions).toEqual({ member: null, view: null, edit: null });
    expect(model.noProfile).toEqual({
      kind: "create", title: "Make your profile",
      body: "Who you are, what you work with and what you're looking for, with the work you post. Everyone signed in to TTV can see it.",
      action: { href: "/dashboard/me/portfolio", label: "Make your profile" },
    });
    expect(model.opportunities).toBeNull();
    expect(model.needs).toEqual([]);
    // Whatever their cohort, or none: nobody is sent to apply before they can have a profile.
    for (const eligible of [false, true]) {
      expect(profileOverview({ ...MEMBER, eligible }).noProfile?.action.href).toBe("/dashboard/me/portfolio");
    }
  });

  it("shows a profile that exists as it is, even after the completion behind it changed", () => {
    const model = profileOverview({ ...ALUMNA, eligible: false });
    expect(model.card?.status.label).toBe("On the public website");
    expect(model.noProfile).toBeNull();
    expect(model.actions).toEqual({
      member: "/dashboard/community/members/achieng-otieno", view: "/talent/achieng-otieno", edit: { href: "/dashboard/me/portfolio", label: "Edit" },
    });
  });

  it("links the member page only while the directory lists the profile, and the public page only while it is public", () => {
    // Held by the check, suspended, or a mentor's or admin's: not listed, so no member page to show.
    const unlisted = profileOverview({ ...ALUMNA, profile: { ...ALUMNA.profile!, listed: 0 } });
    expect(unlisted.actions.member).toBeNull();
    expect(unlisted.card?.memberHref).toBeNull();
    // Listed but not a graduate's published page: the member page, and nothing public.
    const draft = profileOverview({ ...ALUMNA, profile: { ...ALUMNA.profile!, status: "DRAFT", onPublicSite: 0 } });
    expect(draft.actions).toMatchObject({ member: "/dashboard/community/members/achieng-otieno", view: null });
  });

  it("tells a graduate without a profile they can also list it on the public website", () => {
    expect(profileOverview({ ...ALUMNA, profile: null }).noProfile).toMatchObject({
      kind: "create", body: expect.stringContaining("you can also list it on the public website"),
      action: { href: "/dashboard/me/portfolio", label: "Make your profile" },
    });
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
      profileOverview({ ...MEMBER, staff: true }),
    ];
    const text = JSON.stringify(models);
    for (const word of [/empower/i, /uplift/i, /underserved/i, /give back/i, /rescue/i, /guarantee/i, /verified/i]) {
      expect(text).not.toMatch(word);
    }
  });
});
