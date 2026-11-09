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

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

const admin = { user: { id: "synthetic-admin", name: "Amina Hassan" }, isAdmin: true } as unknown as App.Locals;
const request = () => new Request("https://ttv.invalid/admin/users");
/** React islands number themselves per render; nothing else in the markup may differ. */
const stable = (html: string) => html.replace(/\buid="[^"]*"/g, 'uid=""');

describe("AdminLayout without a spaces context (T14, decision D2)", () => {
  it("draws the plain frame with the admin navigation, the same as a page that never passed one", async () => {
    const page = { request: request(), locals: admin, slots: { default: "<p>Users table</p>" } };
    const before = await container.renderToString(AdminLayout, { ...page, props: { title: "Users" } });
    const after = await container.renderToString(AdminLayout, { ...page, props: { title: "Users", spaces: null } });
    expect(stable(after)).toBe(stable(before));
    expect(after).toMatch(/<title>Users\b[^<]*<\/title>/);
    expect(after).toContain("data-plain-frame");
    expect(after).not.toContain("spaces-shell");
    expect(after).not.toContain("component-url=");
    // The admin navigation, built without per-user context, with the page's section current.
    const sidebar = /<aside id="space-sidebar"[^>]*>([\s\S]*?)<\/aside>/.exec(after)?.[1] ?? "";
    expect(sidebar).toMatch(/<a[^>]*href="\/admin\/users"[^>]*aria-current="page"/);
    expect(sidebar).toContain('href="/admin/access-requests"');
    expect(sidebar).not.toContain("Back to dashboard");
    // The page's own markup sits in the frame's main, inside the admin wrapper the badge script reads.
    expect(after).toMatch(/<main id="spaces-main"[\s\S]*data-admin-space[\s\S]*<p>Users table<\/p>/);
  });

  it("says a rejected submit in the tab title when the page passes titlePrefix", async () => {
    const page = { request: request(), locals: admin, slots: { default: "<p>Users table</p>" } };
    const html = await container.renderToString(AdminLayout, { ...page, props: { title: "Users", titlePrefix: "Error: " } });
    expect(html).toMatch(/<title>Error: Users\b[^<]*<\/title>/);
  });

  it("still sends a non-admin away before drawing anything", async () => {
    const locals = { user: { id: "synthetic-member" }, isAdmin: false } as unknown as App.Locals;
    const response = await container.renderToResponse(AdminLayout, { request: request(), locals, props: { title: "Users", spaces: null } });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/dashboard");
  });
});
