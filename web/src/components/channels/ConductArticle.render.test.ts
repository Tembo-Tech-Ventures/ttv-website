import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, describe, expect, it } from "vitest";
import ConductArticle from "./ConductArticle.astro";
import { CONDUCT_TITLE } from "./conduct";

/** The conduct page's body: the kit's PageTitle (the screen's one Mattone h1) and one peach action. */
let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

const render = (props: Record<string, unknown>) =>
  container.renderToString(ConductArticle, { props: { action: "/dashboard/community/conduct", ...props } });

describe("ConductArticle", () => {
  it("titles the page with the kit's PageTitle, once, and offers one peach action to someone who has not agreed", async () => {
    const html = await render({ record: null });
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<h1[^>]*data-page-title[^>]*class="[^"]*font-heading[^"]*"[^>]*>${CONDUCT_TITLE}</h1>`));
    expect(html.match(/bg-primary text-dark/g)).toHaveLength(1);
  });

  it("says when the person agreed, with no action, once they have", async () => {
    const html = await render({ record: { version: 1, acknowledgedAt: Date.UTC(2026, 10, 3), current: true } });
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toContain("bg-primary text-dark");
  });
});
