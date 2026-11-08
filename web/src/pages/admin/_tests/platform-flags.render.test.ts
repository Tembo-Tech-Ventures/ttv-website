import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlagAudience, FlagKey } from "@/lib/platform/contracts";

/*
 * /admin/platform-flags on the style guide: the page's markup, with its reads mocked. Changing a flag
 * end to end, with and without JavaScript, is e2e/platform-flags.spec.ts.
 */
const store = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1", DEPLOYMENT_ENVIRONMENT: "production" } }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/platform/server/flag-admin", () => ({ listFlags: store.list, updateFlag: store.update }));

const { default: Page } = await import("../platform-flags.astro");

const AUDIENCES: Record<FlagKey, FlagAudience> = {
  spaces: "ALL", onboarding: "STAFF", channels: "OFF", tembo_channels: "OFF", mentor_requests: "OFF",
};
function flags(audiences: Partial<Record<FlagKey, FlagAudience>> = {}, updatedAt = 0) {
  return {
    flags: Object.entries({ ...AUDIENCES, ...audiences }).map(([key, audience]) => ({ key, audience, updatedAt, updatedBy: null })),
  };
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.list.mockReset().mockResolvedValue(flags());
  store.update.mockReset();
});

const admin = { user: { id: "synthetic-admin", name: "Amina Hassan" }, isAdmin: true };
async function html(query = "", form?: Record<string, string>) {
  const init = form
    ? { method: "POST", body: new URLSearchParams(form), headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    : undefined;
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid/admin/platform-flags${query}`, init),
    locals: structuredClone(admin) as unknown as App.Locals,
  });
  return { status: response.status, body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;
const row = (body: string, key: FlagKey) => new RegExp(`<li[^>]*data-flag="${key}"[\\s\\S]*?</li>`).exec(body)?.[0] ?? "";

describe("the feature flags page on the style guide", () => {
  it("has one display title, and each flag is a Maven h2", async () => {
    const { status, body } = await html();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<h1 [^>]*>Feature flags<\/h1>/);
    expect(count(body, /<h2 class="font-body[^"]*">/g)).toBe(5);
  });

  it("marks the current audience as the selected pill, never peach, and offers the other two as ghost buttons", async () => {
    const { body } = await html();
    expect(body).not.toMatch(/\bbg-primary\b/);
    for (const [key, label] of [["spaces", "Everyone"], ["onboarding", "Staff"], ["channels", "Off"]] as const) {
      const current = /<span class="([^"]*)" data-flag-current>([^<]*)/.exec(row(body, key));
      expect(current?.[1]).toContain("bg-ink-primary text-dark");
      expect(current?.[2]).toBe(label);
      const buttons = [...row(body, key).matchAll(/<button type="submit" name="audience"[^>]*class="([^"]*)"/g)];
      expect(buttons).toHaveLength(2);
      for (const [, classes] of buttons) expect(classes).toContain("text-ink-secondary hover:bg-ink-primary/7");
    }
  });

  it("puts a dependency warning in a warning Notice beside its flag", async () => {
    store.list.mockResolvedValue(flags({ spaces: "OFF", onboarding: "STAFF" }));
    const { body } = await html();
    const warning = /<div class="max-w-2xl" data-flag-warning>([\s\S]*?)<\/div><\/div><\/div>/.exec(row(body, "onboarding"))?.[1] ?? "";
    expect(warning).toContain('data-notice="warning"');
    expect(warning).toContain("Onboarding needs Spaces, which is Off.");
    expect(body).not.toMatch(/Duotone|border-primary|bg-primary\//);
  });

  it("confirms a fresh change in a success Notice that takes focus", async () => {
    store.list.mockResolvedValue(flags({ spaces: "STAFF" }, Date.now()));
    const { body } = await html("?changed=spaces");
    const notice = /<div id="flag-notice"[^>]*>/.exec(body)?.[0] ?? "";
    expect(notice).toContain('data-notice="success"');
    expect(notice).toMatch(/autofocus/i);
    expect(body).toContain("Spaces is now Staff: administrators only.");
  });

  it("asks before Everyone in a warning Notice that takes focus, with the form as its actions, and changes nothing", async () => {
    const { status, body } = await html("", { key: "channels", audience: "ALL" });
    expect(status).toBe(200);
    expect(store.update).not.toHaveBeenCalled();
    const confirm = /<div data-flag-confirm="channels">([\s\S]*?)<\/form>/.exec(body)?.[1] ?? "";
    expect(confirm).toMatch(/<div id="flag-confirm"[^>]*autofocus/i);
    expect(confirm).toContain('data-notice="warning"');
    expect(confirm).toContain("Show Channels to everyone?");
    expect(confirm).toContain("Nothing has changed yet.");
    expect(confirm).toMatch(/<form method="POST"[\s\S]*name="confirm"/);
    expect(confirm).toMatch(/<button type="submit" data-variant="primary" data-size="lg"[^>]*>Show Channels to everyone/);
    expect(confirm).toMatch(/<a href="\/admin\/platform-flags" data-variant="ghost"[^>]*>Cancel<\/a>/);
    // The confirmation is the view's one peach action.
    expect(count(body, /data-variant="primary"/g)).toBe(1);
  });

  it("says a refused change in a danger Notice that takes focus", async () => {
    store.update.mockRejectedValue(new Error("D1 is unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, body } = await html("", { key: "channels", audience: "STAFF" });
    expect(status).toBe(500);
    const notice = /<div id="flag-failure"[^>]*>/.exec(body)?.[0] ?? "";
    expect(notice).toContain('data-notice="danger"');
    expect(notice).toMatch(/autofocus/i);
    expect(body).toContain("Channels could not be changed. It is still Off. Try again.");
  });
});
