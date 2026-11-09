import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, describe, expect, it } from "vitest";

const { default: PageHeaderInAstro } = await import("./_fixtures/PageHeaderInAstro.astro");

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
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
