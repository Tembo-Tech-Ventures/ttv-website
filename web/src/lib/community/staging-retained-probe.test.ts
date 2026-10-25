import { afterEach, describe, expect, it } from "vitest";
import { createSqliteD1, MINIMAL_AUTH_SCHEMA, readMigration } from "@/test/sqlite-d1";
import { resolveStagingFixtureIdentity, retainedProbeMarker, verifyRetainedProbeTarget, type StagingFixturePersona } from "../staging-fixtures";
import { DEMO_USER_IDS, DEMO_CUTOFF } from "../staging-demo-policy";
import { createCommunityService } from "./service";
import { authorizeRetainedProbe, claimRetainedChat } from "./staging-retained-probe";
const databases: ReturnType<typeof createSqliteD1>[]=[];
afterEach(()=>{for(const d of databases.splice(0)) d.database.close();});
function fixture(persona: StagingFixturePersona = "institution") {
 const f=createSqliteD1(); databases.push(f); const sql=f.database;
 sql.exec(MINIMAL_AUTH_SCHEMA+`CREATE TABLE session(id TEXT PRIMARY KEY,userId TEXT,userAgent TEXT,createdAt INTEGER,expiresAt INTEGER);
  INSERT INTO Roles VALUES('i','INSTITUTION');`+readMigration("0019_staging_fixture_identity.sql"));
 const now=new Date(), seconds=Math.floor(now.getTime()/1000), runId="a".repeat(24), id=`ttv-staging-fixture-${runId}-${persona}`, expiresAt=Math.min(seconds+800,DEMO_CUTOFF);
 sql.prepare("INSERT INTO user(id,name,email) VALUES(?,?,?)").run(id,"Fixture",`${id}@invalid.ttv`);
 sql.prepare("INSERT INTO session VALUES(?,?,?,?,?)").run(`${id}-retained-read-probe-session`,id,retainedProbeMarker(runId),seconds-10,expiresAt);
 sql.prepare("INSERT INTO stagingFixtureIdentity VALUES(?,?,?,?,?)").run(id,`${id}-retained-read-probe-session`,runId,persona,expiresAt);
 if(persona==="institution") sql.prepare("INSERT INTO UserRoles VALUES('r',?,'i')").run(id);
 const args={db:f.db,envName:"staging",user:{id,email:`${id}@invalid.ttv`},session:{id:"pat:x",userAgent:"ttv-pat:x"},isPat:true,retainedProbeEnabled:"true",now};
 return {...f,args,id};
}
describe("retained read probe boundary",()=>{
 it("requires exact staging flag, registered PAT identity, expiry and marker",async()=>{
  const f=fixture(); expect(await resolveStagingFixtureIdentity(f.args)).toMatchObject({retainedReadProbe:true});
  for(const change of [{retainedProbeEnabled:undefined},{envName:"production"},{isPat:false},{now:new Date(DEMO_CUTOFF*1000)}]) await expect(resolveStagingFixtureIdentity({...f.args,...change})).rejects.toMatchObject({status:403});
  f.database.exec("UPDATE session SET expiresAt=createdAt+901"); await expect(resolveStagingFixtureIdentity(f.args)).rejects.toMatchObject({status:403});
 });
 it("atomic concurrent claims allow one only, keep tools live, and never reset after failure",async()=>{
  const f=fixture(), actor=await resolveStagingFixtureIdentity(f.args); if(!actor)throw Error();
  const results=await Promise.allSettled([claimRetainedChat(f.db,"staging",actor),claimRetainedChat(f.db,"staging",actor)]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(await resolveStagingFixtureIdentity(f.args)).toMatchObject({retainedReadProbe:true});
  await expect(claimRetainedChat(f.db,"staging",actor)).rejects.toMatchObject({status:403});
  const target=DEMO_USER_IDS[0]; f.database.prepare("INSERT INTO user(id,name,email) VALUES(?,?,?)").run(target,"Fictional",`${target}@invalid.ttv`);
  await verifyRetainedProbeTarget({db:f.db,envName:"staging",actor,targetUserId:target});
  await expect(verifyRetainedProbeTarget({db:f.db,envName:"staging",actor,targetUserId:"real"})).rejects.toMatchObject({status:403});
  f.database.exec("DELETE FROM stagingFixtureIdentity");
  await expect(verifyRetainedProbeTarget({db:f.db,envName:"staging",actor,targetUserId:target})).rejects.toMatchObject({status:403});
 });
 it("denies no-role model claims and mismatched retained email ownership",async()=>{
  const f=fixture("unapprovedInstitution"), actor=await resolveStagingFixtureIdentity(f.args);if(!actor)throw Error();
  await expect(claimRetainedChat(f.db,"staging",actor)).rejects.toMatchObject({status:403});
  const target=DEMO_USER_IDS[0];f.database.prepare("INSERT INTO user(id,name,email) VALUES(?,?,?)").run(target,"Real","real@example.com");
  await expect(verifyRetainedProbeTarget({db:f.db,envName:"staging",actor,targetUserId:target})).rejects.toMatchObject({status:403});
 });
 it("SQL search excludes real/private/real-mentor data and service mutations remain denied",async()=>{
  const f=fixture(), actor=await resolveStagingFixtureIdentity(f.args);if(!actor)throw Error();
  f.database.exec(readMigration('0017_community_discovery.sql')+readMigration('0018_confirmation_role_snapshot.sql'));
  const id=DEMO_USER_IDS[0];
  f.database.prepare('INSERT INTO user(id,name,email) VALUES(?,?,?)').run(id,'Fictional Builder',`${id}@invalid.ttv`);
  f.database.prepare('INSERT INTO user(id,name,email) VALUES(?,?,?)').run('real','A Real Builder','real@example.com');
  for(const who of [id,'real']) f.database.prepare('INSERT INTO communityProfile(userId,headline,bio,skills,opportunityGoals) VALUES(?,?,?,?,?)').run(who,'Builder','Kotlin','["Kotlin"]','Work');
  f.database.prepare("INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES('published',?,'Public','Kotlin','2026-10-25','institution'),('private',?,'Hidden','Hidden','2026-10-25','private')").run(id,id);
  f.database.prepare("INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion,mentorRole) VALUES('real-confirm','published','real','PRIVATE REAL MENTOR','review',1,'MENTOR')").run();
  const service=createCommunityService(f.db,f.id,actor,'staging');
  expect((await service.searchProfiles({query:'Kotlin'})).map(p=>p.userId)).toEqual([id]);
  const journey=await service.listJourney(id);expect(journey).toHaveLength(1);expect(journey[0].confirmations).toEqual([]);
  await expect(service.getProfile('real')).rejects.toMatchObject({status:403});
  await expect(service.updateOwnProfile({})).rejects.toMatchObject({status:403});
  await expect(service.createJourney({})).rejects.toMatchObject({status:403});
  f.database.prepare('UPDATE user SET email=? WHERE id=?').run('changed@example.com',id);
  expect(await service.searchProfiles({query:'Kotlin'})).toEqual([]);
 });
 it("allows only enumerated GETs and rubric-free chat; denies mutation/admin/MCP/assessment/cookies",()=>{
  const scopes=["community:read","institution:read"];
  authorizeRetainedProbe("GET","profiles",scopes,null);authorizeRetainedProbe("POST","chat",scopes,{message:"Find Kotlin"});
  for(const [method,path,body] of [["POST","access",{}],["PUT","profile",{}],["POST","chat",{rubric:{}}],["POST",`profiles/${DEMO_USER_IDS[0]}/assessment`,{}],["GET","profiles/real",null],["GET","journey",null],["GET","mcp",null]]) expect(()=>authorizeRetainedProbe(String(method),String(path),scopes,body)).toThrow(/synthetic probe|PAT required/);
  expect(()=>authorizeRetainedProbe("GET","profiles",null,null)).toThrow(/synthetic probe|PAT required/);
 });
});
