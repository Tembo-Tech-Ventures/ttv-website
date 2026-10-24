import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runStagingAssessment } from "./staging-assessment.mjs";
import { verifyStagingAssessment } from "./staging-assessment-verification.mjs";
const baseUrl="https://staging.tembotechventures.com", expectedVersion="a".repeat(40);
function runner() {
  const cleanup=vi.fn();
  const options={environment:{GITHUB_RUN_ATTEMPT:"1",CLOUDFLARE_ENVIRONMENT_NAME:"staging",STAGING_EXPECTED_SHA:expectedVersion},
    validateRevision:vi.fn(),verifyTarget:vi.fn(async()=>({baseUrl,expectedVersion})),getBindings:vi.fn(()=>[{key:"BETTER_AUTH_SECRET",value:"fictional-test-only"}]),
    withPersonas:vi.fn(async({run})=>{try{await run({});}finally{await cleanup();}}),verifyAssessment:vi.fn(async()=>({synthetic:true})),discard:vi.fn(),publish:vi.fn()};
  return {options,cleanup};
}
describe("assessment runner lifecycle",()=>{
  it("publishes only after target verification and successful cleanup",async()=>{
    const {options,cleanup}=runner();await runStagingAssessment(options);
    expect(options.validateRevision.mock.invocationCallOrder[0]).toBeLessThan(options.verifyTarget.mock.invocationCallOrder[0]);
    expect(options.verifyTarget.mock.invocationCallOrder[0]).toBeLessThan(options.withPersonas.mock.invocationCallOrder[0]);
    expect(cleanup.mock.invocationCallOrder[0]).toBeLessThan(options.publish.mock.invocationCallOrder[0]);
    expect(options.withPersonas).toHaveBeenCalledWith(expect.objectContaining({assessmentProbe:true}));
  });
  it.each(["2","3",undefined])("rejects workflow rerun %s without provisioning",async attempt=>{
    const {options}=runner();options.environment.GITHUB_RUN_ATTEMPT=attempt;
    await expect(runStagingAssessment(options)).rejects.toThrow("Synthetic assessment failed");
    expect(options.withPersonas).not.toHaveBeenCalled();expect(options.getBindings).not.toHaveBeenCalled();
  });
  it.each(["revision","target","production"])("rejects %s before provisioning",async stage=>{
    const {options}=runner();
    if(stage==="revision") options.validateRevision.mockRejectedValue(new Error("wrong SHA"));
    if(stage==="target") options.verifyTarget.mockRejectedValue(new Error("wrong origin"));
    if(stage==="production") options.environment.CLOUDFLARE_ENVIRONMENT_NAME="production";
    await expect(runStagingAssessment(options)).rejects.toThrow("Synthetic assessment failed");
    expect(options.withPersonas).not.toHaveBeenCalled();expect(options.getBindings).not.toHaveBeenCalled();
  });
  it.each(["timeout","invalid-output","cleanup"])("cleans and publishes nothing after %s",async stage=>{
    const {options,cleanup}=runner();
    if(stage==="cleanup")cleanup.mockRejectedValue(new Error("secret-bearing failure"));
    else options.verifyAssessment.mockRejectedValue(new Error("secret-bearing failure"));
    await expect(runStagingAssessment(options)).rejects.toThrow("Synthetic assessment failed");
    expect(cleanup).toHaveBeenCalledOnce();expect(options.publish).not.toHaveBeenCalled();expect(options.discard).toHaveBeenCalledTimes(2);
  });
  it("keeps credentials behind preflight and emits only a fixed metadata artifact",()=>{
    const workflow=readFileSync(new URL("../../../.github/workflows/cloudflare-staging-assessment.yml",import.meta.url),"utf8");
    expect(workflow).toContain("needs: preflight");expect(workflow).toContain("environment: staging");
    expect(workflow.split("  assess:")[0]).not.toContain("secrets.");
    expect(workflow).toContain('test "$GITHUB_RUN_ATTEMPT" = 1');
    expect(workflow).toContain("path: web/test-results/staging-assessment/manifest.json");
    expect(workflow).not.toContain("AI_GATEWAY_TOKEN");expect(workflow).not.toContain("playwright");
    const caller=readFileSync(new URL("../../../.github/workflows/cloudflare-staging.yml",import.meta.url),"utf8");
    expect(caller).toContain("group: ttv-cloudflare-staging");expect(caller).toContain("cancel-in-progress: false");
  });
});
function client() {
  const runId="b".repeat(24);
  const personas=Object.fromEntries(["member","otherMember","institution","unapprovedInstitution"].map(role=>[role,{runId,userId:`ttv-staging-fixture-${runId}-${role}`,personalAccessToken:`fixture-${role}`} ]));
  personas.institution.sessionId=`${personas.institution.userId}-assessment-session`;
  const criterion={criterionId:"typescript",status:"assessed",rating:3,explanation:"Untrusted text must not be published",citations:[{kind:"journey",id:"fixture-entry",version:1,userId:personas.member.userId,quote:"Private raw text"}]};
  const result={assessment:{status:"completed",model:"workers-ai/@cf/google/gemma-4-26b-a4b-it",subject:{userId:personas.member.userId},criteria:[criterion]},probe:{claimed:true,payloadBytes:4000,payloadCharacters:4000}};
  const fetchImpl=vi.fn(async(url,options)=>{
    if(options.method==="PUT")return Response.json({profile:{userId:personas.member.userId}});
    if(url.endsWith("/journey"))return Response.json({entry:{id:"fixture-entry",userId:personas.member.userId,version:1}},{status:201});
    if(options.headers.Authorization.endsWith("fixture-unapprovedInstitution"))return new Response(null,{status:403});
    if(url.includes(personas.otherMember.userId))return Response.json({assessment:{status:"completed",model:null,criteria:[{status:"insufficient",rating:null,citations:[]}]},probe:{claimed:false}});
    if(options.method==="POST")return Response.json(result);
    return new Response(null,{status:403});
  });
  return {personas,result,fetchImpl,target:{baseUrl,expectedVersion}};
}
describe("fixed assessment HTTP program",()=>{
  it("rejects an ordinary fixture source session before requests",async()=>{
    const f=client();f.personas.institution.sessionId=`${f.personas.institution.userId}-session`;
    await expect(verifyStagingAssessment(f)).rejects.toThrow("Synthetic assessment verification failed");expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("issues one evidence-bearing request and publishes only allowlisted fields",async()=>{
    const f=client();const result=await verifyStagingAssessment(f);
    expect(result).toMatchObject({assessmentRequests:1,providerAttemptClaimed:true,payloadBytes:4000,usage:"unavailable"});
    const serialized=JSON.stringify(result);expect(serialized).not.toContain("Untrusted text");expect(serialized).not.toContain("Private raw text");expect(serialized).not.toContain("fixture-institution");
    expect(f.fetchImpl.mock.calls.filter(([url,o])=>url.includes(f.personas.member.userId)&&o.method==="POST"&&o.headers.Authorization.endsWith("fixture-institution"))).toHaveLength(1);
    expect(f.fetchImpl.mock.calls.every(([,o])=>o.redirect==="error")).toBe(true);
  });
  it.each(["timeout","invalid","oversized-metadata"])("does not retry %s",async reason=>{
    const f=client();
    if(reason==="invalid") f.result.assessment.status="invalid_output";
    if(reason==="oversized-metadata") f.result.probe.payloadBytes=8001;
    if(reason==="timeout") f.fetchImpl.mockRejectedValue(new Error("timeout"));
    await expect(verifyStagingAssessment(f)).rejects.toThrow(reason==="timeout"?"timeout":"Synthetic assessment verification failed");
    expect(f.fetchImpl.mock.calls.filter(([url,o])=>url.includes(f.personas.member.userId)&&o.method==="POST"&&o.headers.Authorization.endsWith("fixture-institution")).length).toBeLessThanOrEqual(1);
  });
  it("rejects wrong origin before any request",async()=>{
    const f=client();f.target.baseUrl="https://tembotechventures.com";
    await expect(verifyStagingAssessment(f)).rejects.toThrow("Synthetic assessment verification failed");expect(f.fetchImpl).not.toHaveBeenCalled();
  });
});
