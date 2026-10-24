import { readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { createCommunityService } from "./service";
import { handleCommunityRequest } from "./http";
import { stagingAssessmentProbe } from "./staging-assessment-probe";
import type { StagingFixtureIdentity, StagingFixturePersona } from "../staging-fixtures";
const open: ReturnType<typeof createSqliteD1>[]=[];
afterEach(()=>{vi.unstubAllGlobals();for(const f of open.splice(0)) f.database.close();});
const runId="a".repeat(24);
function fixture() {
  const f=createSqliteD1();open.push(f);
  for(const name of readdirSync(new URL("../db/migrations/",import.meta.url)).filter(n=>n.endsWith(".sql")).toSorted()) f.database.exec(readMigration(name));
  f.database.exec(`INSERT INTO user(id,name,email) VALUES ('real','Real member','real@example.test');`);
  function add(persona:StagingFixturePersona,run=runId,probe=false) {
    const userId=`ttv-staging-fixture-${run}-${persona}`;
    const now=Math.floor(Date.now()/1000),expiresAt=now+1800,sessionId=probe?`${userId}-assessment-session`:`session-${userId}`;
    f.database.prepare("INSERT INTO user(id,name,email) VALUES(?,?,?)").run(userId,persona,`${userId}@invalid.ttv`);
    f.database.prepare("INSERT INTO session(id,userId,token,userAgent,createdAt,expiresAt) VALUES(?,?,?,?,?,?)").run(sessionId,userId,`test-only-${userId}`,`ttv-agent:synthetic-staging:${run}`,now-10,now+3600);
    f.database.prepare("INSERT INTO stagingFixtureIdentity(userId,sessionId,runId,persona,expiresAt) VALUES(?,?,?,?,?)").run(userId,sessionId,run,persona,expiresAt);
    const role=({mentor:"MENTOR",institution:"INSTITUTION",admin:"ADMIN"} as Record<string,string>)[persona];
    if(role) f.database.prepare('INSERT INTO UserRoles(id,userId,roleId) SELECT ?,?,id FROM Roles WHERE name=?').run(`grant-${userId}`,userId,role);
    const identity:StagingFixtureIdentity={userId,runId:run,persona,expiresAt,...(probe?{assessmentProbe:true as const}:{})};
    return {identity,service:createCommunityService(f.db,userId,identity,"staging")};
  }
  return {...f,add};
}
const entry={title:"Published test",description:"Synthetic evidence",occurredAt:"2026-10-24",visibility:"institution"};
describe("synthetic assessment durable claim", () => {
 it.each(["expiresAt=0", "userAgent='tampered'", "createdAt=unixepoch()+30"])("rejects source-session race at atomic consume: %s", async mutation => {
   const f=fixture(), institution=f.add("institution",runId,true);
   const db=Object.create(f.db) as D1Database;
   db.prepare=(sql:string)=>{
     if(sql.startsWith('DELETE FROM "session"')) f.database.prepare(`UPDATE session SET ${mutation} WHERE userId=?`).run(institution.identity.userId);
     return f.db.prepare(sql);
   };
   const probe=stagingAssessmentProbe(db,"staging",{id:institution.identity.userId,fixture:institution.identity})!;
   await expect(probe.claim()).rejects.toMatchObject({status:403});
   expect(f.database.prepare('SELECT id FROM session WHERE userId=?').get(institution.identity.userId)).toBeDefined();
 });
 it("never consumes an ordinary browser fixture even if a probe flag is forged internally", async () => {
   const f=fixture(), institution=f.add("institution");
   const actor={id:institution.identity.userId,fixture:institution.identity};
   expect(stagingAssessmentProbe(f.db,"staging",actor)).toBeUndefined();
   const forged=stagingAssessmentProbe(f.db,"staging",{...actor,fixture:{...institution.identity,assessmentProbe:true}})!;
   await expect(forged.claim()).rejects.toThrow("already consumed");
   expect(f.database.prepare('SELECT id FROM session WHERE userId=?').get(institution.identity.userId)).toBeDefined();
 });
 it("uses the deployed route with one provider binding call, then rejects replay", async () => {
   const f=fixture(), institution=f.add("institution",runId,true), member=f.add("member"), empty=f.add("otherMember");
   const journey=await member.service.createJourney(entry);
   const inference=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({criteria:[{criterionId:"test",status:"assessed",rating:2,explanation:"Synthetic self-report with limitations",citations:[{kind:"journey",id:journey.id,version:journey.version}]}]})}}]}));
   vi.stubGlobal("fetch",inference);
   const env={DEPLOYMENT_ENVIRONMENT:"staging",AI_GATEWAY_ACCOUNT_ID:"account",AI_GATEWAY_NAME:"gateway",AI:{run:inference}} as unknown as Env;
   const actor={id:institution.identity.userId,fixture:institution.identity,scopes:["institution:read"]};
   const body={id:"test",version:1,criteria:[{id:"test",label:"Documented evidence",terms:["test"]}]};
   const invoke=(userId:string)=>handleCommunityRequest(new Request(`https://ttv.test/api/community/profiles/${userId}/assessment`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),`profiles/${userId}/assessment`,actor,f.db,env);
   const noEvidence=await (await invoke(empty.identity.userId)).json();
   expect(noEvidence).toMatchObject({assessment:{model:null,status:"completed"},probe:{claimed:false}});expect(inference).not.toHaveBeenCalled();
   const result=await (await invoke(member.identity.userId)).json() as {probe:{payloadBytes:number}};
   expect(result).toMatchObject({assessment:{status:"completed"},probe:{claimed:true}});
   expect(result.probe.payloadBytes).toBeLessThanOrEqual(8000);expect(inference).toHaveBeenCalledOnce();
   expect((await invoke(member.identity.userId)).status).toBe(403);expect(inference).toHaveBeenCalledOnce();
 });
 it("denies missing role and cross-run source before inference or session consumption", async () => {
   const f=fixture(), institution=f.add("institution",runId,true), member=f.add("member","b".repeat(24)), unapproved=f.add("unapprovedInstitution");
   const inference=vi.fn();vi.stubGlobal("fetch",inference);
   const env={DEPLOYMENT_ENVIRONMENT:"staging"} as unknown as Env;
   const path=`profiles/${member.identity.userId}/assessment`;
   const request=()=>new Request(`https://ttv.test/api/community/${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:"test",version:1,criteria:[{id:"test",label:"Evidence",terms:["test"]}]})});
   expect((await handleCommunityRequest(request(),path,{id:institution.identity.userId,fixture:institution.identity,scopes:["institution:read"]},f.db,env)).status).toBe(403);
   expect((await handleCommunityRequest(request(),path,{id:unapproved.identity.userId,fixture:unapproved.identity,scopes:["institution:read"]},f.db,env)).status).toBe(403);
   expect(inference).not.toHaveBeenCalled();
   expect(f.database.prepare('SELECT id FROM session WHERE userId=?').get(institution.identity.userId)).toBeDefined();
 });
 it.each(["timeout","invalid-output"])("never restores the claim after %s", async failure => {
   const f=fixture(), institution=f.add("institution",runId,true), member=f.add("member");
   await member.service.createJourney(entry);
   const inference=vi.fn();
   if(failure==="timeout")inference.mockRejectedValue(new Error("private provider failure"));
   else inference.mockResolvedValue(Response.json({choices:[{finish_reason:"stop",message:{content:"invalid"}}]}));
   vi.stubGlobal("fetch",inference);
   const env={DEPLOYMENT_ENVIRONMENT:"staging",AI_GATEWAY_ACCOUNT_ID:"account",AI_GATEWAY_NAME:"gateway",AI:{run:inference}} as unknown as Env;
   const path=`profiles/${member.identity.userId}/assessment`;
   const response=await handleCommunityRequest(new Request(`https://ttv.test/api/community/${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:"test",version:1,criteria:[{id:"test",label:"Evidence",terms:["test"]}]})}),path,{id:institution.identity.userId,fixture:institution.identity,scopes:["institution:read"]},f.db,env);
   const result=await response.json() as {assessment:{status:string};probe:{claimed:boolean}};expect(result.assessment.status).toBe(failure==="timeout"?"unavailable":"invalid_output");
   expect(result.probe.claimed).toBe(true);expect(inference).toHaveBeenCalledOnce();
   expect(JSON.stringify(result)).not.toContain("private provider failure");
   expect(f.database.prepare('SELECT id FROM session WHERE userId=?').get(institution.identity.userId)).toBeUndefined();
 });
 it("allows only one concurrent claim and invalidates subsequent scoped reads", async () => {
   const f=fixture(), institution=f.add("institution",runId,true), member=f.add("member");
   const actor={id:institution.identity.userId,fixture:institution.identity};
   const first=stagingAssessmentProbe(f.db,"staging",actor)!;
   const second=stagingAssessmentProbe(f.db,"staging",actor)!;
   const results=await Promise.allSettled([first.claim(),second.claim()]);
   expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
   expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
   await expect(institution.service.getProfile(member.identity.userId)).rejects.toMatchObject({status:403});
   expect(f.database.prepare('SELECT id FROM session WHERE userId=?').get(member.identity.userId)).toBeDefined();
 });
 it("does not expose the mode to production, unapproved roles or forged identity", () => {
   const f=fixture(), institution=f.add("institution",runId,true), member=f.add("member");
   expect(()=>stagingAssessmentProbe(f.db,"production",{id:institution.identity.userId,fixture:institution.identity})).toThrow("Synthetic assessment requires");
   expect(()=>stagingAssessmentProbe(f.db,"staging",{id:member.identity.userId,fixture:{...member.identity,assessmentProbe:true}})).toThrow("Synthetic assessment requires");
   expect(()=>stagingAssessmentProbe(f.db,"staging",{id:"real",fixture:institution.identity})).toThrow("Synthetic assessment requires");
   expect(()=>stagingAssessmentProbe(f.db,"staging",{id:institution.identity.userId})).toThrow("Verified staging fixture required");
   expect(stagingAssessmentProbe(f.db,"production",{id:"real"})).toBeUndefined();
   expect(f.database.prepare('SELECT id FROM session WHERE userId=?').get(institution.identity.userId)).toBeDefined();
 });
 it("fails closed on expired live registration without consuming another identity", async () => {
   const f=fixture(), institution=f.add("institution",runId,true);
   const probe=stagingAssessmentProbe(f.db,"staging",{id:institution.identity.userId,fixture:institution.identity})!;
   f.database.prepare('UPDATE stagingFixtureIdentity SET expiresAt=0 WHERE userId=?').run(institution.identity.userId);
   await expect(probe.claim()).rejects.toThrow("invalid or expired");
   expect(f.database.prepare('SELECT id FROM session WHERE userId=?').get(institution.identity.userId)).toBeDefined();
 });
});
describe("registered synthetic service confinement",()=>{
 it("scouts only same-run synthetic people and never real or other-run records",async()=>{
   const f=fixture();const member=f.add("member"),institution=f.add("institution"),other=f.add("member","b".repeat(24));
   await member.service.createJourney(entry);await other.service.createJourney(entry);await createCommunityService(f.db,"real").createJourney(entry);
   expect(()=>createCommunityService(f.db,member.identity.userId)).toThrow("Verified staging fixture context");
   const found=await institution.service.searchProfiles({});
   expect(found.map(p=>p.userId)).toEqual(expect.arrayContaining([member.identity.userId,institution.identity.userId]));
   expect(found.every(p=>p.userId.startsWith(`ttv-staging-fixture-${runId}-`))).toBe(true);
   await expect(institution.service.getProfile("real")).rejects.toMatchObject({status:403});
   await expect(institution.service.getProfile(other.identity.userId)).rejects.toMatchObject({status:403});
   expect(await institution.service.listJourney(member.identity.userId)).toHaveLength(1);
 });
 it("limits mentor review and confirmations to the same run",async()=>{
   const f=fixture();const member=f.add("member"),mentor=f.add("mentor"),other=f.add("member","b".repeat(24));
   const claim=await member.service.createJourney(entry),foreign=await other.service.createJourney(entry),real=await createCommunityService(f.db,"real").createJourney(entry);
   expect((await mentor.service.listMentorship()).map(j=>j.id)).toEqual([claim.id]);
   const body={expectedRevision:1,statement:"I inspected this synthetic artifact",method:"Fixture review"};
   await expect(mentor.service.confirmJourney(real.id,body)).rejects.toMatchObject({status:404});
   await expect(mentor.service.confirmJourney(foreign.id,body)).rejects.toMatchObject({status:404});
   expect(await mentor.service.confirmJourney(claim.id,body)).toMatchObject({journeyVersion:1,mentorRole:"MENTOR"});
 });
 it("permits browser synthetic admin grants only to live same-run fixtures",async()=>{
   const f=fixture();const admin=f.add("admin"),target=f.add("unapprovedInstitution"),foreign=f.add("member","b".repeat(24));
   await expect(admin.service.setAccess({userId:"real",role:"INSTITUTION",granted:true})).rejects.toMatchObject({status:403});
   await expect(admin.service.setAccess({userId:foreign.identity.userId,role:"INSTITUTION",granted:true})).rejects.toMatchObject({status:403});
   const request=()=>new Request("https://ttv.test/api/community/access",{method:"POST",headers:{Origin:"https://ttv.test"},body:JSON.stringify({userId:target.identity.userId,role:"INSTITUTION",granted:true})});
   const actor={id:admin.identity.userId,scopes:null,delegatedSession:true,fixture:admin.identity};
   const env={DEPLOYMENT_ENVIRONMENT:"staging"} as unknown as Env;
   expect((await handleCommunityRequest(request(),"access",actor,f.db,env)).status).toBe(200);
   expect((await target.service.access()).isInstitution).toBe(true);
   expect((await handleCommunityRequest(request(),"access",{...actor,scopes:["community:write"]},f.db,env)).status).toBe(403);
   await admin.service.setAccess({userId:target.identity.userId,role:"INSTITUTION",granted:false});
   expect((await target.service.access()).isInstitution).toBe(false);
 });
 it("permits only verified browser mentor exemptions and keeps expired fixtures closed",async()=>{
   const f=fixture();const member=f.add("member"),mentor=f.add("mentor");await member.service.createJourney(entry);
   const request=()=>new Request("https://ttv.test/api/community/mentorship");
   const actor={id:mentor.identity.userId,scopes:null,delegatedSession:true,fixture:mentor.identity};
   const env={DEPLOYMENT_ENVIRONMENT:"staging"} as unknown as Env;
   expect((await handleCommunityRequest(request(),"mentorship",actor,f.db,env)).status).toBe(200);
   expect((await handleCommunityRequest(request(),"mentorship",{...actor,fixture:null},f.db,env)).status).toBe(403);
   f.database.prepare("UPDATE stagingFixtureIdentity SET expiresAt=? WHERE userId=?").run(Math.floor(Date.now()/1000)-1,mentor.identity.userId);
   expect((await handleCommunityRequest(request(),"mentorship",actor,f.db,env)).status).toBe(403);
   await expect(mentor.service.createJourney(entry)).rejects.toMatchObject({status:403});
 });
});
