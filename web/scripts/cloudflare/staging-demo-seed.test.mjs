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
    await expect(runDemoSeed(env,deps)).rejects.toThrow("stop");expect(deps.seed).not.toHaveBeenCalled();
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
