import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeFeedbackContext } from "@/lib/feedback/model";
import type { FeedbackRecord } from "@/lib/feedback/store";

/*
 * /admin/feedback/[id] on the style guide: the page's markup and its form pattern, with the store mocked.
 * Saving end to end, and the student reading the reply, is e2e/feedback-widget.spec.ts.
 */
const store = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), themes: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/feedback/store", () => ({ getFeedback: store.get, updateFeedback: store.update }));
vi.mock("@/lib/feedback/theme-store", () => ({ listThemes: store.themes }));

const { default: Page } = await import("../feedback/[id].astro");

const AT = new Date(Date.UTC(2026, 10, 3, 9, 13));
const NOTE: FeedbackRecord = {
  id: "note", kind: "CONFUSING", status: "NEW", message: "I could not find last week's session.",
  pageUrl: "https://ttv.invalid/dashboard/cohort/sessions", pageTitle: "Sessions", context: sanitizeFeedbackContext({}),
  appVersion: null, response: "Thanks, we're looking.", adminNote: null, resolutionUrl: null,
  user: { id: "synthetic-wanjiku", name: "Wanjiku Mwangi", email: "wanjiku@example.test" }, handledBy: null, sensitive: true,
  theme: null, createdAt: AT, updatedAt: AT, resolvedAt: null, attachments: [],
};

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.get.mockReset().mockResolvedValue(NOTE);
  store.update.mockReset();
  store.themes.mockReset().mockResolvedValue([{ id: "theme-open", title: "Session links are hard to find" }]);
});

const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
async function visit(form?: Record<string, string>) {
  const response = await container.renderToResponse(Page, {
    request: new Request("https://ttv.invalid/admin/feedback/note", form ? { method: "POST", body: new URLSearchParams(form), headers: FORM } : undefined),
    params: { id: "note" },
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  return { status: response.status, location: response.headers.get("location"), body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;

describe("a feedback note on the style guide", () => {
  it("has one display title, Maven h2 sections on kit Cards, and kit Chips", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<h1 [^>]*>Feedback from Wanjiku Mwangi<\/h1>/);
    for (const section of ["What they said", "Respond", "Context"]) {
      expect(body).toMatch(new RegExp(`<section (?=[^>]*data-card)[^>]*>(?:<[^>]+>)*<h2 id="[^"]+" class="[^"]*font-body[^"]*">${section}</h2>`));
    }
    expect(body).toMatch(/data-chip="peach"[^>]*>[\s\S]*?New/);
    expect(body).toMatch(/data-chip="warning"[^>]*>[\s\S]*?Sensitive/);
    expect(body).not.toMatch(/rose-|red-|green-|text-white|border-teal|border-rule|bg-dark\b|\btext-primary\b|rounded-md bg-primary/);
  });

  it("builds the form from the kit's fields, filled from the note, with one primary action", async () => {
    const { body } = await visit();
    expect(body).toMatch(/<label for="status"[^>]*>Status<\/label>/);
    expect(body).toMatch(/<select[^>]*id="status"[\s\S]*?<option value="NEW" selected="">/);
    expect(body).toMatch(/<select[^>]*id="themeId"[\s\S]*?<option value="" selected="">Not on a theme<\/option>/);
    expect(body).toMatch(/<input[^>]*id="sensitive"[^>]*checked=""/);
    expect(body).toMatch(/<label for="response"[^>]*>Reply to Wanjiku Mwangi<span[^>]*> \(optional\)<\/span><\/label><p id="response-hint"[^>]*>They see this on their feedback page\.<\/p>/);
    expect(body).toContain(">Thanks, we&#x27;re looking.</textarea>");
    expect(body).toMatch(/<input[^>]*id="resolutionUrl"[^>]*type="url"/);
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/<button type="submit" data-variant="primary"[^>]*>Save changes<\/button>/);
  });

  it("saves with a 303 back to the note, which says it was saved", async () => {
    store.update.mockResolvedValue({ outcome: "updated" });
    const saved = await visit({ status: "RESOLVED", themeId: "", response: "Fixed.", resolutionUrl: "", adminNote: "" });
    expect([saved.status, saved.location]).toEqual([303, "/admin/feedback/note?saved=1"]);
  });

  it("keeps everything typed when a save is refused, with focus on a danger Notice", async () => {
    // A link that isn't a web address is refused before anything is written.
    const form = { status: "IN_PROGRESS", themeId: "theme-open", response: "Working on it.", resolutionUrl: "not a link", adminNote: "Check the cohort page.", sensitive: "on" };
    const { status, body } = await visit(form);
    expect(status).toBe(400);
    expect(body).toMatch(/<div id="feedback-failure" autofocus="" tabindex="-1" role="alert" data-notice="danger"/);
    expect(body).toMatch(/This feedback wasn&#x27;t saved[\s\S]*?The link must be a full http\(s\) address\.\s*Everything you wrote is kept below\./);
    expect(store.update).not.toHaveBeenCalled();
    expect(body).toMatch(/<option value="IN_PROGRESS" selected="">/);
    expect(body).toMatch(/<option value="theme-open" selected="">/);
    expect(body).toContain(">Working on it.</textarea>");
    expect(body).toMatch(/id="resolutionUrl"[^>]*value="not a link"|value="not a link"[^>]*id="resolutionUrl"/);
    expect(body).toContain(">Check the cohort page.</textarea>");
  });

  it("sends a note that doesn't exist back to the queue with a 303", async () => {
    store.get.mockResolvedValue(null);
    const { status, location } = await visit();
    expect([status, location]).toEqual([303, "/admin/feedback"]);
  });
});
