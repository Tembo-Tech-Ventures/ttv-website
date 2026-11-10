import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * /admin/profiles on the style guide: the queue the content check left, the
 * list with its status filter, and the publishing actions, with the reads and
 * the write mocked. The SQL itself runs in round-trips.render.test.ts.
 */
const store = vi.hoisted(() => ({ read: vi.fn(), moderate: vi.fn(), work: vi.fn(), reviewWork: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: { prepare: () => ({ all: store.work }) } } }));
vi.mock("@/lib/members/moderation", () => ({ reviewWork: store.reviewWork, listWorkReviews: async () => (await store.work()).results }));
vi.mock("drizzle-orm/d1", () => ({ drizzle: () => ({}) }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/admin/profiles", async (actual) => ({
  ...(await actual<typeof import("@/lib/admin/profiles")>()),
  readProfilesPage: store.read,
  moderateProfile: store.moderate,
}));

const { default: Page } = await import("../profiles/index.astro");

const AT = new Date(Date.UTC(2026, 9, 6, 9));
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "profile-1", handle: "achieng-otieno", status: "PUBLISHED", updatedAt: AT, publishedAt: AT,
  user: { name: "Achieng Otieno", email: "achieng@example.test" }, ...overrides,
});
const held = (overrides: Record<string, unknown> = {}) => ({
  id: "profile-2", handle: "otieno-ouma", status: "DRAFT", updatedAt: AT, contentVersion: 4,
  moderationOutcome: "hold", moderationFlags: '["contains_contact_details"]', moderationScores: null,
  moderationCheckedAt: AT, moderationReviewRequired: true, user: { name: "Otieno Ouma" }, ...overrides,
});

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.work.mockReset().mockResolvedValue({results:[]});
  store.reviewWork.mockReset().mockResolvedValue(true);
  store.read.mockReset().mockResolvedValue({ rows: [row()], total: 1, review: { held: [held()], unavailable: [] } });
  store.moderate.mockReset().mockResolvedValue("done");
});

