import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeFeedbackContext } from "@/lib/feedback/model";
import type { FeedbackRecord } from "@/lib/feedback/store";
import type { FeedbackThemeRecord } from "@/lib/feedback/theme-store";

/*
 * /admin/feedback/themes/[id] on the style guide: the page's markup and its form pattern, with the
 * stores mocked. Shipping a theme end to end, and students reading the message, is e2e/feedback-widget.spec.ts.
 */
const store = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), notes: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/feedback/theme-store", () => ({ getTheme: store.get, updateTheme: store.update }));
vi.mock("@/lib/feedback/store", () => ({ listFeedback: store.notes }));

const { default: Page } = await import("../feedback/themes/[id].astro");

const AT = new Date(Date.UTC(2026, 10, 3, 9, 13));
const THEME: FeedbackThemeRecord = {
  id: "theme", title: "Session links are hard to find", summary: "Fictional summary.", kind: "CONFUSING", status: "PROPOSED",
  change: "SIMPLIFY", issueUrl: null, prUrl: null, decisionNote: "Owner to decide.", closedAt: null, createdAt: AT, updatedAt: AT,
  stats: { notes: 1, students: 3, recentStudents: 3, lastReportAt: AT },
};
const NOTE: FeedbackRecord = {
  id: "note", kind: "CONFUSING", status: "NEW", message: "I could not find last week's session.",
  pageUrl: "https://ttv.invalid/dashboard/cohort/sessions", pageTitle: null, context: sanitizeFeedbackContext({}),
  appVersion: null, response: null, adminNote: null, resolutionUrl: null,
  user: { id: "synthetic-wanjiku", name: "Wanjiku Mwangi", email: "wanjiku@example.test" }, handledBy: null, sensitive: false,
  theme: null, createdAt: AT, updatedAt: AT, resolvedAt: null, attachments: [],
};

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.get.mockReset().mockResolvedValue(THEME);
  store.update.mockReset();
  store.notes.mockReset().mockResolvedValue([NOTE]);
});

const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
async function visit(form?: Record<string, string>) {
  const response = await container.renderToResponse(Page, {
    request: new Request("https://ttv.invalid/admin/feedback/themes/theme", form ? { method: "POST", body: new URLSearchParams(form), headers: FORM } : undefined),
    params: { id: "theme" },
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  return { status: response.status, location: response.headers.get("location"), body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;

describe("a feedback theme on the style guide", () => {
  it("has one display title, Maven h2 sections on kit Cards, and the status in the list's own tone", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<h1 [^>]*>Session links are hard to find<\/h1>/);
    for (const section of ["Where it stands", "Notes on this theme", "Update"]) {
      expect(body).toMatch(new RegExp(`<section (?=[^>]*data-card)[^>]*>(?:<[^>]+>)*<h2 id="[^"]+" class="[^"]*">${section}</h2>`));
    }
    expect(body).toMatch(/data-chip="peach"[^>]*>[\s\S]*?Proposed/);
    expect(body).toContain("3 (3 in the last 60 days)");
    expect(body).not.toMatch(/red-|green-|cyan-|indigo-|text-white|border-teal|border-rule|bg-dark\b|\btext-primary\b|rounded-md bg-primary/);
  });

  it("lists the theme's notes on hairlines, not cards in a card, each opening its note", async () => {
    const { body } = await visit();
    const list = /<ul class="divide-y divide-hairline" data-theme-notes>([\s\S]*?)<\/ul>/.exec(body)?.[1] ?? "";
    expect(list).toMatch(/<a href="\/admin\/feedback\/note"[^>]*after:absolute[^>]*>Wanjiku Mwangi<\/a>/);
    expect(list).toMatch(/data-chip="peach"[^>]*>[\s\S]*?New/);
    expect(list).not.toContain("data-card");
  });

  it("builds the form from the kit's fields, warns before shipping or declining, and has one primary action", async () => {
    const { body } = await visit();
    expect(body).toMatch(/<input[^>]*required=""[^>]*value="Session links are hard to find"[^>]*id="title"|<input[^>]*id="title"[^>]*value="Session links are hard to find"/);
    expect(body).toMatch(/<select[^>]*id="status"[\s\S]*?<option value="PROPOSED" selected="">/);
    expect(body).toMatch(/<select[^>]*id="change"[\s\S]*?<option value="SIMPLIFY" selected="">/);
    expect(body).toContain(">Owner to decide.</textarea>");
    expect(body).toMatch(/data-notice="warning"[\s\S]*?Shipping or declining replies to every open note[\s\S]*?<button type="submit" data-variant="primary"[^>]*>Save theme<\/button>/);
    expect(count(body, /data-variant="primary"/g)).toBe(1);
  });

  it("saves with a 303 back to the theme", async () => {
    store.update.mockResolvedValue(THEME);
    const saved = await visit({ title: "Session links are hard to find", summary: "", status: "PLANNED", kind: "CONFUSING", change: "", issueUrl: "", prUrl: "", studentMessage: "", decisionNote: "" });
    expect([saved.status, saved.location]).toEqual([303, "/admin/feedback/themes/theme?saved=1"]);
  });

  it("keeps everything typed when a save is refused, the message to students included, with focus on a danger Notice", async () => {
    // A public issue that isn't a web address is refused before anything is written.
    const form = {
      title: "Links to sessions", summary: "Edited summary.", status: "SHIPPED", kind: "BUG", change: "FIX",
      issueUrl: "not a link", prUrl: "", studentMessage: "This shipped. Thank you!", decisionNote: "Shipped in #999.",
    };
    const { status, body } = await visit(form);
    expect(status).toBe(400);
    expect(store.update).not.toHaveBeenCalled();
    expect(body).toMatch(/<div id="theme-failure" autofocus="" tabindex="-1" role="alert" data-notice="danger"/);
    expect(body).toMatch(/id="title"[^>]*value="Links to sessions"|value="Links to sessions"[^>]*id="title"/);
    expect(body).toContain(">Edited summary.</textarea>");
    expect(body).toMatch(/<option value="SHIPPED" selected="">/);
    expect(body).toMatch(/<option value="BUG" selected="">/);
    expect(body).toMatch(/<option value="FIX" selected="">/);
    expect(body).toMatch(/id="issueUrl"[^>]*value="not a link"|value="not a link"[^>]*id="issueUrl"/);
    expect(body).toContain(">This shipped. Thank you!</textarea>");
    expect(body).toContain(">Shipped in #999.</textarea>");
  });

  it("sends a theme that doesn't exist back to the themes with a 303", async () => {
    store.get.mockResolvedValue(null);
    const { status, location } = await visit();
    expect([status, location]).toEqual([303, "/admin/feedback/themes"]);
  });
});
