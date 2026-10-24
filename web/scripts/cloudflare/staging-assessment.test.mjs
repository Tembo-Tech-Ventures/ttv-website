import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runStagingAssessment } from "./staging-assessment.mjs";
import { verifyStagingAssessment } from "./staging-assessment-verification.mjs";
const baseUrl="https://staging.tembotechventures.com", expectedVersion="a".repeat(40);
function runner() {
  const cleanup=vi.fn();
  const options={environment:{GITHUB_RUN_ATTEMPT:"1",CLOUDFLARE_ENVIRONMENT_NAME:"staging",STAGING_EXPECTED_SHA:expectedVersion},
    api:vi.fn(async()=>({bindings:[{name:"AI_GATEWAY_API_KEY",type:"secret_text"},{name:"AI_GATEWAY_ACCOUNT_ID",type:"plain_text",text:"fictional"},{name:"AI_GATEWAY_NAME",type:"plain_text",text:"fictional"}]})),
    validateRevision:vi.fn(),verifyTarget:vi.fn(async()=>({baseUrl,expectedVersion})),getBindings:vi.fn(()=>[{key:"BETTER_AUTH_SECRET",value:"fictional-test-only"}]),
    withPersonas:vi.fn(async({run})=>{try{await run({});}finally{await cleanup();}}),verifyAssessment:vi.fn(async()=>({synthetic:true})),discard:vi.fn(),publish:vi.fn(),publishFailure:vi.fn(),audit:vi.fn()};
  return {options,cleanup};
}
describe("assessment runner lifecycle",()=>{
  it.each(["AI_GATEWAY_API_KEY","AI_GATEWAY_ACCOUNT_ID","AI_GATEWAY_NAME"])("fails before fixture writes when %s is absent",async name=>{
    const {options}=runner(); const settings=await options.api(); settings.bindings=settings.bindings.filter(b=>b.name!==name);options.api.mockResolvedValue(settings);
    await expect(runStagingAssessment(options)).rejects.toThrow("Synthetic assessment failed");
    expect(options.withPersonas).not.toHaveBeenCalled();expect(options.verifyAssessment).not.toHaveBeenCalled();
    expect(options.publishFailure).toHaveBeenCalledWith(expect.objectContaining({stage:"provider-readiness",code:"required-binding-missing",claim:"unknown",cleanupStatus:"not-started"}));
  });
  it("retains only allowlisted assessment claim metadata before failure",async()=>{
    const {options}=runner();options.verifyAssessment.mockImplementation(async({progress})=>{
      progress({stage:"assessment",code:"assessment-response",claimed:false,assessmentStatus:"unavailable",assessmentErrorCode:"provider_unavailable",payloadBytes:0,payloadCharacters:0,body:"PRIVATE"});throw new Error("PRIVATE");
    });
    await expect(runStagingAssessment(options)).rejects.toThrow("Synthetic assessment failed");
    expect(options.publishFailure).toHaveBeenCalledWith(expect.objectContaining({claim:false,assessmentStatus:"unavailable",assessmentErrorCode:"provider_unavailable",payloadBytes:0,providerInvocation:"unknown"}));
    expect(JSON.stringify(options.publishFailure.mock.calls)).not.toContain("PRIVATE");
  });
  it("retains safe phase/status and independent cleanup after a hostile failure",async()=>{
    const {options}=runner();
    options.withPersonas.mockImplementation(async({run,audit})=>{
      try { await run({}); } finally { audit({event:"fixture-run-outcome",operation:"verification",operationStatus:"failed",cleanupStatus:"passed",token:"PRIVATE"}); }
    });
    options.verifyAssessment.mockImplementation(async({progress})=>{
      progress({stage:"assessment",code:"http-response",httpStatus:503,body:"PRIVATE"});
      progress({stage:"assessment",code:"validation-failed"});
      progress({stage:"PRIVATE",code:"PRIVATE",httpStatus:999});
      throw new Error("PRIVATE credential/provider body");
    });
    await expect(runStagingAssessment(options)).rejects.toThrow("Synthetic assessment failed");
    expect(options.publishFailure).toHaveBeenCalledWith(expect.objectContaining({stage:"assessment",code:"validation-failed",httpStatus:503,operationStatus:"failed",cleanupStatus:"passed",providerInvocation:"unknown",retryAllowed:false}));
    expect(JSON.stringify([options.publishFailure.mock.calls,options.audit.mock.calls])).not.toContain("PRIVATE");
    expect(options.publish).not.toHaveBeenCalled();
  });
  it("distinguishes cleanup failure from successful verification",async()=>{
    const {options}=runner();
    options.withPersonas.mockImplementation(async({run,audit})=>{
      await run({}); audit({event:"fixture-run-outcome",operation:"verification",operationStatus:"passed",cleanupStatus:"failed"});throw new Error("PRIVATE SQL");
    });
    await expect(runStagingAssessment(options)).rejects.toThrow("Synthetic assessment failed");
    expect(options.publishFailure).toHaveBeenCalledWith(expect.objectContaining({operationStatus:"passed",cleanupStatus:"failed"}));
    expect(options.publish).not.toHaveBeenCalled();
  });
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
    expect(workflow).toContain("path: web/test-results/staging-assessment/failure.json");
    expect(workflow).toContain("if: ${{ failure() }}");
    expect(workflow).not.toContain("test-results/staging-assessment/**");
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
  it.each([["unavailable","provider_unavailable",false],["invalid_output","invalid_output",true]])("retains %s and claim before rejecting the real HTTP response",async(status,errorCode,claimed)=>{
    const f=client(),{options}=runner();
    Object.assign(f.result.assessment,{status,errorCode,criteria:[]});f.result.probe.claimed=claimed;
    options.verifyAssessment.mockImplementation(({progress})=>verifyStagingAssessment({...f,progress}));
    await expect(runStagingAssessment(options)).rejects.toThrow("Synthetic assessment failed");
    expect(options.publishFailure).toHaveBeenCalledWith(expect.objectContaining({stage:"assessment",code:"validation-failed",httpStatus:200,assessmentStatus:status,assessmentErrorCode:errorCode,claim:claimed,providerInvocation:"unknown"}));
    expect(f.fetchImpl).toHaveBeenCalledTimes(5);
  });
  it("times out only the evidence POST after successful prerequisites without retry",async()=>{
    const f=client(),progress=vi.fn(),original=f.fetchImpl.getMockImplementation();let count=0;
    f.fetchImpl.mockImplementation(async(...args)=>{if(++count===5)throw new Error("PRIVATE timeout");return original(...args);});
    await expect(verifyStagingAssessment({...f,progress})).rejects.toThrow("Synthetic assessment verification failed");
    expect(progress).toHaveBeenLastCalledWith({stage:"assessment",code:"transport-failed"});expect(f.fetchImpl).toHaveBeenCalledTimes(5);
    expect(f.fetchImpl.mock.calls.filter(([url,o])=>url.includes(f.personas.member.userId)&&o.method==="POST"&&o.headers.Authorization.endsWith("fixture-institution"))).toHaveLength(1);
  });
  it.each([1,2,3,4,5,6])("reports the exact HTTP failure phase at call %s without reading error bodies",async call=>{
    const f=client(),progress=vi.fn(),original=f.fetchImpl.getMockImplementation();let count=0;
    f.fetchImpl.mockImplementation(async(...args)=>++count===call?new Response("PRIVATE",{status:500}):original(...args));
    await expect(verifyStagingAssessment({...f,progress})).rejects.toThrow("Synthetic assessment verification failed");
    const stage=["profile-write","journey-write","denied-role","no-evidence","assessment","consumed-session"][call-1];
    expect(progress).toHaveBeenCalledWith({stage,code:"http-response",httpStatus:500});
    expect(progress).toHaveBeenLastCalledWith({stage,code:"validation-failed"});
    expect(JSON.stringify(progress.mock.calls)).not.toContain("PRIVATE");expect(f.fetchImpl).toHaveBeenCalledTimes(call);
  });
  it("reports transport and JSON failure classes without raw error messages",async()=>{
    const f=client(),progress=vi.fn();f.fetchImpl.mockRejectedValue(new Error("PRIVATE"));
    await expect(verifyStagingAssessment({...f,progress})).rejects.toThrow("Synthetic assessment verification failed");
    expect(progress).toHaveBeenLastCalledWith({stage:"profile-write",code:"transport-failed"});
    f.fetchImpl.mockResolvedValue(new Response("PRIVATE",{status:200}));
    await expect(verifyStagingAssessment({...f,progress})).rejects.toThrow("Synthetic assessment verification failed");
    expect(progress).toHaveBeenLastCalledWith({stage:"profile-write",code:"response-json-invalid"});
    expect(JSON.stringify(progress.mock.calls)).not.toContain("PRIVATE");
  });
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
    await expect(verifyStagingAssessment(f)).rejects.toThrow("Synthetic assessment verification failed");
    expect(f.fetchImpl.mock.calls.filter(([url,o])=>url.includes(f.personas.member.userId)&&o.method==="POST"&&o.headers.Authorization.endsWith("fixture-institution")).length).toBeLessThanOrEqual(1);
  });
  it("rejects wrong origin before any request",async()=>{
    const f=client();f.target.baseUrl="https://tembotechventures.com";
    await expect(verifyStagingAssessment(f)).rejects.toThrow("Synthetic assessment verification failed");expect(f.fetchImpl).not.toHaveBeenCalled();
  });
});