const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
async function visit(path = "/admin/profiles", form?: Record<string, string>) {
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid${path}`, form ? { method: "POST", body: new URLSearchParams(form), headers: FORM } : undefined),
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  return { status: response.status, location: response.headers.get("location"), body: await response.text() };
}

describe("the profiles list on the style guide", () => {
  it("returns a work decision to its profile without accepting an external redirect", async () => {
    const result = await visit("/admin/profiles", {
      form: "work", workId: "work-1", revision: "3", decision: "hide", returnProfileId: "profile-1",
    });
    expect(result).toMatchObject({ status: 303, location: "/admin/profiles/profile-1" });
    const hostile = await visit("/admin/profiles", {
      form: "work", workId: "work-1", revision: "3", decision: "keep", returnProfileId: "//other.test",
    });
    expect(hostile.location).toBe("/admin/profiles/%2F%2Fother.test");
  });

  it("renders hidden-work navigation only when a paging link exists", async () => {
    expect((await visit()).body).not.toContain('aria-label="Hidden work pages"');
    expect((await visit("/admin/profiles?hiddenPage=2")).body).toContain("Newer hidden work");
  });

  it("shows held work for human review and posts the revision that was seen", async () => {
    store.work.mockResolvedValue({results:[{id:"work-1",title:"Chama ledger",description:"Saved work",version:3,moderationOutcome:"hold"}]});
    const {body}=await visit();
    expect(body).toContain("Chama ledger");
    expect(body).toContain('name="revision" value="3"');
    expect((await visit("/admin/profiles",{form:"work",workId:"work-1",revision:"3",decision:"keep"})).status).toBe(303);
    expect(store.reviewWork).toHaveBeenCalledWith(expect.anything(),"synthetic-admin","work-1",3,"keep");
  });
  it("is one title, the content check's queue, then every profile in a kit table with words for statuses", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(body.match(/<h1\b/g)).toHaveLength(1);
    expect(body).toMatch(/<h2[^>]*>Held by the content check<\/h2>[\s\S]*?<h2[^>]*>Profiles awaiting a completed check<\/h2>[\s\S]*?<h2[^>]*>All profiles<\/h2>/);
    expect(body).toMatch(/<th[^>]*>Builder<\/th>[\s\S]*?<th[^>]*>Handle<\/th>[\s\S]*?<th[^>]*>Status<\/th>/);
    expect(body).toMatch(/<a href="\/admin\/profiles\/profile-1" class="[^"]*underline[^"]*">Achieng Otieno<\/a>/);
    expect(body).toMatch(/data-status="PUBLISHED">Published</);
    expect(body).toContain("No profiles are awaiting a check.");
    expect(body).not.toMatch(/text-white|\btext-primary\b|bg-(red|teal|green)-|uppercase|data-badge|>View</);
  });

  it("filters by status with links, the current one marked", async () => {
    const { body } = await visit("/admin/profiles?status=DRAFT");
    expect(store.read).toHaveBeenCalledWith(expect.anything(), { status: "DRAFT", page: 1 });
    expect(body).toMatch(/<nav aria-label="Profile status"[\s\S]*?<a href="\/admin\/profiles\?status=DRAFT"[^>]*aria-current="page"[^>]*>[\s\S]*?Not on public website/);
    await visit("/admin/profiles?status=nonsense");
    expect(store.read).toHaveBeenLastCalledWith(expect.anything(), { status: null, page: 1 });
  });

  it("offers only the actions that change a held profile, quietly, named by the builder, posting to the page", async () => {
    const { body } = await visit("/admin/profiles?status=DRAFT");
    const actions = [...body.matchAll(/name="_action" value="([a-z_]+)"/g)].map((match) => match[1]);
    // Listing is the member's own choice: a held draft is paused or cleared, never published by an admin.
    expect(actions).toEqual(["unpublish", "clear_flag"]);
    expect(body).toMatch(/data-variant="quiet"[^>]*>Clear flag<span class="sr-only"> Otieno Ouma<\/span><\/button>/);
    expect(body).not.toMatch(/data-variant="primary"/);
    expect(body).toMatch(/<form method="POST" action="\/admin\/profiles\?status=DRAFT">/);
    expect(body).not.toMatch(/action="[^"]*#/);
    expect(body).toMatch(/Remove phone numbers, email addresses/);

    store.read.mockResolvedValue({ rows: [], total: 0, review: { held: [], unavailable: [held({ status: "PUBLISHED", moderationOutcome: "error", moderationFlags: null })] } });
    const published = await visit();
    expect([...published.body.matchAll(/name="_action" value="([a-z_]+)"/g)].map((match) => match[1])).toEqual(["unpublish", "clear_flag"]);
    expect(published.body).toContain("The check was unavailable. This profile remains listed and needs review.");
  });

  it("answers a change with a 303 back to the same view and a flash", async () => {
    const { status, location } = await visit("/admin/profiles?status=DRAFT", { profileId: "profile-2", _action: "publish", contentVersion: "4" });
    expect(status).toBe(303);
    expect(location).toBe("/admin/profiles?status=DRAFT");
    expect(store.moderate).toHaveBeenCalledWith(expect.anything(), { profileId: "profile-2", action: "publish", expectedVersion: 4 });
  });

  it("refuses a malformed request with 400, a changed profile with 409 and a database failure with 503, the page shown each time", async () => {
    const bad = await visit("/admin/profiles", { profileId: "profile-2", _action: "delete", contentVersion: "4" });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatch(/role="alert"[\s\S]*?Choose one of the publishing actions on this page\./);
    expect(store.moderate).not.toHaveBeenCalled();

    store.moderate.mockResolvedValue("changed");
    const changed = await visit("/admin/profiles", { profileId: "profile-2", _action: "publish", contentVersion: "3" });
    expect(changed.status).toBe(409);
    expect(changed.body).toContain("The builder changed this profile while you were looking at it.");

    store.moderate.mockRejectedValue(new Error("D1 down"));
    const down = await visit("/admin/profiles", { profileId: "profile-2", _action: "publish", contentVersion: "4" });
    expect(down.status).toBe(503);
    expect(down.body).toContain("The database didn&#39;t answer, so nothing changed. Try again in a moment.");
  });

  it("says a page past the end, and an empty filter, plainly, with a way back", async () => {
    store.read.mockResolvedValue({ rows: [], total: 3, review: { held: [], unavailable: [] } });
    const past = await visit("/admin/profiles?page=9");
    expect(past.body).toContain("No profiles on this page");
    expect(past.body).toMatch(/href="\/admin\/profiles"[^>]*>Back to the first page/);

    store.read.mockResolvedValue({ rows: [], total: 0, review: { held: [], unavailable: [] } });
    const none = await visit("/admin/profiles?status=SUSPENDED");
    expect(none.body).toContain("No suspended profiles");
    expect(none.body).toContain("Nothing is held by the content check.");
  });
});
