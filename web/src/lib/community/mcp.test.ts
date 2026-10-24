import { describe, expect, it, vi } from "vitest";
import { handleCommunityMcp, type CommunityMcpService } from "./mcp";
function service(institution = false): CommunityMcpService {
  return { listJourney: vi.fn().mockResolvedValue([]), getOwnProfile: vi.fn().mockResolvedValue({ userId: "member" }), updateOwnProfile: vi.fn().mockResolvedValue({ updated: true }), searchProfiles: vi.fn().mockResolvedValue([]), getProfile: vi.fn().mockResolvedValue({ userId: "other" }), access: vi.fn().mockResolvedValue({ isInstitution: institution }) };
}
function request(method: string, params?: unknown, headers: Record<string, string> = {}) {
  return new Request("https://ttv.test/api/mcp", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}
interface RpcResult { result: { capabilities: unknown; tools: { name: string }[]; structuredContent: { result: { userId: string } } }; error: { code: number } }
const member = { userId: "member", scopes: ["community:read"] };
describe("community MCP boundary", () => {
  it("requires authentication, including initialization", async () => {
    expect((await handleCommunityMcp(request("initialize"), null, service())).status).toBe(401);
  });
  it("initializes and lists only scoped tools", async () => {
    const init = await (await handleCommunityMcp(request("initialize"), member, service())).json() as RpcResult;
    expect(init.result.capabilities).toEqual({ tools: {} });
    const list = await (await handleCommunityMcp(request("tools/list"), member, service())).json() as RpcResult;
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(["assess_profile", "list_journey", "get_own_profile"]);
  });
  it("keeps own-profile identity in actor-bound service", async () => {
    const deps = service();
    await handleCommunityMcp(request("tools/call", { name: "get_own_profile", arguments: { userId: "victim" } }), member, deps);
    expect(deps.getOwnProfile).not.toHaveBeenCalled();
    const res = await (await handleCommunityMcp(request("tools/call", { name: "get_own_profile" }), member, deps)).json() as RpcResult;
    expect(res.result.structuredContent.result.userId).toBe("member");
  });
  it("blocks member directory access and missing write scope", async () => {
    const deps = service(true);
    for (const name of ["search_profiles", "update_own_profile", "get_profile"]) {
      const res = await (await handleCommunityMcp(request("tools/call", { name, arguments: { userId: "other" } }), member, deps)).json() as RpcResult;
      expect(res.error.code).toBe(-32003);
    }
    expect(deps.searchProfiles).not.toHaveBeenCalled();
  });
  it("revalidates revoked institutional approval on every call", async () => {
    const deps = service(false);
    const res = await (await handleCommunityMcp(request("tools/call", { name: "search_profiles" }), { userId: "institution", scopes: ["institution:read"] }, deps)).json() as RpcResult;
    expect(res.error.code).toBe(-32003);
    expect(deps.searchProfiles).not.toHaveBeenCalled();
  });
  it("requires cookie origins and rejects foreign bearer origins", async () => {
    expect((await handleCommunityMcp(request("initialize"), { userId: "member", scopes: null }, service())).status).toBe(403);
    expect((await handleCommunityMcp(request("initialize", undefined, { Origin: "https://evil.test" }), member, service())).status).toBe(403);
    expect((await handleCommunityMcp(request("initialize", undefined, { Origin: "https://ttv.test" }), { userId: "member", scopes: null }, service())).status).toBe(200);
  });
  it("never exposes private service errors", async () => {
    const deps = service(true);
    vi.mocked(deps.getProfile).mockRejectedValue(new Error("private call transcript and SQL"));
    const res = await handleCommunityMcp(request("tools/call", { name: "get_profile", arguments: { userId: "other" } }), { userId: "institution", scopes: ["institution:read"] }, deps);
    expect(await res.text()).not.toContain("private call");
  });
  it("rejects invalid search limits before service invocation", async () => {
    const deps = service(true);
    const res = await (await handleCommunityMcp(request("tools/call", { name: "search_profiles", arguments: { limit: 10000 } }), { userId: "institution", scopes: ["institution:read"] }, deps)).json() as RpcResult;
    expect(res.error.code).toBe(-32602);
    expect(deps.searchProfiles).not.toHaveBeenCalled();
  });
  it("reads evidence with the same ownership and institutional boundaries", async () => {
    const deps = service(true);
    const own = await (await handleCommunityMcp(request("tools/call", { name: "list_journey" }), member, deps)).json() as RpcResult;
    expect(own.error).toBeUndefined();
    const denied = await (await handleCommunityMcp(request("tools/call", { name: "list_journey", arguments: { userId: "other" } }), member, deps)).json() as RpcResult;
    expect(denied.error.code).toBe(-32003);
    const allowed = await handleCommunityMcp(request("tools/call", { name: "get_profile", arguments: { userId: "other" } }), { userId: "institution", scopes: ["institution:read"] }, deps);
    expect(await allowed.text()).toContain('"entries":[]');
  });
  it("enforces protocol headers and bounded request bodies", async () => {
    expect((await handleCommunityMcp(request("initialize", undefined, { "MCP-Protocol-Version": "unsupported" }), member, service())).status).toBe(400);
    expect((await handleCommunityMcp(request("initialize", { text: "x".repeat(65536) }), member, service())).status).toBe(413);
  });

  it("assesses own evidence while denying other subjects without institutional scope", async () => {
    const deps = service();
    vi.mocked(deps.getProfile).mockResolvedValue({ userId: "member", name: "Member", image: null, headline: "", bio: "", skills: [], opportunityGoals: "", version: 1, updatedAt: null });
    vi.mocked(deps.listJourney).mockResolvedValue([{ id: "private-entry", userId: "member", title: "TypeScript private work", description: "private-only-secret", occurredAt: "2026-10-24", visibility: "private", version: 1, createdAt: 1, updatedAt: 1, confirmations: [] }]);
    const rubric = { id: "test", version: 1, criteria: [{ id: "code", label: "Code", terms: ["TypeScript"] }] };
    const own = await handleCommunityMcp(request("tools/call", { name: "assess_profile", arguments: { userId: "member", rubric } }), member, deps);
    const text = await own.text();
    expect(text).toContain("insufficient");
    expect(text).toContain("not verification");
    expect(text).not.toContain("private-only-secret");
    expect(text).not.toContain("private-entry");
    vi.mocked(deps.getProfile).mockClear();
    const denied = await (await handleCommunityMcp(request("tools/call", { name: "assess_profile", arguments: { userId: "other", rubric } }), member, deps)).json() as RpcResult;
    expect(denied.error.code).toBe(-32003);
    expect(deps.getProfile).not.toHaveBeenCalled();
  });
  it("revalidates assessment approval and rejects invalid rubrics and extra arguments", async () => {
    const deps = service(false);
    const denied = await (await handleCommunityMcp(request("tools/call", { name: "assess_profile", arguments: { userId: "other", rubric: {} } }), { userId: "institution", scopes: ["institution:read"] }, deps)).json() as RpcResult;
    expect(denied.error.code).toBe(-32003);
    for (const args of [{ userId: "member", rubric: {} }, { userId: "member", rubric: {}, private: true }]) {
      const invalid = await (await handleCommunityMcp(request("tools/call", { name: "assess_profile", arguments: args }), member, deps)).json() as RpcResult;
      expect(invalid.error.code).toBe(-32602);
    }
    expect(deps.getProfile).not.toHaveBeenCalled();
  });

});
