import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAccessRequest, AdminAccessRequestList } from "@/lib/platform/contracts";

/*
 * /admin/access-requests on the style guide: the page's markup, with its reads mocked. The queue's
 * journeys (deciding, the stale 409, the person's side) are e2e/platform-access-requests.spec.ts.
 */
const reads = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  decide: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/onboarding/decisions", () => ({
  AccessRequestCursorError: class AccessRequestCursorError extends Error {},
  listAccessRequests: reads.list,
  getAdminAccessRequest: reads.get,
  decideAccessRequest: reads.decide,
}));

const { default: Page } = await import("../access-requests.astro");
const { AccessRequestCursorError } = await import("@/lib/onboarding/decisions");

const NOW = Date.UTC(2026, 10, 3, 9);
const person = (id: string, name: string) => ({ id, name, avatarUrl: null, roleBadges: [] });
function request(id: string, name: string, overrides: Partial<AdminAccessRequest> = {}): AdminAccessRequest {
  return {
    id, role: "MENTOR", status: "PENDING", note: "I review Kotlin and sync code.", organisation: null, organisationRole: null,
    link: null, decisionMessage: null, createdAt: NOW, updatedAt: NOW, decidedAt: null, requester: person(`user-${id}`, name),
    githubLogin: null, scopeAcknowledgedAt: null, decidedBy: null, earlierRequests: [], ...overrides,
  };
}
const PENDING: AdminAccessRequestList = {
  items: [request("request-otieno", "Otieno Ouma"), request("request-peter", "Peter Njoroge"), request("request-wairimu", "Wairimu Kamau")],
  nextCursor: null,
  pendingCount: 3,
};

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  reads.list.mockReset().mockResolvedValue(PENDING);
  reads.get.mockReset().mockResolvedValue(null);
  reads.decide.mockReset();
});

