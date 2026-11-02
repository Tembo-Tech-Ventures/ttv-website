import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
const mocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(), revoke: vi.fn(), access: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: {} } }));
vi.mock("@/lib/community/service", () => ({ createCommunityService: () => ({ access: mocks.access }) }));
vi.mock("@/lib/personal-access-tokens", async (original) => ({ ...(await original<typeof import("@/lib/personal-access-tokens")>()), createPersonalAccessToken: mocks.create, listPersonalAccessTokens: mocks.list, revokePersonalAccessToken: mocks.revoke }));
import { ALL } from "./tokens";
function call(method: string, input?: unknown, options: { origin?: string; delegated?: boolean; authenticated?: boolean } = {}) {
  const request = new Request("https://ttv.test/api/community/tokens", { method, headers: { "Content-Type": "application/json", ...(options.origin ? { Origin: options.origin } : {}) }, ...(method !== "GET" ? { body: JSON.stringify(input) } : {}) });
  return ALL({ request, locals: { user: options.authenticated === false ? null : { id: "member" }, session: { userAgent: null }, personalAccessToken: options.delegated ? { scopes: ["community:read"] } : null } } as APIContext);
}
const valid = { label: "My agent", durationHours: 8, scopes: ["community:read"] };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ isInstitution: false }); mocks.list.mockResolvedValue([]); mocks.create.mockResolvedValue({ token: "shown-once" }); });
describe("community token routes", () => {
  it("requires cookie authentication and rejects delegated minting", async () => {
    expect((await call("POST", valid, { authenticated: false })).status).toBe(401);
    expect((await call("POST", valid, { delegated: true, origin: "https://ttv.test" })).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("guards mutations by origin and refuses admin scopes", async () => {
    expect((await call("POST", valid)).status).toBe(403);
    expect((await call("POST", { ...valid, scopes: ["community:read", "admin:read"] }, { origin: "https://ttv.test" })).status).toBe(400);
    expect((await call("POST", { ...valid, scopes: ["community:read", "channels:read"] }, { origin: "https://ttv.test" })).status).toBe(400);
  });
  it("revalidates approval before issuing institutional scopes", async () => {
    expect((await call("POST", { ...valid, scopes: ["community:read", "institution:read"] }, { origin: "https://ttv.test" })).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("issues bounded member scopes and hides admin and channel tokens", async () => {
    expect((await call("POST", valid, { origin: "https://ttv.test" })).status).toBe(201);
    mocks.list.mockResolvedValue([{ id: "admin", scopes: ["admin:read"] }, { id: "channels", scopes: ["channels:read"] }, { id: "own", scopes: ["community:read"] }]);
    const result = await (await call("GET")).json();
    expect(result).toEqual({ tokens: [{ id: "own", scopes: ["community:read"] }] });
  });
  it("cannot revoke another users, admin or channel token", async () => {
    expect((await call("DELETE", { id: "foreign" }, { origin: "https://ttv.test" })).status).toBe(404);
    mocks.list.mockResolvedValue([{ id: "channels", scopes: ["channels:read", "channels:write"] }]);
    expect((await call("DELETE", { id: "channels" }, { origin: "https://ttv.test" })).status).toBe(404);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("rejects unknown fields and unbounded request bodies", async () => {
    expect((await call("POST", { ...valid, userId: "victim" }, { origin: "https://ttv.test" })).status).toBe(400);
    expect((await call("POST", { ...valid, label: "x".repeat(9000) }, { origin: "https://ttv.test" })).status).toBe(413);
    expect(mocks.create).not.toHaveBeenCalled();
  });

});
