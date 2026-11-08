import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * /admin/projects/[id] on the style guide: the page's markup and its status changes, with the
 * database mocked. Accepting a pending project end to end is e2e/admin-review.spec.ts.
 */
const store = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("drizzle-orm/d1", () => ({
  drizzle: () => ({
    query: { clientProject: { findFirst: store.find } },
    update: () => ({ set: (values: unknown) => ({ where: () => ({ returning: () => store.update(values) }) }) }),
  }),
}));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));

const { default: Page } = await import("../projects/[id].astro");

const PATH = "/admin/projects/project-1";
const AT = new Date(Date.UTC(2026, 9, 6, 9));
function interest(id: string, name: string, status: "INTERESTED" | "WITHDRAWN", note: string | null = null) {
  return { id, status, note, createdAt: AT, profile: { id: `profile-${id}`, handle: name.toLowerCase().replace(" ", "-"), user: { name } } };
}
function project(status: string, interests = [interest("a", "Achieng Otieno", "INTERESTED", "I built a chama ledger."), interest("b", "Brian Kamau", "WITHDRAWN")]) {
  return {
    id: "project-1", title: "Member savings tracker", organization: "Chama Savings", contactName: "Grace Wanjiru",
    contactEmail: "grace@example.test", description: "Track contributions.\nSend reminders.", skills: '["React","SQL"]',
    budgetBand: "FROM_1K_TO_5K", timeline: "Two months", status, createdAt: AT, updatedAt: AT, projectInterests: interests,
  };
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.find.mockReset().mockImplementation(async (query: { columns?: unknown }) => (query.columns ? { status: "PENDING" } : project("PENDING")));
  store.update.mockReset().mockResolvedValue([{ id: "project-1" }]);
});

const setCookies = (response: Response): string[] => {
  const cookies = Reflect.get(response, Symbol.for("astro.cookies")) as { consume(): Iterable<string> } | undefined;
  return [...response.headers.getSetCookie(), ...(cookies ? cookies.consume() : [])];
};
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
async function visit({ query = "", form }: { query?: string; form?: Record<string, string> } = {}) {
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid${PATH}${query}`, form ? { method: "POST", body: new URLSearchParams(form), headers: FORM } : undefined),
    params: { id: "project-1" },
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  return { response, status: response.status, location: response.headers.get("location"), body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;
const actions = (body: string) => /<div class="grid gap-4" data-status-actions>([\s\S]*?)<\/div><\/div><\/div><\/main>/.exec(body)?.[1] ?? "";

describe("a client project on the style guide", () => {
  it("names the project in the one display title, with its status in the shared name and its facts listed", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<a href="\/admin\/projects" data-back-link[^>]*>[\s\S]*?<span>Client projects<\/span><\/a>[\s\S]*?<h1 [^>]*>Member savings tracker<\/h1>/);
    expect(body).toMatch(/data-chip="peach"[^>]*><span[^>]*><span data-status="PENDING">In review<\/span>/);
    expect(body).toContain("From Chama Savings · submitted 6 Oct 2026");
    expect(body).toMatch(/<dt[^>]*>Email<\/dt><dd[^>]*><a href="mailto:grace@example.test" class="[^"]*underline[^"]*">grace@example.test<\/a>/);
    expect(body).toMatch(/<ul class="flex flex-wrap gap-2" aria-label="Skills"><li><span data-chip="neutral"/);
    expect(body).not.toMatch(/text-white|\btext-primary\b|bg-(green|red|indigo|gray|teal)-|uppercase|opacity-50|data-badge|Project Detail|Client Contact|Interested Builders|terminal state/);
  });

  it("lists interested builders on hairlines and the withdrawn under their own heading, readable without fading", async () => {
    const { body } = await visit();
    const interests = /<div class="grid gap-2" data-interests>([\s\S]*?)<\/div><\/div>(?=<div data-card)/.exec(body)?.[1] ?? "";
    expect(interests).toMatch(/<ul class="divide-y divide-hairline">[\s\S]*?Achieng Otieno[\s\S]*?<a href="\/talent\/achieng-otieno" class="[^"]*min-h-11[^"]*">@achieng-otieno<\/a>[\s\S]*?Admin view<span class="sr-only"> of Achieng Otieno<\/span>[\s\S]*?I built a chama ledger\./);
    expect(interests).toMatch(/data-withdrawn><h3 class="text-sm text-ink-secondary">Withdrawn<\/h3>[\s\S]*?Brian Kamau/);
    expect(interests).not.toContain("data-card");
  });

  it("offers quiet changes only, and asks before the final ones", async () => {
    const pending = actions((await visit()).body);
    expect(pending).toContain("It's in review now.");
    expect(pending).toMatch(/<input type="hidden" name="status" value="APPROVED"><button [^>]*data-variant="quiet"[^>]*>Accept<\/button>/);
    expect(pending).toMatch(/<a href="\/admin\/projects\/project-1\?confirm=decline" data-variant="quiet"[^>]*>Decline<\/a>/);
    expect(pending).not.toMatch(/data-variant="(primary|danger)"|value="REJECTED"/);

    const step = actions((await visit({ query: "?confirm=decline" })).body);
    expect(step).toMatch(/<div autofocus="" tabindex="-1" role="region" aria-label="Decline Member savings tracker\?" data-notice="warning"/);
    expect(step).toMatch(/<input type="hidden" name="status" value="REJECTED"\/><button [^>]*data-variant="danger"[^>]*>Decline project<\/button><a href="\/admin\/projects\/project-1" data-variant="ghost"[^>]*>Cancel<\/a>/);

    store.find.mockResolvedValue(project("APPROVED"));
    const approved = actions((await visit()).body);
    expect(approved).toMatch(/data-variant="quiet"[^>]*>Mark matched<\/button>/);
    expect(approved).toMatch(/\?confirm=close" data-variant="quiet"[^>]*>Close<\/a>/);

    store.find.mockResolvedValue(project("CLOSED"));
    expect(actions((await visit()).body)).toContain("It's closed, and that's final: the status can't change again.");
  });

  it("answers a change with a 303 and a flash", async () => {
    const { status, location, response } = await visit({ form: { status: "APPROVED" } });
    expect(status).toBe(303);
    expect(location).toBe(PATH);
    expect(store.update).toHaveBeenCalledWith({ status: "APPROVED" });
    expect(decodeURIComponent(setCookies(response)[0])).toContain('"title":"Project accepted"');
  });

  it("says a refused, stale or failed change in words, in a focused danger Notice", async () => {
    const refused = await visit({ form: { status: "CLOSED" } });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatch(/data-title-prefix="Error: "/);
    expect(refused.body).toMatch(/<div (?=[^>]*autofocus="")(?=[^>]*role="alert")[^>]*data-notice="danger"[\s\S]*?A project that is in review can(?:&#39;|&#x27;)t be changed to closed\./);
    expect(store.update).not.toHaveBeenCalled();

    store.update.mockResolvedValue([]);
    const stale = await visit({ form: { status: "APPROVED" } });
    expect(stale.status).toBe(400);
    expect(stale.body).toContain("Someone changed this project while you were looking at it.");

    store.update.mockRejectedValue(new Error("D1 down"));
    const failed = await visit({ form: { status: "APPROVED" } });
    expect(failed.status).toBe(503);
    expect(failed.body).toMatch(/The database didn(?:&#39;|&#x27;)t answer, so nothing changed\./);
  });

  it("says plainly when nobody has raised a hand", async () => {
    store.find.mockResolvedValue(project("APPROVED", []));
    expect((await visit()).body).toContain("None yet. Builders who raise a hand on this project show here.");
  });
});
