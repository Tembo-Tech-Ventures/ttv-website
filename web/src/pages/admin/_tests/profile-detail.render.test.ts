import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * /admin/profiles/[id] on the style guide: the page's markup and its moderation forms, with the
 * database and the moderation writes mocked. Suspending and restoring a post end to end is
 * e2e/admin-review.spec.ts.
 */
const store = vi.hoisted(() => ({ find: vi.fn(), leads: vi.fn(), cohorts: vi.fn(), post: vi.fn(), profile: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("drizzle-orm/d1", () => ({
  drizzle: () => ({
    query: { studentProfile: { findFirst: store.find } },
    select: () => ({ from: () => ({ where: store.leads }) }),
  }),
}));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/talent/eligibility", () => ({ getCompletedCohorts: store.cohorts }));
vi.mock("@/lib/blog/moderation", async (actual) => ({
  ...(await actual<typeof import("@/lib/blog/moderation")>()),
  moderatePost: store.post,
}));
vi.mock("@/lib/talent/profile-moderation", async (actual) => ({
  ...(await actual<typeof import("@/lib/talent/profile-moderation")>()),
  applyAdminProfileAction: store.profile,
}));

const { default: Page } = await import("../profiles/[id].astro");

const PATH = "/admin/profiles/profile-1";
const AT = new Date(Date.UTC(2026, 9, 6, 9));
function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-1", userId: "achieng", handle: "achieng-otieno", status: "PUBLISHED", publicName: "Achieng Otieno",
    headline: "Backend builder", bio: "I build ledger tools.", location: "Kisumu", country: "KE", skills: '["TypeScript","SQL"]',
    openToFreelance: true, openToRoles: false, portfolioUrl: "https://example.test/achieng", linkedinUrl: null,
    githubLogin: "achieng", contentVersion: 3, moderationOutcome: null, moderationFlags: null, moderationCheckedAt: null,
    moderationReviewRequired: false, publishedAt: AT, createdAt: AT, updatedAt: AT,
    user: { id: "achieng", name: "Achieng Otieno", email: "achieng@example.test" },
    work: [{ id: "h1", repoFullName: "achieng/ledger", repoUrl: "https://github.com/achieng/ledger", stars: 3, language: "TypeScript", description: "A ledger.", blurb: "My best work.", sortOrder: 0 }],
    posts: [
      { id: "post-1", title: "Notes on ledgers", slug: "ledgers", status: "PUBLISHED", adminNote: null, updatedAt: AT },
      { id: "post-2", title: "A draft", slug: "draft", status: "DRAFT", adminNote: null, updatedAt: AT },
    ],
    ...overrides,
  };
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.find.mockReset().mockResolvedValue(profile());
  store.leads.mockReset().mockResolvedValue([{ value: 2 }]);
  store.cohorts.mockReset().mockResolvedValue([{ application: { completedAt: new Date(Date.UTC(2026, 5, 30)) }, program: { name: "Cohort 04" } }]);
  store.post.mockReset().mockResolvedValue({ success: true });
  store.profile.mockReset().mockResolvedValue(true);
});

