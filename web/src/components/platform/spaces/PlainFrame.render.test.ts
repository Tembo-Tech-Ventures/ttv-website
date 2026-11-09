import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, describe, expect, it } from "vitest";

/*
 * PlainFrame: the frame for a signed-in page with no spaces context (decision D2), which replaced the
 * old DashboardLayout and AdminShell. It needs no `Me`: the TEMBO mark home, a skip link, the page on a
 * platform sheet in its space's tone, and a sidebar only when the page passes one.
 */
const { default: PlainFrame } = await import("./PlainFrame.astro");

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

const locals = { user: { id: "synthetic-member" }, session: { id: "synthetic-session" } } as unknown as App.Locals;
const render = (props: Record<string, unknown>, slots: Record<string, string> = { default: "<h1>Users</h1>" }, as: App.Locals = locals) =>
  container.renderToString(PlainFrame, { request: new Request("https://ttv.invalid/dashboard/apply"), locals: as, props, slots });

describe("PlainFrame", () => {
  it("puts the page in a main on a sheet, with a skip link to it and the mark home, and no island", async () => {
    const html = await render({ title: "Apply", titlePrefix: "Error: " });
    expect(html).toMatch(/<title>Error: Apply\b[^<]*<\/title>/);
    expect(html).toMatch(/<a href="#spaces-main"[^>]*>\s*Skip to content\s*<\/a>/);
    expect(html).toMatch(/<a href="\/"[^>]*>[\s\S]*TEMBO[\s\S]*<span class="sr-only">home<\/span>/);
    expect(html).toMatch(/class="platform-sheet[^"]*" data-space-tone="community"/);
    expect(html).toMatch(/<main id="spaces-main" tabindex="-1"[^>]*><h1>Users<\/h1><\/main>/);
    expect(html).not.toContain("<aside");
    expect(html).not.toContain("component-url=");
    expect(html).toContain('name="robots" content="noindex, nofollow"');
  });

  it("lets a browser session sign out with a POST, and offers a personal access token nothing to end", async () => {
    const html = await render({ title: "Apply" });
    expect(html).toMatch(/<form method="POST" action="\/auth\/logout" data-sign-out-form><button type="submit"[^>]*>Sign out<\/button><\/form>/);
    const token = { ...locals, personalAccessToken: { id: "synthetic-token" } } as unknown as App.Locals;
    expect(await render({ title: "Apply" }, undefined, token)).not.toContain("data-sign-out-form");
  });

  it("takes its space's tone, a sidebar in a labelled nav when passed, and fills for a chat", async () => {
    const html = await render({ title: "Ask", space: "admin", fill: true }, { default: "<p>Chat</p>", sidebar: "<a href=\"/admin\">Admin home</a>" });
    expect(html).toContain('data-space-tone="admin"');
    expect(html).toMatch(/<aside id="space-sidebar"[^>]*><nav aria-label="Sections"><a href="\/admin">Admin home<\/a><\/nav><\/aside>/);
    expect(html).toMatch(/<main id="spaces-main"[^>]*class="[^"]*flex min-h-0 flex-col[^"]*"/);
  });
});
