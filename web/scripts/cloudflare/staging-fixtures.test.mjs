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
    discardEvidence: vi.fn(), sealEvidence: vi.fn(),
    withPersonas: vi.fn(async ({ run }) => run({ fixture: true })), verifyPersonas: vi.fn(),
  };
  return { options, close, launch };
}
describe("restricted staging runner", () => {
  it("keeps normal verification model-free and opts in only with readiness and a first attempt", async () => {
    const { options } = runner(); await runStagingFixtures(options);
    expect(options.withPersonas).toHaveBeenLastCalledWith(expect.objectContaining({ assessmentProbe: false }));
    options.environment.STAGING_BROWSER_ASSESSMENT = "true";
    options.environment.GITHUB_RUN_ATTEMPT = "1";
    options.api.mockResolvedValue({ bindings: [{ name: "AI", type: "ai" }, { name: "AI_GATEWAY_NAME", type: "plain_text", text: "ttv-website-ai-staging" }] });
    await runStagingFixtures(options);
    expect(options.withPersonas).toHaveBeenLastCalledWith(expect.objectContaining({ assessmentProbe: true }));
    expect(options.verifyPersonas).toHaveBeenLastCalledWith(expect.objectContaining({ browserAssessment: true }));
  });
  it("opts chat into ordinary sessions and rejects combined inference or reruns", async () => {
    const { options, launch } = runner();
    options.environment.STAGING_BROWSER_CHAT = "true";
    options.environment.GITHUB_RUN_ATTEMPT = "2";
    await expect(runStagingFixtures(options)).rejects.toThrow("reruns");
    options.environment.GITHUB_RUN_ATTEMPT = "1";
    options.environment.STAGING_BROWSER_ASSESSMENT = "true";
    await expect(runStagingFixtures(options)).rejects.toThrow("only one");
    expect(launch).not.toHaveBeenCalled();
    options.environment.STAGING_BROWSER_ASSESSMENT = "false";
    await expect(runStagingFixtures(options)).rejects.toThrow("binding readiness");
    options.api.mockResolvedValue({ bindings: [{ name: "AI", type: "ai" }, { name: "AI_GATEWAY_NAME", type: "plain_text", text: "ttv-website-ai-staging" }] });
    await runStagingFixtures(options);
    expect(options.withPersonas).toHaveBeenLastCalledWith(expect.objectContaining({ assessmentProbe: false }));
    expect(options.verifyPersonas).toHaveBeenLastCalledWith(expect.objectContaining({ browserChat: true, browserAssessment: false }));
  });
  it("opts discovery in with the same binding, first-attempt and cleanup controls",async()=>{
    const {options,launch}=runner();options.environment.STAGING_BROWSER_DISCOVERY="true";
    options.environment.GITHUB_RUN_ATTEMPT="2";
    await expect(runStagingFixtures(options)).rejects.toThrow("reruns");expect(launch).not.toHaveBeenCalled();
    options.environment.GITHUB_RUN_ATTEMPT="1";
    await expect(runStagingFixtures(options)).rejects.toThrow("binding readiness");
    options.api.mockResolvedValue({bindings:[{name:"AI",type:"ai"},{name:"AI_GATEWAY_NAME",type:"plain_text",text:"ttv-website-ai-staging"}]});
    await runStagingFixtures(options);
    expect(options.verifyPersonas).toHaveBeenCalledWith(expect.objectContaining({browserDiscovery:true}));
    options.environment.STAGING_BROWSER_CHAT="true";
    await expect(runStagingFixtures(options)).rejects.toThrow("only one");
  });
  it("rejects reruns and missing native binding before browser or fixture writes", async () => {
    const { options, launch } = runner();
    options.environment.STAGING_BROWSER_ASSESSMENT = "true";
    options.environment.GITHUB_RUN_ATTEMPT = "2";
    await expect(runStagingFixtures(options)).rejects.toThrow("reruns");
    options.environment.GITHUB_RUN_ATTEMPT = "1";
    await expect(runStagingFixtures(options)).rejects.toThrow("binding readiness");
    expect(launch).not.toHaveBeenCalled(); expect(options.withPersonas).not.toHaveBeenCalled();
  });
  it("checks revision/target before provisioning and closes browser", async () => {
    const { options, close } = runner();
    await runStagingFixtures(options);
    expect(options.validateRevision.mock.invocationCallOrder[0]).toBeLessThan(options.verifyTarget.mock.invocationCallOrder[0]);
    expect(options.verifyTarget).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "https://staging.tembotechventures.com" }));
    expect(options.verifyTarget.mock.invocationCallOrder[0]).toBeLessThan(options.withPersonas.mock.invocationCallOrder[0]);
    expect(close).toHaveBeenCalledOnce();
  });
  it("seals only after database lifecycle and browser cleanup finish", async () => {
    const { options, close } = runner(); await runStagingFixtures(options);
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(options.sealEvidence.mock.invocationCallOrder[0]);
    expect(options.withPersonas.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
    expect(options.sealEvidence).toHaveBeenCalledWith("sha");
  });
  it.each(["database", "browser", "seal"])("discards captures on %s failure", async stage => {
    const { options, close } = runner(); const error = new Error("sensitive failure");
    if (stage === "database") options.withPersonas.mockRejectedValue(error);
    if (stage === "browser") close.mockRejectedValue(error);
    if (stage === "seal") options.sealEvidence.mockRejectedValue(error);
    await expect(runStagingFixtures(options)).rejects.toThrow("sensitive failure");
    expect(options.discardEvidence).toHaveBeenCalledTimes(2);
    if (stage !== "seal") expect(options.sealEvidence).not.toHaveBeenCalled();
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
    const caller = readFileSync(new URL("../../../.github/workflows/cloudflare-staging.yml", import.meta.url), "utf8");
    expect(caller).toContain("group: ttv-cloudflare-staging");
    expect(caller).toContain("cancel-in-progress: false");
    expect(caller).toContain("uses: ./.github/workflows/cloudflare-staging-fixtures.yml");
    expect(workflow).not.toMatch(/^concurrency:/m);
    expect(workflow).toContain("needs: preflight");
    expect(workflow).toContain("environment: staging");
    expect(workflow.split("  verify:")[0]).not.toContain("secrets.");
    expect(workflow).toContain("uses: actions/upload-artifact@v4");
    expect(workflow).toContain("if: ${{ success() }}");
    expect(workflow).not.toContain("path: web/test-results/**");
    const paths = workflow.split("          path: |\n")[1].trim().split("\n").map(line => line.trim());
    expect(paths).toEqual([
      ...["desktop", "mobile"].flatMap(view => ["member", "mentor", "scout", "known-profile"].map(state => `web/test-results/staging-community/${view}-${state}.png`)),
      "web/test-results/staging-community/desktop-chat.png",
      "web/test-results/staging-community/desktop-assessment.png",
      "web/test-results/staging-community/manifest.json",
    ]);
    expect(workflow.indexOf("run: node scripts/cloudflare/staging-fixtures.mjs")).toBeLessThan(workflow.indexOf("uses: actions/upload-artifact@v4"));
    expect(workflow).not.toContain("wrangler deploy");
    expect(workflow).not.toContain("STAGING_AGENT_TOKEN");
  });
});

