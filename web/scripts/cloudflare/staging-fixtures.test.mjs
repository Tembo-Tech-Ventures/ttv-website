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
    validateRevision: vi.fn(), verifyTarget: vi.fn(async () => ({ baseUrl: "https://ttv-website-staging.fixture.workers.dev" })),
    withPersonas: vi.fn(async ({ run }) => run({ fixture: true })), verifyPersonas: vi.fn(),
  };
  return { options, close, launch };
}
describe("restricted staging runner", () => {
  it("checks revision/target before provisioning and closes browser", async () => {
    const { options, close } = runner();
    await runStagingFixtures(options);
    expect(options.validateRevision.mock.invocationCallOrder[0]).toBeLessThan(options.api.mock.invocationCallOrder[0]);
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
      addCookies: vi.fn(async cookies => { name = cookies[0].value; }), close: vi.fn(),
      newPage: vi.fn(async () => ({ goto: async url => response(stagingFixturePathAllowed(new URL(url).pathname) ? 200 : 403), url: () => "https://ttv-website-staging.fixture.workers.dev/dashboard/community", close: vi.fn() })),
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
  return { browser, personas, contexts, target: { baseUrl: "https://ttv-website-staging.fixture.workers.dev" } };
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
  });
  it("fails closed and closes contexts on wrong identity/auth status", async () => {
    const f = browserFixture({ failOwn: true });
    await expect(verifyStagingPersonas(f)).rejects.toThrow("Synthetic staging verification failed");
    expect(f.contexts[0].close).toHaveBeenCalledOnce();
    expect(f.contexts[0].request.post).not.toHaveBeenCalled();
  });
});
