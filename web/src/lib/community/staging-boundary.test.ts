import { readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { createCommunityService } from "./service";
import { handleCommunityRequest } from "./http";
import type { StagingFixtureIdentity, StagingFixturePersona } from "../staging-fixtures";
const open: ReturnType<typeof createSqliteD1>[]=[];
afterEach(()=>{for(const f of open.splice(0)) f.database.close();});
const runId="a".repeat(24);
function fixture() {
  const f=createSqliteD1();open.push(f);
  for(const name of readdirSync(new URL("../db/migrations/",import.meta.url)).filter(n=>n.endsWith(".sql")).toSorted()) f.database.exec(readMigration(name));
  f.database.exec(`INSERT INTO user(id,name,email) VALUES ('real','Real member','real@example.test');`);
  function add(persona:StagingFixturePersona,run=runId) {
    const userId=`ttv-staging-fixture-${run}-${persona}`;
    const now=Math.floor(Date.now()/1000),expiresAt=now+1800,sessionId=`session-${userId}`;
    f.database.prepare("INSERT INTO user(id,name,email) VALUES(?,?,?)").run(userId,persona,`${userId}@invalid.ttv`);
    f.database.prepare("INSERT INTO session(id,userId,token,userAgent,createdAt,expiresAt) VALUES(?,?,?,?,?,?)").run(sessionId,userId,`test-only-${userId}`,`ttv-agent:synthetic-staging:${run}`,now-10,now+3600);
    f.database.prepare("INSERT INTO stagingFixtureIdentity(userId,sessionId,runId,persona,expiresAt) VALUES(?,?,?,?,?)").run(userId,sessionId,run,persona,expiresAt);
    const role=({mentor:"MENTOR",institution:"INSTITUTION",admin:"ADMIN"} as Record<string,string>)[persona];
    if(role) f.database.prepare('INSERT INTO UserRoles(id,userId,roleId) SELECT ?,?,id FROM Roles WHERE name=?').run(`grant-${userId}`,userId,role);
    const identity:StagingFixtureIdentity={userId,runId:run,persona,expiresAt};
    return {identity,service:createCommunityService(f.db,userId,identity,"staging")};
  }
  return {...f,add};
}
const entry={title:"Published test",description:"Synthetic evidence",occurredAt:"2026-10-24",visibility:"institution"};
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
   const env={DEPLOYMENT_ENVIRONMENT:"staging"} as Env;
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
   const env={DEPLOYMENT_ENVIRONMENT:"staging"} as Env;
   expect((await handleCommunityRequest(request(),"mentorship",actor,f.db,env)).status).toBe(200);
   expect((await handleCommunityRequest(request(),"mentorship",{...actor,fixture:null},f.db,env)).status).toBe(403);
   f.database.prepare("UPDATE stagingFixtureIdentity SET expiresAt=? WHERE userId=?").run(Math.floor(Date.now()/1000)-1,mentor.identity.userId);
   expect((await handleCommunityRequest(request(),"mentorship",actor,f.db,env)).status).toBe(403);
   await expect(mentor.service.createJourney(entry)).rejects.toMatchObject({status:403});
 });
});
