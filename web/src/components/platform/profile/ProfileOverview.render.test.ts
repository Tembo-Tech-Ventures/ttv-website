import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, describe, expect, it } from "vitest";
import { STUDENT_DASHBOARD_LINK_IDS } from "@/lib/student/journey";
import { linkClass } from "@/components/platform/ui";
import { profileOverview, type OverviewFacts } from "./overview";

const { default: ProfileOverview } = await import("./ProfileOverview.astro");

/*
 * The Profile Overview on the TTV UI kit (S11): the header's two button links, the one peach action,
 * row actions that are the kit's small quiet buttons and keep their row in their names, and the prose
 * link to Your journey in the ink of its sentence (linkClass), never a hand-rolled underline.
 */
const ALUMNA: OverviewFacts = {
  person: { id: "achieng", name: "Achieng Otieno", image: null },
  journeyState: "published",
  visibleLinkIds: [...STUDENT_DASHBOARD_LINK_IDS],
  eligible: true,
  profile: {
    onPublicSite:1, status: "PUBLISHED", handle: "achieng-otieno", headline: "Backend builder", bio: "I build ledger tools.",
    location: "Kisumu", country: "KE", skills: ["TypeScript", "SQL"], publicName: null, publicAvatarUrl: null,
  },
  journey: [],
  leads: { items: [{ id: "lead", fromName: "Grace Wanjiru", organization: "Chama Savings" }], total: 1 },
  drafts: [],
  opportunities: { gate: "published", items: [{ id: "savings", title: "Member savings tracker", organization: "Chama Savings", interested: false }] },
  certificates: [{ id: "app-2", programName: "Cohort 02" }],
  mentorRequests: false,
  framing: null,
};

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

const render = (facts: OverviewFacts) => container.renderToString(ProfileOverview, { props: { model: profileOverview(facts) } });

describe("ProfileOverview", () => {
  it("heads the page with the kit's one title and two button links, one of them peach", async () => {
    const html = await render(ALUMNA);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*data-page-title[^>]*>Your profile<\/h1>/);
    expect(html).toMatch(/<a[^>]*href="\/talent\/achieng-otieno"[^>]*data-variant="quiet"[^>]*data-size="lg"[^>]*>[\s\S]*?View public page/);
    expect(html).toMatch(/<a[^>]*data-variant="primary"[^>]*data-size="lg"[^>]*>[\s\S]*?Edit/);
    expect(html.match(/data-variant="primary"/g)).toHaveLength(1);
  });

  it("gives each row's action the kit's small quiet button, named for its row", async () => {
    const html = await render(ALUMNA);
    expect(html).toMatch(/<a[^>]*aria-label="Raise hand on Opportunities: Member savings tracker"[^>]*data-variant="quiet"[^>]*data-size="sm"/);
    expect(html).toMatch(/<a[^>]*aria-label="View your Cohort 02 certificate"[^>]*data-variant="quiet"[^>]*data-size="sm"/);
    expect(html).toMatch(/data-profile-need="message"[\s\S]*?<a[^>]*data-variant="quiet"[^>]*data-size="sm"/);
    // Nothing hand-rolled is left: the old row and header classes are gone.
    expect(html).not.toContain("hover:underline");
    expect(html).not.toContain("px-5");
  });

  it("links to Your journey in running text with linkClass", async () => {
    const html = await render(ALUMNA);
    const prose = html.match(/Add what you(?:'|&#39;|&#x27;)ve built on <a([^>]*)>Your journey<\/a>/);
    expect(prose).not.toBeNull();
    expect(prose?.[1]).toContain('href="/dashboard/community"');
    expect(prose?.[1]).toContain(`class="${linkClass()}"`);
  });

  it("asks someone without a profile to apply through a quiet kit button link", async () => {
    const html = await render({
      ...ALUMNA,
      journeyState: "no_application",
      visibleLinkIds: ["home", "apply", "ask", "account", "logout"],
      eligible: false,
      profile: null,
      leads: { items: [], total: 0 },
      opportunities: { gate: "no_profile", items: [] },
      certificates: [],
    });
    expect(html).toMatch(/data-profile-card="locked"[\s\S]*?<a[^>]*href="\/dashboard\/cohort\/apply"[^>]*data-variant="quiet"[^>]*>[\s\S]*?Apply to a cohort/);
    expect(html).not.toContain("View public page");
  });
});
