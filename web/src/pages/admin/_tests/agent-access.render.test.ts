import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * /admin/agent-access on the style guide: the page's markup, a session token
 * shown once, refusals kept on the page, a revoke after a confirm step, and
 * the page with agent sessions off, with the session store mocked. The store's
 * own rules are agent-auth.test.ts.
 */
const store = vi.hoisted(() => ({ env: { DB: "synthetic-d1", AGENT_AUTH_ENABLED: "true" } as Record<string, string | undefined>, list: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: store.env }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/agent-auth", async (actual) => ({
  ...(await actual<typeof import("@/lib/agent-auth")>()),
  listAgentSessions: store.list,
  createAgentSession: store.create,
  revokeAgentSession: store.revoke,
}));

const { AgentSessionInputError } = await import("@/lib/agent-auth");
const { default: Page } = await import("../agent-access.astro");

const PATH = "/admin/agent-access";
const HOUR = 60 * 60 * 1000;
const session = (overrides: Record<string, unknown> = {}) => ({
  id: "session-1", label: "SAM staging verifier", createdAt: new Date(Date.now() - HOUR), expiresAt: new Date(Date.now() + 7 * HOUR), ...overrides,
});

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.env.AGENT_AUTH_ENABLED = "true";
  store.list.mockReset().mockResolvedValue([session()]);
  store.create.mockReset().mockResolvedValue({ ...session({ id: "session-2", label: "Preview check" }), token: "0123456789abcdef-secret" });
  store.revoke.mockReset().mockResolvedValue(true);
});

