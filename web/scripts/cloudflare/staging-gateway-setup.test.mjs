import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { setupStagingGateway } from "./staging-gateway-setup.mjs";
const account = "c25be21f175bf10728876d8ca26a9619";
const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const secretPath = `${base}/workers/scripts/ttv-website-staging/secrets`;
const name = "ttv-staging-inference-hackathon-2026-10";
const secret = "fictional-new-token-never-print";
const bootstrapId = "a".repeat(32);
const tokenId = "b".repeat(32);
const ids = ["c".repeat(32), "d".repeat(32)];
const expires = "2026-10-26T00:00:00Z";
const env = { CLOUDFLARE_ENVIRONMENT_NAME: "staging", CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: "fictional-bootstrap", GITHUB_RUN_ATTEMPT: "1", GITHUB_REPOSITORY: "Tembo-Tech-Ventures/ttv-website", STAGING_INTEGRATION_BRANCH: "sam/use-sam-mcp-tools-m8a3jp", STAGING_INTEGRATION_PR: "171" };
const now = () => Date.parse("2026-10-24T20:00:00Z");
const ok = (result, extra = {}) => Response.json({ success: true, result, ...extra });
const policy = { effect: "allow", permission_groups: ids.map(id => ({ id })), resources: { [`com.cloudflare.api.account.${account}`]: "*" } };
function fixture(overrides = {}) {
  let secretReads = 0;
  const fetchImpl = vi.fn(async (url, options) => {
    const key = `${options.method} ${url}`;
    if (overrides[key]) return overrides[key](options);
    if (url === secretPath && options.method === "GET") return ok(++secretReads === 3 ? [{ name: "AI_GATEWAY_API_KEY", type: "secret_text" }] : []);
    if (url === `${base}/tokens/verify`) return ok({ id: bootstrapId, status: "active" });
    if (url.includes("/tokens?page=")) return ok([], { result_info: { page: 1, per_page: 50, total_count: 0 } });
    if (url.includes("/permission_groups?")) {
      const index = url.includes("AI%20Gateway") ? 0 : 1;
      return ok([{ id: ids[index], name: ["AI Gateway Run", "Workers AI Read"][index], is_selectable: true, scopes: ["com.cloudflare.api.account"] }]);
    }
    if (url === `${base}/tokens` && options.method === "POST") return ok({ id: tokenId, value: secret });
    if (url === `${base}/tokens/${tokenId}` && options.method === "GET") return ok({ id: tokenId, status: "active", expires_on: expires, policies: [policy] });
    if (url === secretPath && options.method === "PUT") return ok({ name: "AI_GATEWAY_API_KEY", type: "secret_text" });
    if (url === `${base}/tokens/${tokenId}` && options.method === "DELETE") return ok({ id: tokenId });
    throw new Error("Unexpected request");
  });
  return { fetchImpl, validateRevision: vi.fn().mockResolvedValue({}), now };
}
const writes = deps => deps.fetchImpl.mock.calls.filter(([, options]) => options.method !== "GET");
const safe = report => {
  expect(JSON.stringify(report)).not.toContain(secret);
  expect(JSON.stringify(report)).not.toContain(env.CLOUDFLARE_API_TOKEN);
};
describe("one-shot staging gateway setup", () => {
  it("creates only the account inference policy and transfers directly to pinned Worker", async () => {
    const deps = fixture(); const report = await setupStagingGateway(env, deps);
    expect(report).toMatchObject({ status: "completed", creation: "created", tokenId, binding: "present", rollback: "not-needed" }); safe(report);
    expect(deps.validateRevision).toHaveBeenCalledTimes(2);
    const calls = writes(deps);
    expect(calls.map(([url, o]) => [o.method, url])).toEqual([["POST", `${base}/tokens`], ["PUT", secretPath]]);
    expect(JSON.parse(calls[0][1].body)).toEqual({ name, expires_on: expires, policies: [policy] });
    expect(JSON.parse(calls[1][1].body)).toEqual({ name: "AI_GATEWAY_API_KEY", type: "secret_text", text: secret });
    for (const [url, options] of deps.fetchImpl.mock.calls) { expect(url.startsWith(base)).toBe(true); expect(options.redirect).toBe("error"); expect(options.signal).toBeInstanceOf(globalThis.AbortSignal); }
  });
  it.each([{ CLOUDFLARE_ENVIRONMENT_NAME: "production" }, { CLOUDFLARE_ACCOUNT_ID: "other" }, { CLOUDFLARE_API_TOKEN: "" }, { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_REPOSITORY: "other/repo" }, { STAGING_INTEGRATION_BRANCH: "main" }, { STAGING_INTEGRATION_PR: "172" }])("rejects configuration before network: %j", async patch => {
    const deps = fixture(); expect((await setupStagingGateway({ ...env, ...patch }, deps)).stage).toBe("configuration"); expect(deps.fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects expired setup window", async () => { const deps = fixture(); deps.now = () => Date.parse(expires); expect((await setupStagingGateway(env, deps)).stage).toBe("configuration"); expect(writes(deps)).toEqual([]); });
  it("stops on a moved PR before creation", async () => { const deps = fixture(); deps.validateRevision.mockRejectedValueOnce(new Error(secret)); safe(await setupStagingGateway(env, deps)); expect(deps.fetchImpl).not.toHaveBeenCalled(); });
  it("rechecks the mutable head before creating", async () => { const deps = fixture(); deps.validateRevision.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error(secret)); expect((await setupStagingGateway(env, deps)).stage).toBe("revision"); expect(writes(deps)).toEqual([]); });
  it("refuses an existing secret", async () => { const deps = fixture({ [`GET ${secretPath}`]: () => ok([{ name: "AI_GATEWAY_API_KEY" }]) }); expect((await setupStagingGateway(env, deps)).binding).toBe("already-present"); expect(writes(deps)).toEqual([]); });
  it.each(["duplicate", "incomplete", "truncated"])("refuses %s token inventory", async mode => {
    const deps = fixture({ [`GET ${base}/tokens?page=1&per_page=50&include_expired=true`]: () => mode === "duplicate" ? ok([{ name }], { result_info: { page: 1, per_page: 50, total_count: 1 } }) : mode === "truncated" ? ok([], { result_info: { page: 1, per_page: 50, total_count: 1 } }) : ok([]) });
    expect((await setupStagingGateway(env, deps)).stage).toBe("existing-token"); expect(writes(deps)).toEqual([]);
  });
  it.each([false, undefined])("rejects unselectable or unknown permission capability %s", async is_selectable => {
    const deps = fixture({ [`GET ${base}/tokens/permission_groups?name=AI%20Gateway%20Run&scope=com.cloudflare.api.account`]: () => ok([{ name: "AI Gateway Run", id: ids[0], scopes: ["com.cloudflare.api.account"], is_selectable }]) });
    expect((await setupStagingGateway(env, deps)).stage).toBe("permissions"); expect(writes(deps)).toEqual([]);
  });
  it.each(["denied", "timeout", "malformed", "oversized", "bootstrap-id"])("never retries ambiguous/failed creation: %s", async mode => {
    const deps = fixture({ [`POST ${base}/tokens`]: () => {
      if (mode === "timeout") throw new Error(secret);
      if (mode === "denied") return new Response(secret, { status: 403 });
      if (mode === "malformed") return new Response(secret);
      if (mode === "oversized") return new Response("x".repeat(256001));
      return ok({ id: bootstrapId, value: secret });
    } });
    const report = await setupStagingGateway(env, deps); safe(report);
    expect(report).toMatchObject({ status: "failed", stage: "create", creation: "unknown", rollback: "not-needed" });
    expect(writes(deps)).toHaveLength(1);
  });
  it("revokes only its known newly created token on unexpected policy", async () => {
    const deps = fixture({ [`GET ${base}/tokens/${tokenId}`]: () => ok({ id: tokenId, status: "active", policies: [{ ...policy, resources: { "*": "*" } }], expires_on: expires }) });
    const report = await setupStagingGateway(env, deps); safe(report); expect(report.rollback).toBe("revoked");
    expect(writes(deps).map(([, o]) => o.method)).toEqual(["POST", "DELETE"]);
  });
  it.each(["denied", "timeout", "readback"])("rolls back failed/unknown transfer: %s", async mode => {
    let reads = 0;
    const deps = fixture({ [`PUT ${secretPath}`]: () => { if (mode === "timeout") throw new Error(secret); return mode === "denied" ? new Response(secret, { status: 403 }) : ok({}); }, [`GET ${secretPath}`]: () => { reads++; return ok([]); } });
    const report = await setupStagingGateway(env, deps); safe(report);
    expect(report).toMatchObject({ status: "failed", rollback: "revoked", binding: "may-contain-revoked-or-unusable-token" });
    expect(reads).toBe(mode === "readback" ? 3 : 2);
    expect(writes(deps).map(([, o]) => o.method)).toEqual(["POST", "PUT", "DELETE"]);
  });
  it("reports failed rollback without retry or deleting the Worker binding", async () => {
    const deps = fixture({ [`PUT ${secretPath}`]: () => { throw new Error(secret); }, [`DELETE ${base}/tokens/${tokenId}`]: () => new Response(secret, { status: 403 }) });
    const report = await setupStagingGateway(env, deps); safe(report); expect(report.rollback).toBe("unknown"); expect(writes(deps)).toHaveLength(3);
  });
  it("does not overwrite a secret added between preflight and transfer", async () => {
    let reads = 0; const deps = fixture({ [`GET ${secretPath}`]: () => ok(++reads === 1 ? [] : [{ name: "AI_GATEWAY_API_KEY" }]) });
    expect((await setupStagingGateway(env, deps)).rollback).toBe("revoked"); expect(writes(deps).map(([, o]) => o.method)).toEqual(["POST", "DELETE"]);
  });
  it("uses the serialized dispatcher, isolates credentials, and has no artifact/value channels", () => {
    const workflow = readFileSync(new URL("../../../.github/workflows/cloudflare-staging-gateway-setup.yml", import.meta.url), "utf8");
    const [preflight, setup] = workflow.split("  setup:");
    expect(preflight).not.toContain("secrets."); expect(preflight).toContain('test "$GITHUB_RUN_ATTEMPT" = 1');
    expect(setup).toContain("needs: preflight"); expect(setup).toContain("environment: staging");
    for (const forbidden of ["upload-artifact", "GITHUB_OUTPUT", "workflow_dispatch:", "wrangler", "secrets.GH_TOKEN"]) expect(workflow).not.toContain(forbidden);
    const caller = readFileSync(new URL("../../../.github/workflows/cloudflare-staging.yml", import.meta.url), "utf8");
    expect(caller).toContain("group: ttv-cloudflare-staging"); expect(caller).toContain("cancel-in-progress: false"); expect(caller).toContain("if: ${{ inputs.action == 'gateway-setup' }}");
  });
});
