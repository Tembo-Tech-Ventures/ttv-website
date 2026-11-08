import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * /admin/curricula/new on the style guide: the page's markup and its form pattern, with the store
 * mocked. Creating a curriculum end to end is e2e/admin-curricula.spec.ts.
 */
const store = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/admin/curricula", async (actual) => ({
  ...(await actual<typeof import("@/lib/admin/curricula")>()),
  createDrizzleCurriculumStore: () => ({}),
  createCurriculum: store.create,
}));

const { default: Page } = await import("../curricula/new.astro");

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.create.mockReset().mockResolvedValue({ ok: true, curriculum: { id: "web" } });
});

/** The Set-Cookie lines of a response, read the way the adapter writes them. */
const setCookies = (response: Response): string[] => {
  const cookies = Reflect.get(response, Symbol.for("astro.cookies")) as { consume(): Iterable<string> } | undefined;
  return [...response.headers.getSetCookie(), ...(cookies ? cookies.consume() : [])];
};
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
async function visit(form?: Record<string, string>) {
  const response = await container.renderToResponse(Page, {
    request: new Request("https://ttv.invalid/admin/curricula/new", form ? { method: "POST", body: new URLSearchParams(form), headers: FORM } : undefined),
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  return { response, status: response.status, location: response.headers.get("location"), body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;

describe("a new curriculum on the style guide", () => {
  it("has one display title under a back link, kit fields with no stars, and one primary action beside a quiet Cancel", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/data-title="New curriculum"/);
    expect(body).toMatch(/<a href="\/admin\/curricula" data-back-link[^>]*>[\s\S]*?<span>Curricula<\/span><\/a>[\s\S]*?data-page-header[\s\S]*?<h1 [^>]*>New curriculum<\/h1>/);
    expect(body).toMatch(/<label for="title" class="[^"]*">Title<\/label><input required="" id="title" name="title" type="text" class="[^"]*" value=""\/>/);
    expect(body).toMatch(/<label for="description" class="[^"]*">Description<\/label><p id="description-hint"[^>]*>Its learning goals and scope\.<\/p><textarea required="" aria-describedby="description-hint" id="description" name="description" rows="7"/);
    expect(body).toMatch(/<form method="POST" action="\/admin\/curricula\/new" class="grid gap-5">/);
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/<button [^>]*data-variant="primary"[^>]*>Create curriculum<\/button><a href="\/admin\/curricula" data-variant="ghost"[^>]*>Cancel<\/a>/);
    expect(body).not.toContain("data-notice");
    expect(body).not.toMatch(/form-control|text-white|red-\d|\btext-primary\b|placeholder=| \*<|Create Curriculum|New Curriculum/);
  });

  it("answers a created curriculum with a 303 to it and a flash scoped to that page", async () => {
    const { status, location, response } = await visit({ title: "Web foundations", description: "HTML and CSS." });
    expect(status).toBe(303);
    expect(location).toBe("/admin/curricula/web");
    expect(store.create).toHaveBeenCalledWith({}, { title: "Web foundations", description: "HTML and CSS." });
    const [line] = setCookies(response);
    expect(line).toMatch(/^ttv-flash=/);
    expect(line).toContain("Path=/admin/curricula/web");
    expect(decodeURIComponent(line)).toContain('"title":"Curriculum created"');
  });

  it("keeps a rejected form's values under a focused danger Notice, with each field's error", async () => {
    store.create.mockResolvedValue({
      ok: false, reason: "validation", values: { title: "   ", description: "Kept." },
      errors: { title: "Enter a curriculum title." },
    });
    const { status, body } = await visit({ title: "   ", description: "Kept." });
    expect(status).toBe(200);
    expect(body).toMatch(/data-title-prefix="Error: "/);
    expect(body).toMatch(/<div (?=[^>]*autofocus="")(?=[^>]*role="alert")[^>]*data-notice="danger"[\s\S]*?The curriculum wasn&#x27;t created[\s\S]*?Fix the fields marked below\. Everything you wrote is kept\./);
    expect(body).toMatch(/<input required="" aria-describedby="title-error" aria-invalid="true" id="title" name="title" type="text" class="[^"]*" value=" {3}"\/>/);
    expect(body).toContain(">Enter a curriculum title.</p>");
    expect(body).toContain(">Kept.</textarea>");
  });

  it("says a failed save in the same Notice and keeps what was typed", async () => {
    store.create.mockRejectedValue(new Error("D1 down"));
    const { body } = await visit({ title: "Web foundations", description: "HTML and CSS." });
    expect(count(body, /data-notice="danger"/g)).toBe(1);
    expect(body).toContain("The database didn&#39;t answer. Try again in a moment; everything you wrote is kept.");
    expect(body).toMatch(/value="Web foundations"/);
    expect(body).toContain(">HTML and CSS.</textarea>");
  });
});
