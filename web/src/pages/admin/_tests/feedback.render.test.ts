import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeFeedbackContext } from "@/lib/feedback/model";
import type { FeedbackRecord } from "@/lib/feedback/store";

/* /admin/feedback on the style guide: the page's markup, with its reads mocked. */
const store = vi.hoisted(() => ({ list: vi.fn(), count: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/feedback/store", () => ({ listFeedback: store.list, countFeedbackByStatus: store.count }));

const { default: Page } = await import("../feedback/index.astro");

const AT = new Date(Date.UTC(2026, 10, 3, 9, 13));
function note(id: string, overrides: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    id, kind: "BUG", status: "NEW", message: "The session link opens a blank page.", pageUrl: "https://ttv.invalid/dashboard/cohort/sessions",
    pageTitle: null, context: sanitizeFeedbackContext({}), appVersion: null, response: null, adminNote: null, resolutionUrl: null,
    user: { id: "synthetic-wanjiku", name: "Wanjiku Mwangi", email: "wanjiku@example.test" }, handledBy: null, sensitive: false,
    theme: null, createdAt: AT, updatedAt: AT, resolvedAt: null, attachments: [], ...overrides,
  };
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.count.mockReset().mockResolvedValue({ NEW: 2, IN_PROGRESS: 1, RESOLVED: 4, DECLINED: 0 });
  store.list.mockReset().mockResolvedValue([
    note("note-new"),
    note("note-sensitive", {
      status: "IN_PROGRESS", kind: "OTHER", sensitive: true, message: "",
      theme: { id: "theme", title: "Session links are hard to find", status: "COLLECTING", issueUrl: null, students: 3 },
      attachments: [{ id: "shot", contentType: "image/png", size: 10, source: "CAPTURE", position: 0 }],
    }),
  ]);
});

async function visit(query = "") {
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid/admin/feedback${query}`),
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  return { status: response.status, location: response.headers.get("location"), body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;

describe("the feedback queue on the style guide", () => {
  it("has one display title, a way to Themes, and the statuses as a PillNav with their counts", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<a href="\/admin\/feedback\/themes" class="[^"]*min-h-11[^"]*text-peach-ink[^"]*">\s*Themes/);
    const nav = /<nav aria-label="Filter by status" data-pill-nav[^>]*>([\s\S]*?)<\/nav>/.exec(body)?.[1] ?? "";
    expect(nav).toMatch(/href="\/admin\/feedback\?status=open" aria-current="page"[^>]*>Open<span[^>]*><span aria-hidden="true">3<\/span><span class="sr-only"> 3 notes<\/span>/);
    expect(nav).toMatch(/>All<span[^>]*><span aria-hidden="true">7</);
    expect(nav).toMatch(/>Declined<\/a>/);
  });

  it("lists each note on a kit Card, the sender's name its link, with kit Chips and no palette colours", async () => {
    const { body } = await visit();
    expect(count(body, /<li (?=[^>]*\bdata-card\b)/g)).toBe(2);
    expect(body).toMatch(/<h2 class="[^"]*"><a href="\/admin\/feedback\/note-new"[^>]*>Wanjiku Mwangi<\/a><\/h2>/);
    expect(body).toMatch(/data-chip="peach"[^>]*>[\s\S]*?New/);
    expect(body).toMatch(/data-chip="warning"[^>]*>[\s\S]*?Sensitive/);
    expect(body).toMatch(/data-chip="neutral"[^>]*>[\s\S]*?Session links are hard to find/);
    expect(body).not.toMatch(/rose-|cyan-|indigo-|yellow-|green-|stone-|text-white|bg-dark\/80|border-teal|border-rule|\btext-primary\b/);
  });

  it("says a screenshot-only note and its image count in words", async () => {
    const { body } = await visit();
    expect(body).toContain("Screenshot only");
    expect(body).toContain("/dashboard/cohort/sessions · 1 image");
    expect(body).toContain("3 Nov, 09:13 UTC");
    expect(body).toMatch(/queue\s+through <code[^>]*>\/api\/admin\/feedback<\/code> with/);
  });

  it("says what fills an empty view", async () => {
    store.list.mockResolvedValue([]);
    expect((await visit()).body).toMatch(/data-empty-state[\s\S]*?<h2[^>]*>No feedback in this view<\/h2>/);
    expect((await visit("?status=all")).body).toMatch(/data-empty-state[\s\S]*?<h2[^>]*>No feedback yet<\/h2>/);
  });

  it("sends an unknown status back to the open notes with a 303", async () => {
    const { status, location } = await visit("?status=nonsense");
    expect([status, location]).toEqual([303, "/admin/feedback"]);
  });
});
