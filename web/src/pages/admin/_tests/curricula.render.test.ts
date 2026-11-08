import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * /admin/curricula on the style guide: the page's markup, with its read mocked. Creating, editing and
 * deleting a curriculum end to end is e2e/admin-curricula.spec.ts.
 */
const store = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/admin/curricula", () => ({ createDrizzleCurriculumStore: () => ({}), listCurricula: store.list }));

const { default: Page } = await import("../curricula/index.astro");

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.list.mockReset().mockResolvedValue([
    { id: "web", title: "Web foundations", description: "HTML, CSS and a first app.", programs: [{ id: "cohort-07", name: "Cohort 07" }] },
    { id: "data", title: "Data basics", description: "SQL and spreadsheets.", programs: [] },
  ]);
});

async function visit(query = "") {
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid/admin/curricula${query}`),
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  return { status: response.status, body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;

describe("the curricula page on the style guide", () => {
  it("heads the page with the kit's PageHeader and its one primary action", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/data-page-header[\s\S]*?<h1 [^>]*>Curricula<\/h1>[\s\S]*?data-page-action[\s\S]*?<a href="\/admin\/curricula\/new" data-variant="primary"[^>]*>New curriculum<\/a>/);
    expect(count(body, /data-variant="primary"/g)).toBe(1);
  });

  it("puts each curriculum on a kit Card, with a sentence-case usage label and an edit link that says whose", async () => {
    const { body } = await visit();
    expect(count(body, /<article (?=[^>]*data-card)/g)).toBe(2);
    expect(body).toMatch(/<h2 class="[^"]*">Web foundations<\/h2>/);
    expect(body).toContain(">Programs and cohorts using it</h3>");
    expect(body).toMatch(/<a href="\/admin\/programs\/cohort-07" class="[^"]*min-h-11[^"]*text-peach-ink[^"]*">Cohort 07<\/a>/);
    expect(body).toContain("Not used yet");
    // The visible words start the link's name (WCAG 2.5.3), and the title says whose.
    expect(body).toMatch(/<a href="\/admin\/curricula\/web" class="[^"]*">\s*Edit<span class="sr-only"> Web foundations<\/span><\/a>/);
    expect(body).not.toMatch(/aria-label="Edit|uppercase|tracking-wide|text-white|emerald-|\btext-primary\b/);
  });

  it("offers one way to start when there are none: the empty state's action, not a second primary", async () => {
    store.list.mockResolvedValue([]);
    const { body } = await visit();
    expect(body).toMatch(/data-empty-state[\s\S]*?<h2[^>]*>No curricula yet<\/h2>[\s\S]*?<a href="\/admin\/curricula\/new" data-variant="primary"[^>]*>Create your first curriculum<\/a>/);
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).not.toContain("data-page-action");
  });

  it("says a deletion in a success Notice, and a missing curriculum in a warning, both read in turn", async () => {
    const deleted = await visit("?notice=deleted");
    expect(deleted.body).toMatch(/role="status" data-notice="success"[\s\S]*?Curriculum deleted\./);
    const missing = await visit("?notice=missing");
    expect(missing.body).toMatch(/role="status" data-notice="warning"[\s\S]*?That curriculum no longer exists\./);
  });
});
