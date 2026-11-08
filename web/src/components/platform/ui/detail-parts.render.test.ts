import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, describe, expect, it } from "vitest";

const { default: DetailPartsInAstro } = await import("./_fixtures/DetailPartsInAstro.astro");

let html = "";
beforeAll(async () => {
  const container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
  html = await container.renderToString(DetailPartsInAstro, {
    request: new Request("https://tembotechventures.com/admin/applications/a1?confirm=decline&tab=answers"),
  });
});

const between = (start: RegExp, end: string) => {
  const from = html.search(start);
  return from === -1 ? "" : html.slice(from, html.indexOf(end, from) + end.length);
};

describe("the detail parts from an .astro page", () => {
  it("lets EmptyState take its action from slot=\"action\"", () => {
    const empty = between(/<div data-empty-state/, "</a></div></div>");
    expect(empty).toContain("Notes you add appear here.");
    expect(empty).toMatch(/<div class="mt-2 flex flex-wrap gap-2"><a href="\/admin\/applications\/a1\/notes"[^>]*>Add a note<\/a><\/div>/);
  });

  it("lets Notice take its actions from slot=\"actions\"", () => {
    const notice = between(/<div role="status" data-notice="success"/, "</a></div></div></div>");
    expect(notice).toContain("Wanjiku can join Cohort 05.");
    expect(notice).toMatch(/<div class="mt-2 flex flex-wrap gap-2"><a href="\/admin\/programs\/cohort-05"[^>]*>Open Cohort 05<\/a><\/div>/);
  });

  it("composes a DescriptionList from DescriptionItems, a chip and a link inside", () => {
    const list = between(/<dl data-description-list/, "</dl>");
    expect(list.match(/<div data-description-item/g)).toHaveLength(2);
    expect(list).toMatch(/<dt[^>]*>Status<\/dt><dd[^>]*><span data-chip="success"[^>]*><span class="truncate"><span data-status="APPROVED">Accepted<\/span>/);
    expect(list).toContain('<a href="mailto:wanjiku@invalid.ttv">');
  });

  it("asks before a destructive POST, with Cancel back to the same page and its other parameters", () => {
    // It takes focus as it renders, so the reader lands on the question.
    const step = between(/<div data-confirm-step="true"/, "</form>");
    expect(step).toMatch(/^<div data-confirm-step="true"[^>]*><div autofocus="" tabindex="-1" role="region" aria-label="[^"]+" data-notice="warning"/);
    expect(step).toContain("Decline Wanjiku Mwangi&#x27;s application?");
    expect(step).toMatch(/<form method="post" class="flex flex-wrap gap-2"><input type="hidden" name="intent" value="decline"\/><input type="hidden" name="applicationId" value="a1"\/>/);
    expect(step).toMatch(/<button type="submit"[^>]*data-variant="danger"[^>]*>Decline application<\/button>/);
    expect(step).toContain('<a href="/admin/applications/a1?tab=answers" data-variant="ghost"');
  });

  it("leads with the way back", () => {
    expect(html.indexOf("data-back-link")).toBeLessThan(html.indexOf("data-description-list"));
  });
});