const admin = { user: { id: "synthetic-admin", name: "Amina Hassan" }, isAdmin: true, session: { userAgent: "Mozilla/5.0" } };
function visit(query = "", init?: RequestInit) {
  const url = `https://ttv.invalid/admin/access-requests${query}`;
  return container.renderToResponse(Page, { request: new Request(url, init), locals: structuredClone(admin) as unknown as App.Locals });
}
async function html(query = "", init?: RequestInit) {
  const response = await visit(query, init);
  return { status: response.status, body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;

describe("the access-request queue on the style guide", () => {
  it("has one display title and the lists as a PillNav, the current one marked and counted", async () => {
    const { status, body } = await html();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<h1 [^>]*>Access requests<\/h1>/);
    const nav = /<nav aria-label="Access request lists" data-pill-nav[^>]*>([\s\S]*?)<\/nav>/.exec(body)?.[1] ?? "";
    expect(nav).toMatch(/href="\/admin\/access-requests" aria-current="page"[^>]*>Pending<span[^>]*><span aria-hidden="true">3<\/span><span class="sr-only"> 3 waiting<\/span>/);
    expect(nav).toMatch(/href="\/admin\/access-requests\?status=DECIDED"(?! aria-current)[^>]*>Decided<\/a>/);
  });

  it("makes every row's decision quiet: no peach button down the queue", async () => {
    const { body } = await html();
    expect(count(body, /data-variant="quiet"/g)).toBe(PENDING.items.length * 2);
    expect(body).not.toContain('data-variant="primary"');
    expect(body).not.toMatch(/\bbg-primary\b/);
    expect(body).toContain('aria-label="Approve mentor access for Peter Njoroge"');
  });

  it("builds each message from the kit's field: label, optional, hint, and the 600-character limit", async () => {
    const { body } = await html();
    const field = /<div data-field="access-request-request-peter-message"[\s\S]*?<\/textarea>/.exec(body)?.[0] ?? "";
    expect(field).toContain("Message to Peter<span");
    expect(field).toContain("(optional)");
    expect(field).toContain('id="access-request-request-peter-message-hint"');
    expect(field).toMatch(/<textarea[^>]*maxlength="600"[^>]*aria-describedby="access-request-request-peter-message-hint"/i);
    expect(field).not.toContain("autofocus");
  });

  it("confirms a decision in a success Notice that takes focus, since the card has left the list (QAO-06)", async () => {
    reads.get.mockResolvedValue(request("request-otieno", "Otieno Ouma", {
      status: "APPROVED", decidedAt: NOW, decidedBy: person("synthetic-admin", "Amina Hassan"),
    }));
    const { body } = await html("?decided=request-otieno");
    expect(reads.get).toHaveBeenCalledWith("synthetic-d1", "request-otieno");
    const notice = /<div id="access-request-notice"[^>]*>/.exec(body)?.[0] ?? "";
    expect(notice).toContain('data-notice="success"');
    expect(notice).toContain('role="status"');
    expect(notice).toMatch(/autofocus/i);
    expect(body).toContain("Approved. Otieno Ouma was given mentor access.");
  });

  it("says what fills an empty list with an EmptyState", async () => {
    reads.list.mockResolvedValue({ items: [], nextCursor: null, pendingCount: 0 });
    const pending = await html();
    expect(pending.body).toMatch(/data-empty-state[\s\S]*?<h2[^>]*>No one is waiting for a decision<\/h2>/);
    const decided = await html("?status=DECIDED");
    expect(decided.body).toMatch(/data-empty-state[\s\S]*?<h2[^>]*>Nothing decided yet<\/h2>/);
    expect(decided.body).toMatch(/href="\/admin\/access-requests\?status=DECIDED" aria-current="page"/);
  });

  it("sends a cursor from another list back to the start of its own with a 303", async () => {
    reads.list.mockRejectedValue(new AccessRequestCursorError("Invalid access request cursor."));
    const response = await visit("?status=DECIDED&cursor=bm90LWEtY3Vyc29y");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin/access-requests?status=DECIDED");
  });

  it("keeps a refused message under its own field, with focus on it, and the rest of the queue as it was", async () => {
    const tooLong = "Thanks. ".repeat(80);
    const body = new URLSearchParams({ id: "request-peter", decision: "decline", message: tooLong });
    const result = await html("", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect(result.status).toBe(400);
    expect(reads.decide).not.toHaveBeenCalled();
    const field = /<div data-field="access-request-request-peter-message"[\s\S]*?<\/div>/.exec(result.body)?.[0] ?? "";
    expect(field).toContain('data-invalid="true"');
    expect(field).toMatch(/<textarea[^>]*autofocus/i);
    expect(field).toMatch(/<textarea[^>]*aria-invalid="true"/);
    expect(field).toContain(tooLong.trim());
    expect(field).toContain("Keep the message to 600 characters or fewer.");
    expect(count(result.body, /<textarea[^>]*autofocus/gi)).toBe(1);
    expect(result.body).not.toContain('id="access-request-failure"');
  });

  it("puts a refusal for a request that is not on this page in a danger Notice that takes focus", async () => {
    const body = new URLSearchParams({ id: "request-elsewhere", decision: "decline", message: "x".repeat(601) });
    const result = await html("", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const notice = /<div id="access-request-failure"[^>]*>/.exec(result.body)?.[0] ?? "";
    expect(notice).toContain('data-notice="danger"');
    expect(notice).toContain('role="alert"');
    expect(notice).toMatch(/autofocus/i);
  });

  it("posts each row's decision back to its list, never to an address that announces an earlier decision", async () => {
    reads.get.mockResolvedValue(request("request-otieno", "Otieno Ouma", {
      status: "APPROVED", decidedAt: NOW, decidedBy: person("synthetic-admin", "Amina Hassan"),
    }));
    const { body } = await html("?decided=request-otieno");
    const actions = [...body.matchAll(/<form method="POST" action="([^"]*)"[^>]*data-access-request-form/g)].map((match) => match[1]);
    expect(actions).toEqual(PENDING.items.map(() => "/admin/access-requests"));
    const paged = await html("?status=PENDING&cursor=c2Vjb25kLXBhZ2U&decided=request-otieno");
    expect(paged.body).toMatch(/<form method="POST" action="\/admin\/access-requests\?status=PENDING&amp;cursor=c2Vjb25kLXBhZ2U"/);
  });

  it("never shows an earlier decision's notice beside a refused message, even posted to that address", async () => {
    reads.get.mockResolvedValue(request("request-otieno", "Otieno Ouma", {
      status: "APPROVED", decidedAt: NOW, decidedBy: person("synthetic-admin", "Amina Hassan"),
    }));
    const body = new URLSearchParams({ id: "request-peter", decision: "decline", message: "x".repeat(601) });
    const result = await html("?decided=request-otieno", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect(result.status).toBe(400);
    expect(result.body).not.toContain('id="access-request-notice"');
    expect(count(result.body, /autofocus/gi)).toBe(1);
  });
});
