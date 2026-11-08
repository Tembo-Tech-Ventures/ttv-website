import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * /admin/projects on the style guide, with the read mocked. Its SQL runs in
 * round-trips.render.test.ts.
 */
const store = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("drizzle-orm/d1", () => ({ drizzle: () => ({}) }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/admin/projects", async (actual) => ({ ...(await actual<typeof import("@/lib/admin/projects")>()), readProjectsPage: store.read }));

const { default: Page } = await import("../projects/index.astro");

const AT = new Date(Date.UTC(2026, 9, 6, 9));
const project = (overrides: Record<string, unknown> = {}) => ({
  id: "project-1", organization: "Chama Savings", title: "Member savings tracker", budgetBand: "UNDER_500", timeline: null,
  status: "PENDING", createdAt: AT, interest: 2, ...overrides,
});

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.read.mockReset().mockResolvedValue({ rows: [project()], total: 1, byStatus: new Map([["PENDING", 1]]) });
});

async function visit(path = "/admin/projects") {
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid${path}`),
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  return { status: response.status, body: await response.text() };
}

describe("the client projects list on the style guide", () => {
  it("is one title and a kit table: the project's title links to it, statuses and counts in words", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(body.match(/<h1\b/g)).toHaveLength(1);
    expect(body).toMatch(/<th[^>]*>Project<\/th>[\s\S]*?<th[^>]*>Budget<\/th>[\s\S]*?<th[^>]*>Interested<\/th>/);
    expect(body).toMatch(/<a href="\/admin\/projects\/project-1" class="[^"]*underline[^"]*">Member savings tracker<\/a><span[^>]*>Chama Savings<\/span>/);
    expect(body).toMatch(/data-status="PENDING">In review</);
    expect(body).toContain(">2 builders<");
    expect(body).toContain(">Not given<");
    expect(body).not.toMatch(/text-white|\btext-primary\b|bg-teal|uppercase|data-badge|>View<|—/);
  });

  it("filters by status with links in the reviewer's order, a count only on In review", async () => {
    const { body } = await visit("/admin/projects?status=MATCHED");
    expect(store.read).toHaveBeenCalledWith(expect.anything(), { status: "MATCHED", page: 1 });
    const labels = [...body.matchAll(/<a href="\/admin\/projects(?:\?status=[A-Z]+)?"[^>]*>([^<]+)/g)].map((match) => match[1].trim());
    expect(labels.slice(0, 6)).toEqual(["All", "In review", "Accepted", "Matched", "Declined", "Closed"]);
    expect(body).toMatch(/href="\/admin\/projects\?status=MATCHED"[^>]*aria-current="page"/);
    expect(body).toMatch(/In review<span[^>]*><span aria-hidden="true">1<\/span><span class="sr-only"> 1 waiting<\/span>/);
    expect(body.match(/ waiting<\/span>/g)).toHaveLength(1);
  });

  it("says an empty filter in its own words, and a page past the end, with a way back", async () => {
    store.read.mockResolvedValue({ rows: [], total: 0, byStatus: new Map() });
    expect((await visit("/admin/projects?status=PENDING")).body).toContain("No one is waiting for a decision.");
    expect((await visit("/admin/projects?status=CLOSED")).body).toContain("No closed projects");
    expect((await visit()).body).toContain("No client projects yet");
    store.read.mockResolvedValue({ rows: [], total: 4, byStatus: new Map() });
    expect((await visit("/admin/projects?page=7")).body).toMatch(/No projects on this page[\s\S]*?href="\/admin\/projects"[^>]*>Back to the first page/);
  });
});
