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

import { runDemoDiagnostic, DIAGNOSTIC_DEPLOYED_SHA } from "./staging-demo-seed.mjs";
const diagnosticEnv = {...env, STAGING_ACTION:"diagnose-demo", STAGING_EXPECTED_DEPLOYED_SHA:DIAGNOSTIC_DEPLOYED_SHA};
it("diagnoses separate exact live identity using only aggregate SELECTs", async () => {
  const queries = [];
  const executeQuery = vi.fn(async (sql,params) => {
    queries.push({sql,params});
    return [{success:true,results:[{total:sql.includes('"Roles"') ? Number(params[0] !== "STUDENT") : 0, privateData:"discard"}]}];
  });
  const deps = {validate:vi.fn().mockResolvedValue({sha}),verify:vi.fn().mockResolvedValue({executeQuery})};
  const result = await runDemoDiagnostic(diagnosticEnv,deps);
  expect(deps.verify).toHaveBeenCalledWith(expect.objectContaining({expectedVersion:DIAGNOSTIC_DEPLOYED_SHA}));
  expect(result).toMatchObject({executorVersion:sha,deployedVersion:DIAGNOSTIC_DEPLOYED_SHA,requiredRoles:{MENTOR:true,INSTITUTION:true,STUDENT:false}});
  expect(Object.values(result.ownedCounts).every(count=>count===0)).toBe(true);
  expect(queries.every(({sql,params})=>sql.startsWith("SELECT COUNT(*) AS total FROM ") && params.length<=40)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/privateData|discard|invalid.ttv|member-/);
});
it.each([{STAGING_ACTION:"seed-demo"},{GITHUB_RUN_ATTEMPT:"2"},{STAGING_EXPECTED_DEPLOYED_SHA:sha}])("rejects diagnostic guard mismatch before access: %j",async overrides=>{
  const deps=setup();
  await expect(runDemoDiagnostic({...diagnosticEnv,...overrides},deps)).rejects.toThrow("Read-only retained demo diagnostic failed");
  expect(deps.validate).not.toHaveBeenCalled();expect(deps.verify).not.toHaveBeenCalled();
});
it.each(["revision","identity","query","shape"])("fails closed and redacts diagnostic %s failure", async stage=>{
  const executeQuery=vi.fn().mockResolvedValue([{results:[{total:"private"}]}]);
  const deps={validate:vi.fn().mockResolvedValue({sha}),verify:vi.fn().mockResolvedValue({executeQuery})};
  if(stage==="revision")deps.validate.mockRejectedValue(new Error("private"));
  if(stage==="identity")deps.verify.mockRejectedValue(new Error("private"));
  if(stage==="query")executeQuery.mockRejectedValue(new Error("private"));
  await expect(runDemoDiagnostic(diagnosticEnv,deps)).rejects.toThrow("Read-only retained demo diagnostic failed; no record values emitted.");
  if(["revision","identity"].includes(stage))expect(executeQuery).not.toHaveBeenCalled();
});
it("does not let a separate diagnostic SHA alter the mutating seed target",async()=>{
  const deps=setup();await expect(runDemoSeed({...env,STAGING_EXPECTED_DEPLOYED_SHA:DIAGNOSTIC_DEPLOYED_SHA},deps)).rejects.toThrow("One seed-demo dispatch is required.");
  expect(deps.verify).not.toHaveBeenCalled();
});

