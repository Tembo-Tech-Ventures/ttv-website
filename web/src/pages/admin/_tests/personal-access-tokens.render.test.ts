import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * /admin/personal-access-tokens on the style guide: the page's markup, a token
 * shown once, refusals kept on the page, and a revoke after a confirm step,
 * with the token store mocked. The store's own rules are personal-access-tokens.test.ts.
 */
const store = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/personal-access-tokens", async (actual) => ({
  ...(await actual<typeof import("@/lib/personal-access-tokens")>()),
  listPersonalAccessTokens: store.list,
  createPersonalAccessToken: store.create,
  revokePersonalAccessToken: store.revoke,
}));

const { PersonalAccessTokenInputError } = await import("@/lib/personal-access-tokens");
const { default: Page } = await import("../personal-access-tokens.astro");

const PATH = "/admin/personal-access-tokens";
const DAY = 24 * 60 * 60 * 1000;
const token = (overrides: Record<string, unknown> = {}) => ({
  id: "token-1", tokenPrefix: "ttv_pat_ab12", label: "SAM verifier", scopes: ["admin:read"],
  expiresAt: new Date(Date.now() + DAY), lastUsedAt: null, revokedAt: null, createdAt: new Date(Date.now() - DAY), ...overrides,
});

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.list.mockReset().mockResolvedValue([token()]);
  store.create.mockReset().mockResolvedValue({ ...token({ id: "token-2", label: "Nightly check" }), token: "ttv_pat_secret-value" });
  store.revoke.mockReset().mockResolvedValue(true);
});

