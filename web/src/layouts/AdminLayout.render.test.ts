import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NO_ADMIN_FACTS } from "@/components/admin/admin-nav";

vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("@/components/admin/admin-nav-server", () => ({
  loadAdminNavFacts: async () => ({ ...NO_ADMIN_FACTS, pendingCases: null, pendingRequestNotes: 0 }),
}));

const { default: AdminLayout } = await import("./AdminLayout.astro");
const { default: PageTitle } = await import("@/components/platform/spaces/PageTitle.astro");

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

const admin = { user: { id: "synthetic-admin", name: "Amina Hassan" }, isAdmin: true } as unknown as App.Locals;
const request = () => new Request("https://ttv.invalid/admin/users");
/** React islands number themselves per render; nothing else in the markup may differ. */
const stable = (html: string) => html.replace(/\buid="[^"]*"/g, 'uid=""');

describe("AdminLayout without a spaces context (T14)", () => {
  it("draws the existing admin shell byte for byte as a page that never passed one", async () => {
    const page = { request: request(), locals: admin, slots: { default: "<p>Users table</p>" } };
    const before = await container.renderToString(AdminLayout, { ...page, props: { title: "Users" } });
    const after = await container.renderToString(AdminLayout, { ...page, props: { title: "Users", spaces: null } });
    expect(stable(after)).toBe(stable(before));
    expect(after).toMatch(/<title>Users \| TTV Admin\b[^<]*<\/title>/);
    expect(after).toContain('component-url="@/components/shells/AdminShell"');
    expect(after).toContain("Back to dashboard");
    expect(after).toContain("<p>Users table</p>");
    expect(after).not.toContain("spaces-shell");
    expect(after).not.toContain("data-admin-space");
  });

  it("says a rejected submit in the tab title when the page passes titlePrefix", async () => {
    const page = { request: request(), locals: admin, slots: { default: "<p>Users table</p>" } };
    const html = await container.renderToString(AdminLayout, { ...page, props: { title: "Users", titlePrefix: "Error: " } });
    expect(html).toMatch(/<title>Error: Users \| TTV Admin\b[^<]*<\/title>/);
  });

  it("still sends a non-admin away before drawing anything", async () => {
    const locals = { user: { id: "synthetic-member" }, isAdmin: false } as unknown as App.Locals;
    const response = await container.renderToResponse(AdminLayout, { request: request(), locals, props: { title: "Users", spaces: null } });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/dashboard");
  });
});

describe("PageTitle outside the spaces shell", () => {
  it("is exactly the h2 the admin page always drew", async () => {
    const html = await container.renderToString(PageTitle, {
      props: { spaces: false, legacyClass: "text-2xl font-bold text-white" }, slots: { default: "Users" },
    });
    expect(html).toBe('<h2 class="text-2xl font-bold text-white">Users</h2>');
  });

  it("draws nothing where the page had no title (legacyTag null)", async () => {
    const html = await container.renderToString(PageTitle, { props: { spaces: false, legacyTag: null }, slots: { default: "Cohort 05" } });
    expect(html.trim()).toBe("");
  });

  it("is the screen's one h1 in the spaces shell, the kit's PageTitle", async () => {
    const html = await container.renderToString(PageTitle, { props: { spaces: true, legacyTag: null }, slots: { default: "Cohort 05" } });
    expect(html).toMatch(/^<h1 data-page-title="true" class="[^"]*tracking-heading[^"]*">Cohort 05<\/h1>$/);
  });
});
