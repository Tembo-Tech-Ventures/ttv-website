import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { auditStagingCredential } from "./staging-credential-audit.mjs";
const env = { CLOUDFLARE_ENVIRONMENT_NAME: "staging", CLOUDFLARE_ACCOUNT_ID: "c25be21f175bf10728876d8ca26a9619", CLOUDFLARE_API_TOKEN: "fictional-secret", AUDIT_TOKEN_KIND: "user" };
const id = "a".repeat(32);
const ok = result => Response.json({ success: true, result });
describe("staging credential audit", () => {
  it.each(["user", "account"])("pins %s GETs and filters output", async kind => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok({ id, status: "active" })).mockResolvedValueOnce(ok({ id, status: "active", name: env.CLOUDFLARE_API_TOKEN, policies: [{ effect: "allow", resources: { private: "private" }, permission_groups: [{ name: "Workers AI Read" }, { name: env.CLOUDFLARE_API_TOKEN }] }, { effect: "deny", permission_groups: [{ name: "AI Gateway Run" }] }] }));
    const report = await auditStagingCredential({ ...env, AUDIT_TOKEN_KIND: kind }, { fetchImpl });
    expect(report).toEqual({ status: "completed", stage: "permissions", httpStatus: 200, tokenStatus: "active", permissions: ["allow:Workers AI Read", "deny:AI Gateway Run"], otherPermissionCount: 1 });
    expect(JSON.stringify(report)).not.toContain(env.CLOUDFLARE_API_TOKEN);
    const root = kind === "user" ? "/user/tokens" : `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/tokens`;
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([`https://api.cloudflare.com/client/v4${root}/verify`, `https://api.cloudflare.com/client/v4${root}/${id}`]);
    for (const [, options] of fetchImpl.mock.calls) { expect(options.method).toBe("GET"); expect(options.redirect).toBe("error"); expect(options.signal).toBeInstanceOf(globalThis.AbortSignal); expect(options).not.toHaveProperty("body"); }
  });
  it.each([{ CLOUDFLARE_ENVIRONMENT_NAME: "production" }, { CLOUDFLARE_ACCOUNT_ID: "wrong" }, { CLOUDFLARE_API_TOKEN: "" }, { AUDIT_TOKEN_KIND: "guess" }])("rejects invalid configuration", async patch => {
    const fetchImpl = vi.fn(); expect((await auditStagingCredential({ ...env, ...patch }, { fetchImpl })).stage).toBe("configuration"); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([401, 403, 302, 500])("does not read HTTP%s failure or retry", async status => {
    const response = new Response(env.CLOUDFLARE_API_TOKEN, { status }); const reader = vi.spyOn(response.body, "getReader"); const fetchImpl = vi.fn().mockResolvedValue(response);
    expect(await auditStagingCredential(env, { fetchImpl })).toMatchObject({ status: "failed", httpStatus: status, permissions: [] }); expect(reader).not.toHaveBeenCalled(); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("keeps permissions unknown on denied details", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok({ id, status: "active" })).mockResolvedValueOnce(new Response("private", { status: 403 }));
    expect(await auditStagingCredential(env, { fetchImpl })).toMatchObject({ status: "failed", tokenStatus: "active", stage: "permissions", permissions: [] }); expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each(["malformed", "oversized", "throw", "invalid-id", "expired"])("sanitizes %s without retry", async mode => {
    const fetchImpl = vi.fn();
    if (mode === "throw") fetchImpl.mockRejectedValue(new Error(env.CLOUDFLARE_API_TOKEN));
    else if (mode === "malformed") fetchImpl.mockResolvedValue(new Response(env.CLOUDFLARE_API_TOKEN));
    else if (mode === "oversized") fetchImpl.mockResolvedValue(new Response("x".repeat(64001)));
    else fetchImpl.mockResolvedValue(ok({ id: mode === "invalid-id" ? "../../secret" : id, status: mode === "expired" ? "expired" : "active" }));
    const report = await auditStagingCredential(env, { fetchImpl }); expect(report.status).toBe("failed"); expect(JSON.stringify(report)).not.toContain(env.CLOUDFLARE_API_TOKEN); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("discards partial malformed policies", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok({ id, status: "active" })).mockResolvedValueOnce(ok({ id, status: "active", policies: [{ effect: "allow", permission_groups: [{ name: "Workers AI Read" }] }, {}] }));
    expect(await auditStagingCredential(env, { fetchImpl })).toMatchObject({ status: "failed", permissions: [] });
  });
  it("separates preflight from staging credentials", () => {
    const workflow = readFileSync(new URL("../../../.github/workflows/cloudflare-staging-credential-audit.yml", import.meta.url), "utf8");
    const [preflight, audit] = workflow.split("  audit:"); expect(preflight).toContain("workflow_dispatch:"); expect(preflight).not.toContain("secrets."); expect(preflight).toContain('test "$GITHUB_RUN_ATTEMPT" = 1'); expect(audit).toContain("needs: preflight"); expect(audit).toContain("environment: staging"); expect(workflow).not.toContain("wrangler");
  });
});
