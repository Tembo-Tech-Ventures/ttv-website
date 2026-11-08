import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedbackThemeRecord } from "@/lib/feedback/theme-store";

/* /admin/feedback/themes on the style guide: the page's markup, with its read mocked. */
const store = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/feedback/theme-store", () => ({ listThemes: store.list }));

const { default: Page } = await import("../feedback/themes/index.astro");

const NOW = new Date();
function theme(id: string, overrides: Partial<FeedbackThemeRecord> = {}): FeedbackThemeRecord {
  return {
    id, title: "Session links are hard to find", summary: "Fictional summary.", kind: "CONFUSING", status: "COLLECTING",
    change: null, issueUrl: null, prUrl: null, decisionNote: null, closedAt: null, createdAt: NOW, updatedAt: NOW,
    stats: { notes: 3, students: 3, recentStudents: 3, lastReportAt: NOW }, ...overrides,
  };
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.list.mockReset().mockResolvedValue([
    theme("theme-ready"),
    theme("theme-one", { title: "Dark mode", kind: "IDEA", status: "PROPOSED", stats: { notes: 1, students: 1, recentStudents: 1, lastReportAt: NOW } }),
  ]);
});

async function visit(query = "") {
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid/admin/feedback/themes${query}`),
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  return { status: response.status, location: response.headers.get("location"), body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;

describe("the feedback themes page on the style guide", () => {
  it("has one display title, the statuses as a PillNav, and a back link with a full target", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<h1 [^>]*>Themes<\/h1>/);
    const nav = /<nav aria-label="Filter by status" data-pill-nav[^>]*>([\s\S]*?)<\/nav>/.exec(body)?.[1] ?? "";
    expect(nav).toMatch(/href="\/admin\/feedback\/themes\?status=open" aria-current="page"[^>]*>Open<\/a>/);
    expect(count(nav, /aria-current="page"/g)).toBe(1);
    expect(body).toMatch(/<a href="\/admin\/feedback" class="[^"]*min-h-11[^"]*text-peach-ink/);
  });

  it("lists each theme on a kit Card, its title the link, with the status and readiness as Chips", async () => {
    const { body } = await visit();
    expect(count(body, /<li (?=[^>]*\bdata-card\b)/g)).toBe(2);
    expect(body).toMatch(/<h2 class="[^"]*font-body[^"]*"><a href="\/admin\/feedback\/themes\/theme-ready"/);
    expect(body).toMatch(/data-chip="neutral"[^>]*>[\s\S]*?Collecting/);
    expect(body).toMatch(/data-chip="peach"[^>]*>[\s\S]*?Ready to propose/);
    expect(body).toMatch(/data-chip="peach"[^>]*>[\s\S]*?Proposed/);
    expect(body).not.toMatch(/text-white|\bbg-dark\/80|border-teal|border-rule|\btext-primary\b|cyan-|indigo-|yellow-|green-|stone-/);
  });

  it("says the student count in one word, singular or plural", async () => {
    const { body } = await visit();
    expect(body).toMatch(/put forward\s+once 3 students raise them within 60 days/);
    expect(body).toContain("3 students (3 in");
    expect(body).toContain("1 student (1 in");
    expect(body).not.toMatch(/student\s+s\b/);
  });

  it("says what fills an empty view with an EmptyState", async () => {
    store.list.mockResolvedValue([]);
    expect((await visit()).body).toMatch(/data-empty-state[\s\S]*?<h2[^>]*>No themes in this view<\/h2>/);
    expect((await visit("?status=all")).body).toMatch(/data-empty-state[\s\S]*?<h2[^>]*>No themes yet<\/h2>/);
  });

  it("sends an unknown status back to the open themes with a 303", async () => {
    const { status, location } = await visit("?status=nonsense");
    expect(status).toBe(303);
    expect(location).toBe("/admin/feedback/themes");
  });
});