function browserFixture({ failOwn = false, sameRun = false } = {}) {
  const names = ["member", "otherMember", "mentor", "institution", "unapprovedInstitution", "admin"];
  const personas = Object.fromEntries(names.map(name => [name, { userId: sameRun ? `ttv-staging-fixture-${"a".repeat(24)}-${name}` : name, cookies: [{ name: "fixture", value: name }], personalAccessToken: name }]));
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
          if (path === "/api/community/profile") return response(failOwn ? 401 : 200, { profile: { userId: personas[name].userId } });
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
  return { audienceEnabled: false, browser, personas, contexts, verifyJourney: vi.fn(), target: { baseUrl: "https://staging.tembotechventures.com" } };
}
describe("fixed browser verification", () => {
  it.each([false,true])("audience wiring reuses guarded contexts and cleans on failure=%s", async fails => {
    const f=browserFixture({sameRun:true}),verifyAudience=vi.fn();if(fails)verifyAudience.mockRejectedValue(new Error("PRIVATE"));
    const result=verifyStagingPersonas({...f,audienceEnabled:true,verifyAudience});
    if(fails)await expect(result).rejects.toThrow("Synthetic staging verification failed");else await result;
    expect(f.contexts).toHaveLength(10);expect(f.contexts[9].route).toHaveBeenCalledOnce();expect(f.contexts[9].addCookies).not.toHaveBeenCalled();
    expect(verifyAudience).toHaveBeenCalledWith(expect.objectContaining({anonymousContext:f.contexts[9],contextsByRole:expect.objectContaining({member:f.contexts[0],mentor:f.contexts[2],institution:f.contexts[3],admin:f.contexts[5]}),users:Object.fromEntries(["member","mentor","institution","admin"].map(role=>[role,{userId:`ttv-staging-fixture-${"a".repeat(24)}-${role}`}]))}));
    expect(f.contexts.every(c=>c.close.mock.calls.length===1)).toBe(true);
    if(fails)expect(f.verifyJourney).not.toHaveBeenCalled();
  });
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
  it("passes only same-run role contexts and IDs to the journey, with cleanup on failure", async () => {
    const f = browserFixture();
    f.verifyJourney.mockRejectedValue(new Error("sensitive failure must not escape"));
    await expect(verifyStagingPersonas(f)).rejects.toThrow("Synthetic staging verification failed.");
    expect(f.verifyJourney).toHaveBeenCalledWith({
      baseUrl: f.target.baseUrl,
      browserAssessment: false,
      browserChat: false,
      contextsByRole: { member: f.contexts[0], mentor: f.contexts[2], institution: f.contexts[3] },
      users: { member: { userId: "member" }, mentor: { userId: "mentor" }, institution: { userId: "institution" } },
      evidenceDirectory: "test-results/staging-community",
    });
    expect(f.contexts.every(context => context.close.mock.calls.length === 1)).toBe(true);
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
      if (allowed) expect(route.fetch).toHaveBeenCalledWith({ maxRedirects: 0, maxRetries: 0, timeout: 30000 });
      expect(route.abort).toHaveBeenCalledTimes(allowed ? 0 : 1);
    }
    const redirect = { request: () => ({ url: () => f.target.baseUrl + "/dashboard/community", redirectedFrom: () => null }), abort: vi.fn(), fetch: vi.fn(async () => ({ status: () => 302 })), fulfill: vi.fn() };
    await handler(redirect);
    expect(redirect.abort).toHaveBeenCalledOnce();
    expect(redirect.fulfill).not.toHaveBeenCalled();
  });
  it.each(["fetch", "fulfill", "abort"])("contains private %s errors and fails verification after context cleanup", async stage => {
    const f = browserFixture();
    f.verifyJourney.mockImplementation(async () => {
      const handler = f.contexts[3].route.mock.calls[0][1];
      const route = {
        request: () => ({ url: () => f.target.baseUrl + "/api/community/chat", method: () => "POST", redirectedFrom: () => null }),
        fetch: vi.fn(async () => ({ status: () => stage === "abort" ? 302 : 200 })),
        fulfill: vi.fn(), abort: vi.fn(),
      };
      route[stage].mockRejectedValue(new Error("PRIVATE cookie=session-secret"));
      // Even abort failure while recovering from fetch/fulfill must be contained.
      if (stage !== "abort") route.abort.mockRejectedValue(new Error("PRIVATE closed-context"));
      await expect(handler(route)).resolves.toBeUndefined();
      expect(route.fetch).toHaveBeenCalledWith({ maxRedirects: 0, maxRetries: 0, timeout: 65000 });
    });
    await expect(verifyStagingPersonas({ ...f, browserChat: true })).rejects.toThrow("Synthetic staging browser request failed.");
    expect(f.contexts.every(context => context.close.mock.calls.length === 1)).toBe(true);
  });
  it("drains an in-flight route rejected during context close before returning", async () => {
    const f = browserFixture(); let handlerDone = false;
    f.verifyJourney.mockImplementation(async () => {
      let rejectFetch;
      const context = f.contexts[3];
      context.close.mockImplementation(async () => rejectFetch(new Error("PRIVATE close")));
      const handler = context.route.mock.calls[0][1];
      void handler({
        request: () => ({ url: () => f.target.baseUrl + "/api/community/chat", method: () => "POST", redirectedFrom: () => null }),
        fetch: () => new Promise((resolve, reject) => { rejectFetch = reject; }),
        abort: async () => { await new Promise(resolve => { globalThis.setTimeout(resolve, 5); }); handlerDone = true; },
      });
    });
    await expect(verifyStagingPersonas({ ...f, browserChat: true })).rejects.toThrow("Synthetic staging browser request failed.");
    expect(handlerDone).toBe(true);
  });
  it("fails closed and closes contexts on wrong identity/auth status", async () => {
    const f = browserFixture({ failOwn: true });
    await expect(verifyStagingPersonas(f)).rejects.toThrow("Synthetic staging verification failed");
    expect(f.contexts[0].close).toHaveBeenCalledOnce();
    expect(f.contexts[0].request.post).not.toHaveBeenCalled();
  });
});
