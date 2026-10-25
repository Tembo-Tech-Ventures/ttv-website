import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runDemoSeed } from "./staging-demo-seed.mjs";
const sha = "a".repeat(40);
const env = { STAGING_ACTION: "seed-demo", GITHUB_RUN_ATTEMPT: "1", CLOUDFLARE_ENVIRONMENT_NAME: "staging", CLOUDFLARE_ACCOUNT_ID: "account" };
function setup() {
  const target = {};
  return { validate: vi.fn().mockResolvedValue({sha}), verify: vi.fn().mockResolvedValue(target), seed: vi.fn().mockResolvedValue({profiles:150,cohortMembers:74,privateData:"never print"}), api: vi.fn() };
}
describe("retained seed executor", () => {
  it("checks current revision and actual deployment before one seed operation", async () => {
    const deps = setup();
    expect(await runDemoSeed(env,deps)).toEqual({event:"retained-demo-seeded",version:sha,profiles:150,cohortMembers:74,retained:true});
    expect(deps.verify).toHaveBeenCalledWith(expect.objectContaining({expectedVersion:sha,environmentName:"staging",baseUrl:"https://staging.tembotechventures.com"}));
    expect(deps.seed).toHaveBeenCalledTimes(1);
    expect(deps.validate.mock.invocationCallOrder[0]).toBeLessThan(deps.verify.mock.invocationCallOrder[0]);
    expect(deps.verify.mock.invocationCallOrder[0]).toBeLessThan(deps.seed.mock.invocationCallOrder[0]);
  });
  it.each(["validate","verify"])("does not seed after %s failure",async stage=>{
    const deps=setup();deps[stage].mockRejectedValue(new Error("stop"));
    await expect(runDemoSeed(env,deps)).rejects.toThrow("Retained demo seed failed.");expect(deps.seed).not.toHaveBeenCalled();
  });
  it("rejects reruns and wrong action before all work",async()=>{
    for(const overrides of [{GITHUB_RUN_ATTEMPT:"2"},{STAGING_ACTION:"deploy"}]) {
      const deps=setup();await expect(runDemoSeed({...env,...overrides},deps)).rejects.toThrow("One seed-demo dispatch is required.");expect(deps.validate).not.toHaveBeenCalled();expect(deps.seed).not.toHaveBeenCalled();
    }
  });
  it("keeps seed under the staging lock with no auth secrets or activation",()=>{
    const workflow=readFileSync(new URL("../../../.github/workflows/cloudflare-staging.yml",import.meta.url),"utf8");
    const job=workflow.split("\n  seed-demo:\n")[1];
    expect(workflow).toContain("group: ttv-cloudflare-staging\n  cancel-in-progress: false");
    expect(job).toContain("needs: preflight");expect(job).toContain("environment: staging");
    expect(job).not.toMatch(/BETTER_AUTH_SECRET|STAGING_AGENT_TOKEN|STAGING_DEMO_ENABLED|wrangler/);
  });
});

it("reports only safe stages and counts when an adapter query fails", async () => {
  const deps = setup();
  deps.verify.mockImplementation(async ({api}) => ({ executeQuery: (sql,params) => api("/d1/database/8df53ce1-0e9d-4e51-aaac-329f84cf1d5f/query", {method:"POST",body:{sql,params}}) }));
  deps.api.mockResolvedValueOnce([{results:[]}]).mockRejectedValueOnce(new Error("private SQL credential value"));
  deps.seed.mockImplementation(async target => {
    await target.executeQuery("SELECT id FROM user",[]);
    await target.executeQuery("INSERT INTO user VALUES (?)",["private"]);
  });
  const error = await runDemoSeed(env,deps).catch(caught => caught);
  expect(error.message).toBe("Retained demo seed failed.");
  expect(error.diagnostic).toEqual({event:"retained-demo-seed-failed",stage:"seed-write",readsCompleted:1,writesAttempted:1,writesCompleted:0,writeState:"partial-or-complete-unknown"});
  expect(JSON.stringify(error)).not.toMatch(/private|credential|INSERT/);
});
it("marks a target failure as before writes without exposing its error", async () => {
  const deps = setup();
  deps.verify.mockImplementation(async ({api}) => { await api(""); });
  deps.api.mockRejectedValue(new Error("private account response"));
  const error = await runDemoSeed(env,deps).catch(caught => caught);
  expect(error.diagnostic).toMatchObject({stage:"account",writesAttempted:0,writeState:"not-started"});
  expect(deps.seed).not.toHaveBeenCalled();
});

it("uses the real cfApi and target adapter with Cloudflare response envelopes", async () => {
  const accountId = "a".repeat(32), dbId = "8df53ce1-0e9d-4e51-aaac-329f84cf1d5f";
  const queries = [];
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", accountId);
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-only");
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    const path = new URL(url).pathname;
    if (path === "/api/health") return Response.json({service:"ttv-website",environment:"staging",version:sha,checks:{db:"ok"}});
    let result;
    if (path.endsWith("/query")) {
      queries.push(JSON.parse(options.body));
      result = [{success:true,results:[{total:150}]}];
    } else if (path.endsWith("/settings")) result = {bindings:[
      {name:"DB",type:"d1",id:dbId},{name:"DEPLOYMENT_ENVIRONMENT",text:"staging"},
      {name:"DEPLOYMENT_VERSION",text:sha},{name:"PRIMARY_DOMAIN",text:"staging.tembotechventures.com"},
      {name:"BETTER_AUTH_URL",text:"https://staging.tembotechventures.com"}]};
    else if (path.endsWith(dbId)) result = {uuid:dbId,name:"ttv-website-db-staging"};
    else result = {id:accountId};
    return Response.json({success:true,result});
  }));
  try {
    const receipt = await runDemoSeed({...env,CLOUDFLARE_ACCOUNT_ID:accountId}, {
      validate: async () => ({sha}),
      seed: async target => {
        const result = await target.executeQuery("SELECT COUNT(*) AS total FROM user WHERE id=?",["fixture"]);
        expect(result).toEqual([{success:true,results:[{total:150}]}]);
        return {profiles:150,cohortMembers:74};
      },
    });
    expect(receipt.profiles).toBe(150);
    expect(queries).toEqual([{sql:"SELECT COUNT(*) AS total FROM user WHERE id=?",params:["fixture"]}]);
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});
