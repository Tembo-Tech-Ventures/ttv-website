import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * /admin/curricula/[id] on the style guide: the page's markup, its flash and its confirm step, with
 * the store mocked. Editing and deleting a curriculum end to end is e2e/admin-curricula.spec.ts.
 */
const store = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/admin/curricula", async (actual) => ({
  ...(await actual<typeof import("@/lib/admin/curricula")>()),
  createDrizzleCurriculumStore: () => ({}),
  getCurriculum: store.get,
  updateCurriculum: store.update,
  deleteCurriculum: store.remove,
}));

const { default: Page } = await import("../curricula/[id].astro");

const PATH = "/admin/curricula/web";
const UNUSED = { id: "web", title: "Web foundations", description: "HTML, CSS and a first app.", programs: [] };
const IN_USE = { ...UNUSED, programs: [{ id: "cohort-07", name: "Cohort 07" }] };

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.get.mockReset().mockResolvedValue(UNUSED);
  store.update.mockReset().mockResolvedValue({ ok: true, curriculum: { id: "web" } });
  store.remove.mockReset().mockResolvedValue({ ok: true });
});

/** The Set-Cookie lines of a response, read the way the adapter writes them. */
const setCookies = (response: Response): string[] => {
  const cookies = Reflect.get(response, Symbol.for("astro.cookies")) as { consume(): Iterable<string> } | undefined;
  return [...response.headers.getSetCookie(), ...(cookies ? cookies.consume() : [])];
};
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
async function visit({ query = "", form, cookie }: { query?: string; form?: Record<string, string>; cookie?: string } = {}) {
  const headers: Record<string, string> = { ...(form && FORM), ...(cookie && { cookie }) };
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid${PATH}${query}`, form ? { method: "POST", body: new URLSearchParams(form), headers } : { headers }),
    params: { id: "web" },
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  return { response, status: response.status, location: response.headers.get("location"), body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;
const FLASH = `ttv-flash=${encodeURIComponent(JSON.stringify({ tone: "success", title: "Curriculum saved", path: PATH }))}`;

describe("a curriculum on the style guide", () => {
  it("names the curriculum in the one display title, under a back link, with kit fields and one primary action", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<a href="\/admin\/curricula" data-back-link[^>]*>[\s\S]*?<span>Curricula<\/span><\/a>[\s\S]*?data-page-header[\s\S]*?<h1 [^>]*>Web foundations<\/h1>/);
    expect(body).toMatch(/<input required="" id="title" name="title" type="text" class="[^"]*" value="Web foundations"\/>/);
    expect(body).toMatch(/<textarea required="" id="description" name="description" rows="7" class="[^"]*">HTML, CSS and a first app\.<\/textarea>/);
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/<button [^>]*data-variant="primary"[^>]*>Save changes<\/button>/);
    // Every form posts to the page's own path: no query string rides along into a POST.
    expect(body).toMatch(/<form method="POST" action="\/admin\/curricula\/web" class="grid gap-5">/);
    expect(count(body, /<h2 class="text-lg text-ink-primary">/g)).toBe(2);
    expect(body).toContain("No programs or cohorts use this curriculum yet.");
    expect(body).not.toMatch(/form-control|text-white|emerald-|red-\d|\btext-primary\b|uppercase|confirm\(|Title Case|Save Changes|Delete Curriculum|cascade/);
  });

  it("starts a delete with a quiet link to its confirm step, not the browser's confirm()", async () => {
    const { body } = await visit();
    expect(body).toMatch(/<a href="\/admin\/curricula\/web\?confirm=delete" data-variant="danger"[^>]*>Delete curriculum<\/a>/);
    expect(body).not.toContain("data-confirm-step");
    expect(body).toContain("deleting it does not affect any cohort");
  });

  it("asks at ?confirm=delete: a focused warning naming it, a danger button posting the delete, and Cancel back", async () => {
    const { body } = await visit({ query: "?confirm=delete" });
    const step = /<div data-confirm-step[\s\S]*?<\/form><\/div>/.exec(body)?.[0] ?? "";
    expect(step).toMatch(/<div autofocus="" tabindex="-1" role="region" aria-label="Delete Web foundations\?" data-notice="warning"/);
    expect(step).toContain("This can't be undone. No program or cohort uses it, so none is affected.");
    expect(step).toMatch(/<form method="post" action="\/admin\/curricula\/web"[^>]*><input type="hidden" name="action" value="delete"\/>/);
    expect(step).toMatch(/<button [^>]*data-variant="danger"[^>]*>Delete curriculum<\/button>/);
    expect(step).toMatch(/<a href="\/admin\/curricula\/web" data-variant="ghost"[^>]*>Cancel<\/a>/);
    expect(count(body, /href="\/admin\/curricula\/web\?confirm=delete"/g)).toBe(0);
  });

  it("offers no delete while a cohort uses it, even at ?confirm=delete, and links each cohort", async () => {
    store.get.mockResolvedValue(IN_USE);
    const { body } = await visit({ query: "?confirm=delete" });
    expect(body).not.toContain("data-confirm-step");
    expect(body).not.toMatch(/data-variant="danger"/);
    expect(body).toContain("This curriculum cannot be deleted while a program or cohort references it.");
    // A link reads as one by its underline, in ink: peach is the page's one primary action.
    expect(body).toMatch(/<a href="\/admin\/programs\/cohort-07" class="[^"]*text-ink-primary underline[^"]*min-h-11[^"]*">Cohort 07<\/a>/);
    expect(body).not.toContain("text-peach-ink");
  });

  it("answers a save with a 303 to the page and a flash, never ?notice", async () => {
    const { status, location, response } = await visit({ form: { action: "save", title: " Web basics ", description: "New." } });
    expect(status).toBe(303);
    expect(location).toBe(PATH);
    expect(store.update).toHaveBeenCalledWith({}, "web", { title: " Web basics ", description: "New." });
    const [line] = setCookies(response);
    expect(line).toMatch(/^ttv-flash=/);
    expect(line).toContain(`Path=${PATH}`);
  });

  it("says the flash once on the next GET, in a success Notice", async () => {
    const { body, response } = await visit({ cookie: FLASH });
    expect(body).toMatch(/role="status" data-notice="success"[\s\S]*?Curriculum saved/);
    expect(setCookies(response)[0]).toMatch(/^ttv-flash=deleted;/);
    expect((await visit({ query: "?notice=saved" })).body).not.toContain('data-notice="success"');
  });

  it("keeps a rejected save's values and says so in a focused danger Notice, with no stale success beside it", async () => {
    store.update.mockResolvedValue({
      ok: false, reason: "validation", errors: { title: "Enter a curriculum title." }, values: { title: "   ", description: "Kept." },
    });
    const { status, body } = await visit({ query: "?notice=saved", form: { action: "save", title: "   ", description: "Kept." }, cookie: FLASH });
    expect(status).toBe(400);
    expect(body).toMatch(/data-title-prefix="Error: "/);
    expect(body).toMatch(/<div (?=[^>]*autofocus="")(?=[^>]*role="alert")[^>]*data-notice="danger"[\s\S]*?The curriculum wasn&#x27;t saved/);
    expect(body).not.toMatch(/data-notice="success"|Curriculum saved/);
    expect(body).toMatch(/<input required="" aria-describedby="title-error" aria-invalid="true" id="title" name="title" type="text" class="[^"]*" value=" {3}"\/>/);
    expect(body).toContain('id="title-error"');
    expect(body).toContain(">Kept.</textarea>");
  });

  it("says a failed delete in the delete card, and a deletion back on the list with a 303", async () => {
    store.remove.mockResolvedValue({ ok: false, reason: "in-use", message: "This curriculum is used by one or more programs and cannot be deleted." });
    const refused = await visit({ form: { action: "delete" } });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatch(/<div (?=[^>]*autofocus="")(?=[^>]*role="alert")[^>]*data-notice="danger"[\s\S]*?The curriculum wasn&#x27;t deleted[\s\S]*?cannot be deleted\./);
    expect(refused.body).toContain("This curriculum cannot be deleted while a program or cohort references it.");
    expect(refused.body).not.toMatch(/confirm=delete/);
    // The cohort that took it came after this page's read: say so rather than list nothing.
    expect(refused.body).toContain("A program or cohort started using it just now.");
    expect(refused.body).not.toMatch(/<ul>\s*<\/ul>/);
    store.remove.mockRejectedValue(new Error("D1 down"));
    const failed = await visit({ form: { action: "delete" } });
    expect(failed.status).toBe(503);
    expect(failed.body).toContain("The database didn&#39;t answer. Try again in a moment.");
    store.remove.mockResolvedValue({ ok: true });
    const deleted = await visit({ form: { action: "delete" } });
    expect(deleted.status).toBe(303);
    expect(deleted.location).toBe("/admin/curricula?notice=deleted");
  });

  it("sends a missing curriculum back to the list", async () => {
    store.get.mockResolvedValue(null);
    const { status, location } = await visit();
    expect(status).toBe(303);
    expect(location).toBe("/admin/curricula?notice=missing");
  });
});