import { verifyDemoImageAssets } from "./staging-demo-seed.mjs";
const imageManifest = {version:1,synthetic:true,portraits:Array.from({length:7},(_,i)=>({src:`/images/demo/portrait-${String(i+1).padStart(2,"0")}.webp`,provenance:"AI-generated",alt:"AI-generated fictional adult"}))};
function imageSetup() {
  return {...setup(),loadImageManifest:vi.fn().mockResolvedValue(imageManifest),verifyImages:vi.fn().mockResolvedValue(undefined),seedImages:vi.fn().mockResolvedValue(undefined)};
}
it.each([undefined,"false",""])("leaves images untouched when option is %s",async option=>{
  const deps=imageSetup();await runDemoSeed({...env,STAGING_DEMO_IMAGES:option},deps);
  expect(deps.loadImageManifest).not.toHaveBeenCalled();expect(deps.verifyImages).not.toHaveBeenCalled();expect(deps.seedImages).not.toHaveBeenCalled();
});
it("checks live assets before seed and backfills only after successful seed",async()=>{
  const deps=imageSetup();
  expect(await runDemoSeed({...env,STAGING_DEMO_IMAGES:"true"},deps)).toMatchObject({version:sha,images:"backfill-completed"});
  const order=[deps.verify,deps.loadImageManifest,deps.verifyImages,deps.seed,deps.seedImages].map(fn=>fn.mock.invocationCallOrder[0]);
  expect(order).toEqual(order.toSorted((a,b)=>a-b));
  expect(deps.seedImages).toHaveBeenCalledWith(await deps.verify.mock.results[0].value,imageManifest);
});
it.each(["verify","loadImageManifest","verifyImages","seed"])("prevents image writes after %s fails",async stage=>{
  const deps=imageSetup();deps[stage].mockRejectedValue(new Error("private details"));
  const error=await runDemoSeed({...env,STAGING_DEMO_IMAGES:"true"},deps).catch(e=>e);
  expect(deps.seedImages).not.toHaveBeenCalled();
  if(stage!=="seed")expect(deps.seed).not.toHaveBeenCalled();
  expect(JSON.stringify(error)).not.toContain("private");
});
it("redacts image helper failure and does not retry",async()=>{
  const deps=imageSetup();deps.seedImages.mockRejectedValue(new Error("private record"));
  const error=await runDemoSeed({...env,STAGING_DEMO_IMAGES:"true"},deps).catch(e=>e);
  expect(error.diagnostic.stage).toBe("image-backfill");expect(deps.seedImages).toHaveBeenCalledTimes(1);expect(JSON.stringify(error)).not.toContain("private");
});
it.each(["TRUE","yes","1"])("rejects malformed image option %s",async option=>{
  const deps=imageSetup();await expect(runDemoSeed({...env,STAGING_DEMO_IMAGES:option},deps)).rejects.toThrow("Invalid demo images");expect(deps.validate).not.toHaveBeenCalled();
});
it("rejects images in direct read-only diagnostic",async()=>{
  const deps=setup();await expect(runDemoDiagnostic({...diagnosticEnv,STAGING_DEMO_IMAGES:"true"},deps)).rejects.toThrow("diagnostic failed");expect(deps.validate).not.toHaveBeenCalled();
});
it("checks exactly seven fixed-origin WebP assets without auth or redirects",async()=>{
  const fetchImpl=vi.fn().mockImplementation(async()=>new Response(null,{status:200,headers:{"content-type":"image/webp"}}));
  await verifyDemoImageAssets(imageManifest,{fetchImpl});expect(fetchImpl).toHaveBeenCalledTimes(7);
  fetchImpl.mock.calls.forEach(([url,options],i)=>{
    expect(url.href).toBe(`https://staging.tembotechventures.com/images/demo/portrait-0${i+1}.webp`);
    expect(options).toMatchObject({method:"HEAD",redirect:"error"});expect(options.headers).toBeUndefined();expect(options.signal).toBeInstanceOf(globalThis.AbortSignal);
  });
});
it.each([404,302,"html","network"])("fails closed on asset %s before any retries",async failure=>{
  const fetchImpl=vi.fn().mockImplementation(async()=>{
    if(failure==="network")throw new Error("network");
    return new Response(null,{status:typeof failure==="number"?failure:200,headers:{"content-type":failure==="html"?"text/html":"image/webp"}});
  });
  await expect(verifyDemoImageAssets(imageManifest,{fetchImpl})).rejects.toThrow(/assets|network/);expect(fetchImpl).toHaveBeenCalledTimes(1);
});
