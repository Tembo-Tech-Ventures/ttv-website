import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runStagingFixtures } from "./staging-fixtures.mjs";
import { verifyStagingPersonas } from "./staging-fixture-verification.mjs";
import { stagingFixturePathAllowed } from "../../src/lib/staging-fixture-policy";
function runner() {
  const close = vi.fn();
  const launch = vi.fn(async () => ({ close }));
  const options = {
    environment: { CLOUDFLARE_ENVIRONMENT_NAME: "staging", CLOUDFLARE_ACCOUNT_ID: "account", STAGING_EXPECTED_SHA: "sha" },
    api: vi.fn(async () => ({ subdomain: "fixture" })), browserType: { launch },
    getBindings: vi.fn(() => [{ key: "BETTER_AUTH_SECRET", value: "fictional" }]),
    validateRevision: vi.fn(), verifyTarget: vi.fn(async () => ({ baseUrl: "https://staging.tembotechventures.com" })),
    withPersonas: vi.fn(async ({ run }) => run({ fixture: true })), verifyPersonas: vi.fn(),
  };
  return { options, close, launch };
}
describe("restricted staging runner", () => {
  it("checks revision/target before provisioning and closes browser", async () => {
    const { options, close } = runner();
    await runStagingFixtures(options);
    expect(options.validateRevision.mock.invocationCallOrder[0]).toBeLessThan(options.verifyTarget.mock.invocationCallOrder[0]);
    expect(options.verifyTarget).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "https://staging.tembotechventures.com" }));
    expect(options.verifyTarget.mock.invocationCallOrder[0]).toBeLessThan(options.withPersonas.mock.invocationCallOrder[0]);
    expect(close).toHaveBeenCalledOnce();
  });
  it("stops before credentials/provisioning when revision is wrong", async () => {
    const { options, launch } = runner();
    options.validateRevision.mockRejectedValue(new Error("stale revision"));
    await expect(runStagingFixtures(options)).rejects.toThrow("stale revision");
    expect(options.getBindings).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    expect(options.api).not.toHaveBeenCalled();
  });
  it("rejects production before Cloudflare access", async () => {
    const { options } = runner();
    options.environment.CLOUDFLARE_ENVIRONMENT_NAME = "production";
    await expect(runStagingFixtures(options)).rejects.toThrow("Shared staging");
    expect(options.api).not.toHaveBeenCalled();
  });
  it("does not load signing credentials, launch browsers or provision after target mismatch", async () => {
    const { options, launch } = runner();
    options.verifyTarget.mockRejectedValue(new Error("origin mismatch"));
    await expect(runStagingFixtures(options)).rejects.toThrow("origin mismatch");
    expect(options.getBindings).not.toHaveBeenCalled();
    expect(options.withPersonas).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });
  it("closes browser if provisioning or verification fails", async () => {
    const { options, close } = runner();
    options.withPersonas.mockRejectedValue(new Error("fixture failure"));
    await expect(runStagingFixtures(options)).rejects.toThrow("fixture failure");
    expect(close).toHaveBeenCalledOnce();
  });
  it("holds the deployment concurrency group and scopes secrets to verification after preflight", () => {
    const workflow = readFileSync(new URL("../../../.github/workflows/cloudflare-staging-fixtures.yml", import.meta.url), "utf8");
    expect(workflow).toContain("group: ttv-cloudflare-staging");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("needs: preflight");
    expect(workflow).toContain("environment: staging");
    expect(workflow.split("  verify:")[0]).not.toContain("secrets.");
    expect(workflow).not.toContain("upload-artifact");
    expect(workflow).not.toContain("wrangler deploy");
    expect(workflow).not.toContain("STAGING_AGENT_TOKEN");
  });
});

