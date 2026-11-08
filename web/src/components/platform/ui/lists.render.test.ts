import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, describe, expect, it } from "vitest";

const { default: ListsInAstro } = await import("./_fixtures/ListsInAstro.astro");

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

const USERS = [
  { id: "u1", name: "Wanjiku Mwangi", joined: "3 Nov" },
  { id: "u2", name: "David Kamau", joined: "5 Nov" },
];

describe("the list parts from an .astro page", () => {
  it("composes a table of rows, each cell a link, a date or a row's action", async () => {
    const html = await container.renderToString(ListsInAstro, { props: { users: USERS } });
    const body = /<tbody role="rowgroup">([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
    expect(body.match(/<tr role="row"/g)).toHaveLength(2);
    expect(body).toMatch(/<td role="cell" data-label="Name" data-primary="true"[^>]*><a href="\/admin\/users\/u1"[^>]*>Wanjiku Mwangi<\/a><\/td>/);
    expect(body).toContain('<span class="sr-only"> David Kamau</span>');
    expect(html).not.toContain("No people yet");
  });

  it("fills a list item's status and actions from named slots", async () => {
    const html = await container.renderToString(ListsInAstro, { props: { users: USERS } });
    const item = /<li data-data-list-item[\s\S]*?<\/li>/.exec(html)?.[0] ?? "";
    expect(item).toMatch(/<\/h3><span data-chip="peach"/);
    expect(item).toContain('<span class="sr-only"> A note from Wanjiku Mwangi</span>');
  });

  it("gives way to each empty state when there is nothing to list", async () => {
    const html = await container.renderToString(ListsInAstro, { props: { users: [] } });
    expect(html).not.toContain("<table");
    expect(html).not.toContain("<ul");
    expect(html).toContain("No people yet");
    expect(html).toContain("No notes yet");
  });
});
