import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, describe, expect, it } from "vitest";

const { default: EmptySlotsInAstro } = await import("./_fixtures/EmptySlotsInAstro.astro");

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

describe("named slots an .astro condition leaves empty", () => {
  it("draw no empty box: no action row, no sentence, no actions", async () => {
    const html = await container.renderToString(EmptySlotsInAstro, { props: { show: false } });
    expect(html).not.toContain("data-page-action");
    expect(html).not.toContain("max-w-prose text-base leading-relaxed text-ink-secondary");
    expect(html).not.toContain('class="mt-2 flex flex-wrap gap-2"');
    expect(html).not.toContain("max-w-prose text-sm leading-relaxed text-ink-secondary");
  });

  it("still draw each part when the condition holds", async () => {
    const html = await container.renderToString(EmptySlotsInAstro, { props: { show: true } });
    expect(html).toMatch(/<div data-page-action="true"[^>]*><a href="\/new"/);
    expect(html).toContain("Every cohort.");
    expect(html).toContain("Create one.");
    expect(html.match(/class="mt-2 flex flex-wrap gap-2"/g)).toHaveLength(2);
  });
});