function browserFixture({ failOwn = false } = {}) {
  const names = ["member", "otherMember", "mentor", "institution", "unapprovedInstitution", "admin"];
  const personas = Object.fromEntries(names.map(name => [name, { userId: name, cookies: [{ name: "fixture", value: name }], personalAccessToken: name }]));
  const contexts = [];
  let granted = false;
  const response = (status, data = {}) => ({ status: () => status, json: async () => data });
  const browser = { newContext: vi.fn(async options => {
    let name = options.extraHTTPHeaders?.Authorization?.slice(7);
    const context = {
      route: vi.fn(),
      addCookies: vi.fn(async cookies => { name = cookies[0].value; }), close: vi.fn(),
      newPage: vi.fn(async () => ({ goto: async url => response(stagingFixturePathAllowed(new URL(url).pathname) ? 200 : 403), url: () => "https://staging.tembotechventures.com/dashboard/community", close: vi.fn() })),
      request: {
        get: vi.fn(async path => {
          if (path === "/api/community/profile") return response(failOwn ? 401 : 200, { profile: { userId: name } });
          if (path === "/api/community/tokens" || path === "/admin/agent-access") return response(403);
          if (path === "/api/community/mentorship") return response(200);
          return response(name === "institution" || (name === "unapprovedInstitution" && granted) ? 200 : 403);
        }),
        post: vi.fn(async (path, args) => {
          if (path === "/api/community/access") { granted = args.data.granted; return response(200); }
          return response(200, { result: { protocolVersion: "2025-11-25" } });
        }),
      },
    };
    contexts.push(context);
    return context;
  }) };
  return { browser, personas, contexts, target: { baseUrl: "https://staging.tembotechventures.com" } };
}
describe("fixed browser verification", () => {
  it("checks role-denied paths and closes all browser/PAT contexts", async () => {
    const f = browserFixture();
    await verifyStagingPersonas(f);
    expect(f.contexts).toHaveLength(9);
    expect(f.contexts.every(c => c.close.mock.calls.length === 1)).toBe(true);
    expect(f.contexts[5].request.post).toHaveBeenCalledWith("/api/community/access", expect.objectContaining({ data: { userId: "unapprovedInstitution", role: "INSTITUTION", granted: false } }));
    const paths = f.contexts.flatMap(c => [...c.request.get.mock.calls, ...c.request.post.mock.calls].map(call => call[0]));
    expect(paths.some(path => path.includes("chat") || path.includes("decisions"))).toBe(false);
    expect(f.contexts.flatMap(c => [...c.request.get.mock.calls, ...c.request.post.mock.calls]).every(call => call[1].maxRedirects === 0)).toBe(true);
  });
  it("blocks browser redirects and cross-origin requests before continuing", async () => {
    const f = browserFixture();
    await verifyStagingPersonas(f);
    const handler = f.contexts[0].route.mock.calls[0][1];
    for (const [url, redirected, allowed] of [
      [f.target.baseUrl + "/dashboard/community", false, true],
      [f.target.baseUrl + "/auth/login", true, false],
      ["https://tembotechventures.com/dashboard", false, false],
      ["https://example.com", false, false],
    ]) {
      const route = { request: () => ({ url: () => url, redirectedFrom: () => redirected ? {} : null }), abort: vi.fn(), fetch: vi.fn(async () => ({ status: () => 200 })), fulfill: vi.fn() };
      await handler(route);
      expect(route.fulfill).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(route.fetch).toHaveBeenCalledTimes(allowed ? 1 : 0);
      if (allowed) expect(route.fetch).toHaveBeenCalledWith({ maxRedirects: 0 });
      expect(route.abort).toHaveBeenCalledTimes(allowed ? 0 : 1);
    }
    const redirect = { request: () => ({ url: () => f.target.baseUrl + "/dashboard/community", redirectedFrom: () => null }), abort: vi.fn(), fetch: vi.fn(async () => ({ status: () => 302 })), fulfill: vi.fn() };
    await handler(redirect);
    expect(redirect.abort).toHaveBeenCalledOnce();
    expect(redirect.fulfill).not.toHaveBeenCalled();
  });
  it("fails closed and closes contexts on wrong identity/auth status", async () => {
    const f = browserFixture({ failOwn: true });
    await expect(verifyStagingPersonas(f)).rejects.toThrow("Synthetic staging verification failed");
    expect(f.contexts[0].close).toHaveBeenCalledOnce();
    expect(f.contexts[0].request.post).not.toHaveBeenCalled();
  });
});
