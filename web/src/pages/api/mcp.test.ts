import { describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
vi.mock("cloudflare:workers", () => ({ env: { DB: {} } }));
vi.mock("@/lib/community/service", () => ({ createCommunityService: () => ({ access: async () => ({ isInstitution: false }), getOwnProfile: async () => ({ userId: "member" }) }) }));
import { ALL } from "./mcp";
function call(user: boolean, authorization?: string, scoped = false) {
  return ALL({ request: new Request("https://ttv.test/api/mcp", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://ttv.test", ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) }), locals: { user: user ? { id: "member" } : null, personalAccessToken: scoped ? { scopes: ["community:read"] } : null } } as APIContext);
}
describe("MCP authenticated route", () => {
  it("rejects unauthenticated or revoked credentials", async () => {
    expect((await call(false, "Bearer revoked")).status).toBe(401);
  });
  it("does not let an unknown bearer inherit a cookie session", async () => {
    expect((await call(true, "Bearer invalid")).status).toBe(401);
  });
  it("accepts a valid scoped PAT or same-origin cookie", async () => {
    expect((await call(true, "Bearer valid", true)).status).toBe(200);
    expect((await call(true)).status).toBe(200);
  });
});