const setCookies = (response: Response): string[] => {
  const cookies = Reflect.get(response, Symbol.for("astro.cookies")) as { consume(): Iterable<string> } | undefined;
  return [...response.headers.getSetCookie(), ...(cookies ? cookies.consume() : [])];
};
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
async function visit(form?: Record<string, string>) {
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid${PATH}`, form ? { method: "POST", body: new URLSearchParams(form), headers: FORM } : undefined),
    params: { id: "profile-1" },
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  return { response, status: response.status, location: response.headers.get("location"), body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;

describe("a builder profile on the style guide", () => {
  it("names the builder in the one display title, with the status in its shared name and the public page linked", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<a href="\/admin\/profiles" data-back-link[^>]*>[\s\S]*?<span>Profiles<\/span><\/a>[\s\S]*?<h1 [^>]*>Achieng Otieno<\/h1>/);
    expect(body).toMatch(/data-chip="success"[^>]*><span[^>]*><span data-status="PUBLISHED">Published<\/span>/);
    expect(body).toMatch(/<a href="\/talent\/achieng-otieno" class="[^"]*underline[^"]*min-h-11[^"]*">\/talent\/achieng-otieno<\/a>/);
    expect(body).not.toMatch(/text-white|\btext-primary\b|bg-(green|red|teal)-|uppercase|tracking-wider|📍|data-badge|Completed Cohorts|Highlighted Projects|Profile Detail/);
  });

  it("puts the facts in description lists, skills in chips and links with their underline", async () => {
    const { body } = await visit();
    expect(body).toMatch(/<h2[^>]*>Owner<\/h2><dl data-description-list/);
    expect(body).toMatch(/<dt[^>]*>Leads<\/dt><dd[^>]*>2<\/dd>/);
    expect(body).toMatch(/<h2[^>]*>Completed cohorts<\/h2><dl data-description-list[\s\S]*?<dt[^>]*>Cohort 04<\/dt><dd[^>]*>Completed 30 Jun 2026<\/dd>/);
    expect(body).toMatch(/<ul class="flex flex-wrap gap-2" aria-label="Skills"><li><span data-chip="neutral"[^>]*>(?:<span[^>]*>)?TypeScript/);
    expect(body).toContain("Kisumu, KE");
    expect(body).toContain("Open to freelance work");
    expect(body).toMatch(/<a href="https:\/\/example.test\/achieng" class="[^"]*underline[^"]*min-h-11[^"]*" target="_blank" rel="noopener noreferrer">Portfolio<span class="sr-only"> \(opens in a new tab\)<\/span><\/a>/);
    // Highlights and posts are hairline lists, not cards inside a card.
    expect(body).toMatch(/<ul class="divide-y divide-hairline" data-highlights>[\s\S]*?achieng\/ledger[\s\S]*?3 stars · TypeScript/);
    expect(body).not.toMatch(/<ul class="divide-y divide-hairline" data-(highlights|posts)>(?:(?!<\/ul>)[\s\S])*data-card/);
  });

  it("offers post and profile moderation as quiet actions, with Publish the one primary when it is offered", async () => {
    const live = await visit();
    expect(live.body).toMatch(/<section aria-label="Notes on ledgers"[\s\S]*?<label for="admin-note-post-1"[^>]*>Admin note<span[^>]*> \(optional\)<\/span><\/label><input maxLength="1000" id="admin-note-post-1" name="adminNote" type="text"[^>]*value=""\/>[\s\S]*?data-variant="quiet"[^>]*>Suspend post<\/button>/);
    expect(live.body).not.toMatch(/<section aria-label="A draft"[\s\S]*?Suspend post/);
    expect(count(live.body, /data-variant="primary"/g)).toBe(0);
    expect(live.body).toMatch(/name="profileAction" value="unpublish">[\s\S]*?<button [^>]*data-variant="quiet"[^>]*>Unpublish<\/button>/);

    store.find.mockResolvedValue(profile({ status: "SUSPENDED", moderationReviewRequired: true, moderationOutcome: "hold", moderationFlags: '["contains_contact_details"]' }));
    const held = await visit();
    expect(count(held.body, /data-variant="primary"/g)).toBe(1);
    expect(held.body).toMatch(/data-variant="primary"[^>]*>Republish<\/button>/);
    expect(held.body).toMatch(/data-variant="quiet"[^>]*>Clear flag<\/button>/);
    expect(held.body).toMatch(/<h2[^>]*>Content check<\/h2>[\s\S]*?<dt[^>]*>Outcome<\/dt><dd[^>]*>Held<\/dd>[\s\S]*?Remove phone numbers, email addresses, or ID numbers/);
  });

  it("answers a post action with a 303 back to the posts and a flash", async () => {
    const { status, location, response } = await visit({ _action: "moderate-post", postId: "post-1", postAction: "suspend", adminNote: " Checked " });
    expect(status).toBe(303);
    expect(location).toBe(`${PATH}#posts`);
    expect(store.post).toHaveBeenCalledWith(expect.anything(), { profileId: "profile-1", postId: "post-1", action: "suspend", adminNote: "Checked" });
    expect(decodeURIComponent(setCookies(response)[0])).toContain('"title":"Post suspended"');
  });

  it("keeps the note typed for a refused post action, under a focused danger Notice", async () => {
    store.post.mockResolvedValue({ success: false, error: "The post could not be suspended from its current state." });
    const { status, body } = await visit({ _action: "moderate-post", postId: "post-1", postAction: "suspend", adminNote: "Typed note" });
    expect(status).toBe(409);
    expect(body).toMatch(/data-title-prefix="Error: "/);
    expect(body).toMatch(/<div (?=[^>]*autofocus="")(?=[^>]*role="alert")[^>]*data-notice="danger"[\s\S]*?Nothing changed[\s\S]*?could not be suspended from its current state\. Its status below is the current one\./);
    expect(body).toMatch(/id="admin-note-post-1"[^>]*value="Typed note"/);
  });

  it("answers a profile action with a 303 and a flash, and a stale one in words", async () => {
    const done = await visit({ _action: "moderate-profile", profileAction: "unpublish", contentVersion: "3" });
    expect(done.status).toBe(303);
    expect(done.location).toBe(PATH);
    expect(decodeURIComponent(setCookies(done.response)[0])).toContain('"title":"Profile unpublished"');

    store.profile.mockResolvedValue(false);
    const stale = await visit({ _action: "moderate-profile", profileAction: "unpublish", contentVersion: "2" });
    expect(stale.status).toBe(409);
    expect(stale.body).toContain("The builder changed this profile while you were looking at it.");
  });

  it("says plainly when there is nothing to list", async () => {
    store.find.mockResolvedValue(profile({ work: [], posts: [] }));
    store.cohorts.mockResolvedValue([]);
    const { body } = await visit();
    expect(body).toContain("None yet. A cohort shows here once its application is marked completed.");
    expect(body).toContain("None yet. The builder's posts show here as they write them.");
    expect(body).not.toContain("data-highlights");
  });
});