const setCookies = (response: Response): string[] => {
  const cookies = Reflect.get(response, Symbol.for("astro.cookies")) as { consume(): Iterable<string> } | undefined;
  return [...response.headers.getSetCookie(), ...(cookies ? cookies.consume() : [])];
};
type Visit = { query?: string; form?: Record<string, string>; origin?: string; locals?: Record<string, unknown> };
async function visit({ query = "", form, origin = "https://ttv.invalid", locals = {} }: Visit = {}) {
  const headers: Record<string, string> = form ? { "Content-Type": "application/x-www-form-urlencoded", Origin: origin } : {};
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid${PATH}${query}`, form ? { method: "POST", body: new URLSearchParams(form), headers } : { headers }),
    locals: { user: { id: "synthetic-admin" }, isAdmin: true, session: { userAgent: "Mozilla/5.0" }, ...locals } as unknown as App.Locals,
  });
  return { response, status: response.status, location: response.headers.get("location"), body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;
const CREATE = { action: "create", label: "Preview check", duration: "24" };

describe("agent access on the style guide", () => {
  it("is one title, a create form of kit fields with one primary, and a kit table of the admin's sessions", async () => {
    const { status, body, response } = await visit();
    expect(status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/<button [^>]*data-variant="primary"[^>]*>Create session<\/button>/);
    expect(body).toMatch(/<form method="POST" action="\/admin\/agent-access"/);
    const lifetime = /<select[^>]*name="duration"[\s\S]*?<\/select>/.exec(body)?.[0] ?? "";
    expect([...lifetime.matchAll(/<option value="(\d+)"[^>]*>([^<]+)</g)].map((match) => [match[1], match[2]])).toEqual([
      ["1", "1 hour"], ["8", "8 hours"], ["24", "24 hours"], ["168", "7 days"],
    ]);
    expect(lifetime).toMatch(/<option value="8" selected="">/);
    expect(body).toMatch(/<th[^>]*>Label<\/th>[\s\S]*?<th[^>]*>Created<\/th>[\s\S]*?<th[^>]*>Expires<\/th>[\s\S]*?<th[^>]*>Status<\/th>/);
    expect(body).toMatch(/data-status="ACTIVE">Active</);
    expect(body).toMatch(/<a href="\/admin\/agent-access\?confirm=revoke-session-1" data-row-action[^>]*>Revoke<span class="sr-only"> SAM staging verifier<\/span><\/a>/);
    expect(body).not.toMatch(/form-control|text-white|amber-|emerald-|red-\d|bg-black|\btext-primary\b|bg-teal|shadow-lg|uppercase|confirm\(/);
  });

  it("says a session that expired, with nothing to revoke on it", async () => {
    store.list.mockResolvedValue([session({ expiresAt: new Date(Date.now() - HOUR) })]);
    const { body } = await visit();
    expect(body).toMatch(/data-status="EXPIRED">Expired</);
    expect(body).not.toContain("data-row-action");
    expect((await visit({ query: "?confirm=revoke-session-1" })).body).not.toContain("data-confirm-step");
  });

  it("shows a new session's token once, in the response to the form, never a redirect", async () => {
    const { status, location, body } = await visit({ form: CREATE });
    expect(status).toBe(200);
    expect(location).toBeNull();
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "synthetic-admin", label: "Preview check", durationHours: 24 }));
    expect(body).toContain("Your new session: Preview check");
    expect(body).toMatch(/<code id="agent-token"[^>]*>0123456789abcdef-secret<\/code>/);
    expect(body).toContain('data-copy-secret="agent-token"');
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/<input [^>]*name="label"[^>]*value=""/);
  });

  it("answers a refused field 400, keeps every value, and puts the reason under the field; a database failure 503", async () => {
    store.create.mockRejectedValue(new AgentSessionInputError("Agent label may contain letters, numbers, spaces, dots, underscores, and hyphens.", "label"));
    const refused = await visit({ form: { ...CREATE, label: "preview/check" } });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatch(/<div autofocus="" tabindex="-1"[^>]*data-notice="danger"/);
    expect(refused.body).toMatch(/<input [^>]*aria-invalid="true"[^>]*name="label"[^>]*value="preview\/check"/);
    expect(refused.body).toContain("Agent label may contain letters");
    expect(refused.body).toMatch(/<option value="24" selected="">/);

    store.create.mockRejectedValue(new Error("D1_ERROR: database is locked"));
    const down = await visit({ form: CREATE });
    expect(down.status).toBe(503);
    expect(down.body).toContain("answer, so nothing changed. Try again in a moment.");
    expect(down.body).not.toContain("D1_ERROR");
  });

  it("refuses a form from another origin 403, without making a session", async () => {
    const { status, body } = await visit({ form: CREATE, origin: "https://elsewhere.invalid" });
    expect(status).toBe(403);
    expect(body).toContain("come from this page, so nothing changed.");
    expect(store.create).not.toHaveBeenCalled();
  });

  it("asks at ?confirm=revoke-<id>, then answers the revoke with a 303 and a flash", async () => {
    const { body } = await visit({ query: "?confirm=revoke-session-1" });
    const step = /<div data-confirm-step[\s\S]*?<\/form><\/div>/.exec(body)?.[0] ?? "";
    expect(step).toMatch(/aria-label="Revoke “SAM staging verifier”\?" data-notice="warning"/);
    expect(step).toMatch(/<input type="hidden" name="action" value="revoke"\/><input type="hidden" name="sessionId" value="session-1"\/>/);
    expect(step).toMatch(/<button [^>]*data-variant="danger"[^>]*>Revoke session<\/button>/);
    expect(step).toMatch(/<a href="\/admin\/agent-access" data-variant="ghost"[^>]*>Cancel<\/a>/);

    const revoked = await visit({ form: { action: "revoke", sessionId: "session-1" } });
    expect(store.revoke).toHaveBeenCalledWith("synthetic-d1", "synthetic-admin", "session-1");
    expect(revoked.status).toBe(303);
    expect(revoked.location).toBe(PATH);
    expect(setCookies(revoked.response).join("\n")).toMatch(/ttv-flash=[^;]*Session%20revoked/);

    store.revoke.mockRejectedValue(new Error("D1_ERROR"));
    expect((await visit({ form: { action: "revoke", sessionId: "session-1" } })).status).toBe(503);
  });

  it("with agent sessions off, says so in a warning, offers nothing, and refuses a form 403", async () => {
    store.env.AGENT_AUTH_ENABLED = undefined;
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(body).toMatch(/data-notice="warning"[\s\S]*?Agent access is off here/);
    expect(body).not.toContain("<form");
    expect(body).not.toContain("<table");
    expect(store.list).not.toHaveBeenCalled();
    const refused = await visit({ form: CREATE });
    expect(refused.status).toBe(403);
    expect(store.create).not.toHaveBeenCalled();
  });

  it("sends an agent session back to the admin home: one session can't make another", async () => {
    const { status, location } = await visit({ locals: { session: { userAgent: "ttv-agent:SAM staging verifier" } } });
    expect(status).toBe(302);
    expect(location).toBe("/admin");
  });

  it("says when the admin has no sessions yet", async () => {
    store.list.mockResolvedValue([]);
    expect((await visit()).body).toContain("No sessions yet");
  });
});