const setCookies = (response: Response): string[] => {
  const cookies = Reflect.get(response, Symbol.for("astro.cookies")) as { consume(): Iterable<string> } | undefined;
  return [...response.headers.getSetCookie(), ...(cookies ? cookies.consume() : [])];
};
type Visit = { query?: string; form?: Record<string, string>; origin?: string | null; cookie?: string; locals?: Record<string, unknown> };
async function visit({ query = "", form, origin = "https://ttv.invalid", cookie, locals = {} }: Visit = {}) {
  const headers: Record<string, string> = {
    ...(form && { "Content-Type": "application/x-www-form-urlencoded" }),
    ...(form && origin && { Origin: origin }),
    ...(cookie && { cookie }),
  };
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid${PATH}${query}`, form ? { method: "POST", body: new URLSearchParams(form), headers } : { headers }),
    locals: { user: { id: "synthetic-admin" }, isAdmin: true, session: { userAgent: "Mozilla/5.0" }, ...locals } as unknown as App.Locals,
  });
  return { response, status: response.status, location: response.headers.get("location"), body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;
const CREATE = { action: "create", label: "Nightly check", access: "channels-read", duration: "168" };

describe("personal access tokens on the style guide", () => {
  it("is one title, a create form of kit fields with one primary, and a kit table of the admin's tokens", async () => {
    const { status, body, response } = await visit();
    expect(status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/<button [^>]*data-variant="primary"[^>]*>Create token<\/button>/);
    expect(body).toMatch(/<form method="POST" action="\/admin\/personal-access-tokens"/);
    expect(body).toMatch(/<label for="label"[^>]*>Label<\/label>/);
    expect(body).toMatch(/<optgroup label="Admin"><option value="read" selected="">Admin: read only<\/option><option value="write">Admin: read and write<\/option><\/optgroup><optgroup label="Channels">/);
    const expiry = /<select[^>]*name="duration"[\s\S]*?<\/select>/.exec(body)?.[0] ?? "";
    expect([...expiry.matchAll(/<option value="(\d+)"[^>]*>([^<]+)</g)].map((match) => [match[1], match[2]])).toEqual([
      ["24", "1 day"], ["72", "3 days"], ["168", "7 days"], ["720", "30 days (1 month)"],
      ["1440", "2 months"], ["2160", "3 months"], ["4320", "6 months"], ["8640", "12 months"],
    ]);
    expect(expiry).toMatch(/<option value="24" selected="">/);
    expect(body).toMatch(/<th[^>]*>Label<\/th>[\s\S]*?<th[^>]*>Access<\/th>[\s\S]*?<th[^>]*>Expires<\/th>[\s\S]*?<th[^>]*>Status<\/th>/);
    expect(body).toContain(">Admin, read only<");
    expect(body).toMatch(/data-status="ACTIVE">Active</);
    expect(body).toMatch(/<a href="\/admin\/personal-access-tokens\?confirm=revoke-token-1" data-row-action[^>]*>Revoke<span class="sr-only"> SAM verifier<\/span><\/a>/);
    expect(body).not.toMatch(/form-control|text-white|emerald-|red-\d|bg-black|\btext-primary\b|bg-teal|uppercase|confirm\(|—/);
  });

  it("says a token that stopped working, and offers nothing to revoke on it", async () => {
    store.list.mockResolvedValue([token({ revokedAt: new Date() }), token({ id: "token-3", expiresAt: new Date(Date.now() - DAY), lastUsedAt: new Date() })]);
    const { body } = await visit();
    expect(body).toMatch(/data-status="REVOKED">Revoked</);
    expect(body).toMatch(/data-status="EXPIRED">Expired</);
    expect(body).not.toContain("data-row-action");
  });

  it("shows a new token once, in the response to the form, never a redirect, with a quiet copy button", async () => {
    const { status, location, body } = await visit({ form: CREATE });
    expect(status).toBe(200);
    expect(location).toBeNull();
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "synthetic-admin", label: "Nightly check", durationHours: 168, scopes: ["channels:read"] }));
    expect(body).toContain("Your new token: Nightly check");
    expect(body).toMatch(/<code id="personal-access-token"[^>]*>\s*ttv_pat_secret-value\s*<\/code>/);
    expect(body).toMatch(/<button [^>]*data-copy-secret="personal-access-token"[^>]*data-variant="quiet"[^>]*>Copy token<\/button>|<button [^>]*data-variant="quiet"[^>]*data-copy-secret="personal-access-token"[^>]*>Copy token<\/button>/);
    expect(body).toContain("Authorization: Bearer &lt;token&gt;");
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    // The form is ready for the next token, not holding the last one.
    expect(body).toMatch(/<input [^>]*name="label"[^>]*value=""/);
  });

  it("answers a refused field 400, keeps every value, and puts the reason under the field", async () => {
    store.create.mockRejectedValue(new PersonalAccessTokenInputError("Token label may contain letters, numbers, spaces, dots, underscores, and hyphens.", "label"));
    const { status, body } = await visit({ form: { ...CREATE, label: "Nightly/check" } });
    expect(status).toBe(400);
    expect(body).toMatch(/<div autofocus="" tabindex="-1"[^>]*data-notice="danger"/);
    expect(body).toContain("Check the field marked below.");
    expect(body).toMatch(/<input [^>]*aria-invalid="true"[^>]*name="label"[^>]*value="Nightly\/check"/);
    expect(body).toContain("Token label may contain letters");
    expect(body).toMatch(/<option value="channels-read" selected="">/);
    expect(body).toMatch(/<option value="168" selected="">/);
    expect(body).not.toContain("personal-access-token\"");
  });

  it("answers a refusal of the whole request 400 with its reason, and a database failure 503", async () => {
    store.create.mockRejectedValue(new PersonalAccessTokenInputError("Revoke an existing token before creating more than 10."));
    const limit = await visit({ form: CREATE });
    expect(limit.status).toBe(400);
    expect(limit.body).toContain("Revoke an existing token before creating more than 10.");

    store.create.mockRejectedValue(new Error("D1_ERROR: database is locked"));
    const down = await visit({ form: CREATE });
    expect(down.status).toBe(503);
    expect(down.body).toContain("answer, so nothing changed. Try again in a moment.");
    expect(down.body).not.toContain("D1_ERROR");
  });

  it("refuses a form from another origin 403, without touching a token", async () => {
    const { status, body } = await visit({ form: CREATE, origin: "https://elsewhere.invalid" });
    expect(status).toBe(403);
    expect(body).toContain("come from this page, so nothing changed.");
    expect(store.create).not.toHaveBeenCalled();
  });

  it("asks at ?confirm=revoke-<id>: a focused warning naming the token, a danger button posting the revoke, and Cancel back", async () => {
    const { body } = await visit({ query: "?confirm=revoke-token-1" });
    const step = /<div data-confirm-step[\s\S]*?<\/form><\/div>/.exec(body)?.[0] ?? "";
    expect(step).toMatch(/aria-label="Revoke “SAM verifier”\?" data-notice="warning"/);
    expect(step).toContain("Anything using it stops working at once");
    expect(step).toMatch(/<form method="post" action="\/admin\/personal-access-tokens"[^>]*><input type="hidden" name="action" value="revoke"\/><input type="hidden" name="tokenId" value="token-1"\/>/);
    expect(step).toMatch(/<button [^>]*data-variant="danger"[^>]*>Revoke token<\/button>/);
    expect(step).toMatch(/<a href="\/admin\/personal-access-tokens" data-variant="ghost"[^>]*>Cancel<\/a>/);
    // A token that no longer works, or isn't the admin's, gets no step.
    expect((await visit({ query: "?confirm=revoke-someone-else" })).body).not.toContain("data-confirm-step");
  });

  it("answers a revoke with a 303 to the page and a flash, and a database failure 503", async () => {
    const revoked = await visit({ form: { action: "revoke", tokenId: "token-1" } });
    expect(store.revoke).toHaveBeenCalledWith("synthetic-d1", "synthetic-admin", "token-1");
    expect(revoked.status).toBe(303);
    expect(revoked.location).toBe(PATH);
    expect(setCookies(revoked.response).join("\n")).toMatch(/ttv-flash=[^;]*Token%20revoked/);

    store.revoke.mockResolvedValue(false);
    const gone = await visit({ form: { action: "revoke", tokenId: "token-1" } });
    expect(gone.status).toBe(303);
    expect(setCookies(gone.response).join("\n")).toMatch(/ttv-flash=[^;]*already%20stopped%20working/);

    store.revoke.mockRejectedValue(new Error("D1_ERROR"));
    expect((await visit({ form: { action: "revoke", tokenId: "token-1" } })).status).toBe(503);
  });

  it("says the flash once on the next GET", async () => {
    const flash = `ttv-flash=${encodeURIComponent(JSON.stringify({ tone: "success", title: "Token revoked", path: PATH }))}`;
    const { body } = await visit({ cookie: flash });
    expect(body).toMatch(/data-notice="success"[\s\S]*?Token revoked/);
  });

  it("says when the admin has no tokens yet", async () => {
    store.list.mockResolvedValue([]);
    expect((await visit()).body).toContain("No tokens yet");
  });

  it("refuses delegated credentials 403: a token or an agent session can't manage tokens", async () => {
    expect((await visit({ locals: { personalAccessToken: { id: "token-1" } } })).status).toBe(403);
    expect((await visit({ locals: { session: { userAgent: "ttv-agent:SAM verifier" } } })).status).toBe(403);
    expect(store.list).not.toHaveBeenCalled();
  });
});
