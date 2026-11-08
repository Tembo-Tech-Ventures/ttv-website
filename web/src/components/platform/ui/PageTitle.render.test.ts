import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, describe, expect, it } from "vitest";

const { default: SpacesPageTitle } = await import("@/components/platform/spaces/PageTitle.astro");
const { default: PageHeaderInAstro } = await import("./_fixtures/PageHeaderInAstro.astro");

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

describe("the spaces PageTitle, kept for pages not yet on the kit", () => {
  it("draws the kit's PageTitle in the spaces shell, markup in the title included", async () => {
    const html = await container.renderToString(SpacesPageTitle, { props: { spaces: true }, slots: { default: "Cohort <em>05</em>" } });
    expect(html).toBe(
      // The room above and below keeps the text's overhang off a link or tab beside it on these older pages.
      '<h1 data-page-title="true" class="font-heading leading-[1.1] tracking-heading text-4xl text-balance wrap-anywhere text-ink-primary sm:text-5xl lg:text-6xl my-[0.2em]">Cohort <em>05</em></h1>',
    );
  });

  it("keeps a title inside a card at its old size until that page moves to the kit", async () => {
    const html = await container.renderToString(SpacesPageTitle, { props: { spaces: true, size: "card" }, slots: { default: "Amina Hassan" } });
    expect(html).toBe('<h1 class="tracking-heading break-words text-2xl text-ink-primary sm:text-3xl">Amina Hassan</h1>');
    expect(html).not.toContain("data-page-title");
  });
});

describe("PageHeader from an .astro page", () => {
  it("takes the sentence as its children and the action from slot=\"action\", in that order", async () => {
    const html = await container.renderToString(PageHeaderInAstro);
    const header = /<header data-page-header="true"[^>]*>([\s\S]*)<\/header>/.exec(html)?.[1] ?? "";
    expect(header).toMatch(/<h1 id="programs-title" data-page-title="true"[^>]*>Programs<\/h1>/);
    expect(header).toContain("Every cohort, past and running.");
    const action = /<div data-page-action="true"[^>]*>([\s\S]*?)<\/div>/.exec(header)?.[1] ?? "";
    expect(action).toMatch(/^<a href="\/admin\/programs\/new" data-variant="primary"[^>]*>New program<\/a>$/);
    expect(header.indexOf("Every cohort")).toBeLessThan(header.indexOf("data-page-action"));
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });
});
