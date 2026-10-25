import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as assessmentProvider from "./assessment-provider";
import { createCommunityService } from "./service";
import { handleCommunityRequest } from "./http";
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.restoreAllMocks(); });
const migration = readFileSync(new URL("../db/migrations/0017_community_discovery.sql", import.meta.url),"utf8").replaceAll("--> statement-breakpoint", "");
function fixture(beforeWrite?: (sql: DatabaseSync,query: string) => void) {
  const sql = new DatabaseSync(":memory:"); databases.push(sql);
  sql.exec(`PRAGMA foreign_keys=ON; CREATE TABLE user (id TEXT PRIMARY KEY,name TEXT NOT NULL,image TEXT);
    CREATE TABLE Roles (id TEXT PRIMARY KEY,name TEXT UNIQUE,createdAt INTEGER DEFAULT(unixepoch()),updatedAt INTEGER DEFAULT(unixepoch()));
    CREATE TABLE UserRoles (id TEXT PRIMARY KEY,userId TEXT,roleId TEXT,UNIQUE(userId,roleId));
    INSERT INTO user VALUES ('member','Member',null),('other','Other',null),('mentor','Mentor',null),('institution','Institution',null);`);
  sql.exec(migration);
  sql.exec(readFileSync(new URL("../db/migrations/0018_confirmation_role_snapshot.sql",import.meta.url),"utf8"));
  for (const [actor,role] of [["mentor","MENTOR"],["institution","INSTITUTION"]]) sql.prepare(`INSERT INTO UserRoles VALUES (?,?,(SELECT id FROM Roles WHERE name=?))`).run(actor,actor,role);
  const db = { prepare(query: string) {
    let values: (string | number | null)[] = [];
    const statement = {
      bind(...args: (string | number | null)[]) { values = args; return statement; },
      async first() { return sql.prepare(query).get(...values) ?? null; },
      async all() { return { results: sql.prepare(query).all(...values) }; },
      async run() { beforeWrite?.(sql,query); const r = sql.prepare(query).run(...values); return { success: true, meta: { changes: Number(r.changes) } }; },
    }; return statement;
  } } as unknown as D1Database;
  return { db, sql, member: createCommunityService(db,"member"), institution: createCommunityService(db,"institution"), mentor: createCommunityService(db,"mentor") };
}
const profile = { headline: "Builder", bio: "Builds tools", skills: ["TypeScript"], opportunityGoals: "First developer role" };
const entry = { title: "Built a tool", description: "Implemented and tested a tool", evidenceUrl: "https://github.com/example/tool", occurredAt: "2026-10-24", visibility: "institution" };
describe("community service real SQL boundaries", () => {
  it("lets non-cohort members contribute and versions profile edits", async () => {
    const f = fixture();
    expect(await f.member.updateOwnProfile(profile)).toMatchObject({...profile,userId:"member",version:1});
    expect(await f.member.updateOwnProfile({...profile,headline:"Engineer"})).toMatchObject({version:2});
    await f.member.createJourney(entry);
    expect(await f.member.listJourney()).toHaveLength(1);
    expect(await f.institution.searchProfiles({query:"TypeScript"})).toHaveLength(1);
  });
  it("searches all community users and revalidates institutional approval", async () => {
    const f = fixture();
    expect(await f.institution.searchProfiles({query:"Other"})).toEqual([expect.objectContaining({userId:"other",version:0})]);
    await expect(f.member.searchProfiles({})).rejects.toMatchObject({status:403});
    f.sql.prepare("DELETE FROM UserRoles WHERE userId=?").run("institution");
    await expect(f.institution.searchProfiles({})).rejects.toMatchObject({status:403});
  });
  it("applies talent eligibility before query, skill filtering and pagination", async () => {
    const f = fixture();
    f.sql.exec(`INSERT INTO Roles(id,name) VALUES ('student','STUDENT'),('admin','ADMIN');`);
    const candidates: [string,string[],boolean][] = [
      ["open",[],true],["student",["STUDENT"],true],["institution-only",["INSTITUTION"],true],
      ["dual",["STUDENT","INSTITUTION"],true],["mentor-only",["MENTOR"],false],
      ["admin-only",["ADMIN"],false],["mixed-mentor",["STUDENT","MENTOR","INSTITUTION"],false],
      ["mixed-admin",["STUDENT","ADMIN","INSTITUTION"],false],
    ];
    for (const [id,roles,included] of candidates) {
      f.sql.prepare("INSERT INTO user VALUES (?,?,null)").run(id,`${included ? "Z" : "A"} ${id}`);
      for (const role of roles) f.sql.prepare("INSERT INTO UserRoles VALUES (?,?,(SELECT id FROM Roles WHERE name=?))").run(`${id}-${role}`,id,role);
      const service=createCommunityService(f.db,id);
      await service.updateOwnProfile({...profile,headline:"Eligibility candidate",skills:["TypeScript"]});
      await service.createJourney(entry);
      await service.createJourney({...entry,visibility:"private",description:"Hidden evidence"});
    }
    const all=await f.institution.searchProfiles({query:"Eligibility candidate",skills:["typescript"]});
    expect(all.map(p=>p.userId).toSorted()).toEqual(candidates.filter(c=>c[2]).map(c=>c[0]).toSorted());
    expect(await f.institution.searchProfiles({query:"Eligibility candidate",skills:["typescript"],limit:1})).toHaveLength(1);
    expect((await f.institution.searchProfiles({query:"Eligibility candidate",skills:["typescript"],limit:1}))[0].userId).toBe("dual");
    for (const [id,,included] of candidates) if (!included) {
      expect(await f.institution.searchProfiles({query:id})).toEqual([]);
      expect(await f.institution.getProfile(id)).toMatchObject({userId:id});
      const entries=await f.institution.listJourney(id);
      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries)).not.toContain("Hidden evidence");
      f.sql.prepare("DELETE FROM communityProfile WHERE userId=?").run(id);
      expect(await f.institution.searchProfiles({query:id})).toEqual([]);
    }
  });
  it("AND matches skill criteria before limiting results", async () => {
    const f = fixture();
    await f.member.updateOwnProfile({...profile,skills:["React","TypeScript"]});
    await createCommunityService(f.db,"other").updateOwnProfile({...profile,skills:["React"]});
    expect(await f.institution.searchProfiles({skills:["react","typescript"],limit:1})).toEqual([expect.objectContaining({userId:"member"})]);
    expect(await f.institution.searchProfiles({skills:["act"]})).toEqual([]);
    await expect(f.institution.searchProfiles({skills:Array(11).fill("React")})).rejects.toMatchObject({status:400});
  });
  it("excludes private contributions from institution and mentor reads", async () => {
    const f = fixture(); await f.member.createJourney(entry);
    const hidden = await f.member.createJourney({...entry,title:"Private",description:"Private call",visibility:"private"});
    expect(await f.member.listJourney()).toHaveLength(2);
    const shared = await f.institution.listJourney("member"); expect(shared).toHaveLength(1);
    expect(JSON.stringify(shared)).not.toContain("Private call");
    await expect(f.mentor.confirmJourney(hidden.id,{expectedRevision:1,statement:"I checked the code",method:"Review"})).rejects.toMatchObject({status:404});
    await expect(createCommunityService(f.db,"other").getProfile("member")).rejects.toMatchObject({status:403});
  });
  it("records scoped mentor provenance and rejects self confirmation and revoked mentors", async () => {
    const f = fixture(); const item = await f.member.createJourney(entry);
    const claim = {expectedRevision:1,statement:"I reviewed the test implementation",method:"Repository review"};
    await f.mentor.confirmJourney(item.id,claim);
    expect((await f.institution.listJourney("member"))[0].confirmations).toEqual([expect.objectContaining({mentorId:"mentor",journeyVersion:1,mentorRole:"MENTOR",statement:claim.statement,method:claim.method})]);
    await expect(f.member.confirmJourney(item.id,claim)).rejects.toMatchObject({status:403});
    const own = await f.mentor.createJourney(entry); await expect(f.mentor.confirmJourney(own.id,claim)).rejects.toMatchObject({status:403});
    f.sql.prepare("DELETE FROM UserRoles WHERE userId=?").run("mentor"); await expect(f.mentor.confirmJourney(item.id,claim)).rejects.toMatchObject({status:403});
  });
  it("rejects injected ownership, unsafe evidence links and invalid calendar dates", async () => {
    const f = fixture();
    for (const changes of [{userId:"other"},{evidenceUrl:["java", "script:alert(1)"].join("")},{evidenceUrl:"https://example.com/admin/private"},{occurredAt:"2026-02-30"}]) await expect(f.member.createJourney({...entry,...changes})).rejects.toMatchObject({status:400});
    expect(await f.institution.searchProfiles({query:"%"})).toEqual([]);
  });
  it("limits mentor review to shared contributions and excludes self", async () => {
    const f = fixture();
    await f.member.createJourney(entry); await f.member.createJourney({...entry,visibility:"private"}); await f.mentor.createJourney(entry);
    expect(await f.mentor.listMentorship()).toEqual([expect.objectContaining({userId:"member",memberName:"Member"})]);
    await expect(f.member.listMentorship()).rejects.toMatchObject({status:403});
  });
  it("requires current admin access to grant institutional membership", async () => {
    const f = fixture();
    await expect(f.member.setAccess({userId:"other",role:"INSTITUTION",granted:true})).rejects.toMatchObject({status:403});
    f.sql.exec(`INSERT INTO Roles(id,name) VALUES ('admin','ADMIN'); INSERT INTO UserRoles VALUES ('admin-grant','member','admin');`);
    await f.member.setAccess({userId:"other",role:"INSTITUTION",granted:true});
    await f.member.setAccess({userId:"other",role:"INSTITUTION",granted:true});
    expect((await createCommunityService(f.db,"other").access()).isInstitution).toBe(true);
    await f.member.setAccess({userId:"other",role:"INSTITUTION",granted:false});
    expect((await createCommunityService(f.db,"other").access()).isInstitution).toBe(false);
    await expect(f.member.setAccess({userId:"other",role:"ADMIN",granted:true})).rejects.toMatchObject({status:400});
  });
  it("rejects confirmation if its evidence revision changes during review", async () => {
    let edit = false;
    const f = fixture((sql,query) => {
      if (edit && query.includes("INSERT INTO communityConfirmation")) { edit = false; sql.exec("UPDATE communityJourney SET version=version+1"); }
    });
    const item = await f.member.createJourney(entry); edit = true;
    await expect(f.mentor.confirmJourney(item.id,{expectedRevision:1,statement:"I checked the earlier revision",method:"Review"})).rejects.toMatchObject({status:409});
    expect(f.sql.prepare("SELECT count(*) AS count FROM communityConfirmation").get()).toMatchObject({count:0});
  });
  it("versions edited evidence without transferring a mentor confirmation to the revision", async () => {
    const f = fixture(); const item = await f.member.createJourney(entry);
    await f.mentor.confirmJourney(item.id,{expectedRevision:1,statement:"I checked the original implementation",method:"Review"});
    await expect(createCommunityService(f.db,"other").updateJourney(item.id,{...entry,title:"Changed"})).rejects.toMatchObject({status:404});
    await f.member.updateJourney(item.id,{...entry,title:"Changed implementation"});
    const [saved] = await f.institution.listJourney("member");
    expect(saved).toMatchObject({version:2,title:"Changed implementation"});
    expect(saved.confirmations[0].journeyVersion).toBe(1);
    await expect(f.mentor.confirmJourney(item.id,{expectedRevision:1,statement:"I checked the old revision",method:"Review"})).rejects.toMatchObject({status:409});
    const queue = await f.mentor.listMentorship();
    expect(queue[0].confirmations[0]).toMatchObject({journeyVersion:1,mentorRole:"MENTOR"});
  });
  it("lets owners retract shared evidence while rejecting other users", async () => {
    const f = fixture(); const item = await f.member.createJourney(entry);
    await f.mentor.confirmJourney(item.id,{expectedRevision:1,statement:"I reviewed this code",method:"Review"});
    await expect(createCommunityService(f.db,"other").setJourneyVisibility(item.id,{visibility:"private"})).rejects.toMatchObject({status:404});
    await f.member.setJourneyVisibility(item.id,{visibility:"private"});
    expect(await f.institution.listJourney("member")).toEqual([]);
    expect(await f.mentor.listMentorship()).toEqual([]);
    await expect(f.mentor.confirmJourney(item.id,{expectedRevision:1,statement:"I checked this code",method:"Review"})).rejects.toMatchObject({status:404});
    await f.member.deleteJourney(item.id);
    expect(await f.member.listJourney()).toEqual([]);
    expect(f.sql.prepare("SELECT count(*) AS count FROM communityConfirmation").get()).toMatchObject({count:0});
  });
  it("seeds roles idempotently without replacing existing grants", () => {
    const f = fixture(); const seed = migration.split(';').filter(s=>s.includes('INSERT INTO "Roles"')).join(';')+';';
    f.sql.exec(seed); f.sql.exec(seed);
    expect(f.sql.prepare("SELECT count(*) AS count FROM Roles WHERE name='INSTITUTION'").get()).toMatchObject({count:1});
    expect(f.sql.prepare("SELECT count(*) AS count FROM UserRoles WHERE userId='institution'").get()).toMatchObject({count:1});
  });
});
describe("community HTTP", () => {
  it("requires auth, same origin and correct scopes", async () => {
    const {db} = fixture(); const get = new Request("https://ttv.example/api/community/profile");
    expect((await handleCommunityRequest(get,"profile",null,db)).status).toBe(401);
    expect((await handleCommunityRequest(new Request(get.url,{method:"PUT",body:JSON.stringify(profile)}),"profile",{id:"member",scopes:null},db)).status).toBe(403);
    expect((await handleCommunityRequest(get,"profiles",{id:"institution",scopes:["community:read"]},db)).status).toBe(403);
  });
  it("supports actual writes and evidence reads", async () => {
    const {db} = fixture(); const put = new Request("https://ttv.example/api/community/profile",{method:"PUT",headers:{Origin:"https://ttv.example"},body:JSON.stringify(profile)});
    expect((await handleCommunityRequest(put,"profile",{id:"member",scopes:null},db)).status).toBe(200);
    const res = await handleCommunityRequest(new Request(put.url),"profiles/member",{id:"institution",scopes:["institution:read"]},db);
    expect(await res.json()).toMatchObject({profile:{headline:"Builder"},entries:[]});
  });
  it("returns safe errors for malformed JSON and storage failure", async () => {
    const {db} = fixture(); const req = new Request("https://ttv.example/api/community/profile",{method:"PUT",headers:{Origin:"https://ttv.example"},body:"{"});
    expect((await handleCommunityRequest(req,"profile",{id:"member",scopes:null},db)).status).toBe(400);
    const broken = {prepare(){throw new Error("private database text");}} as unknown as D1Database;
    const res = await handleCommunityRequest(new Request(req.url),"profile",{id:"member",scopes:null},broken);
    expect(res.status).toBe(500); expect(await res.text()).not.toContain("private database");
  });
  it("blocks delegated role grants and limits streamed request size", async () => {
    const {db} = fixture();
    const req = () => new Request("https://ttv.example/api/community/access",{method:"POST",headers:{Origin:"https://ttv.example"},body:JSON.stringify({userId:"other",role:"INSTITUTION",granted:true})});
    expect((await handleCommunityRequest(req(),"access",{id:"member",scopes:["community:write"]},db)).status).toBe(403);
    expect((await handleCommunityRequest(req(),"access",{id:"member",scopes:null,delegatedSession:true},db)).status).toBe(403);
    const huge = new Request(req().url,{method:"PUT",headers:{Origin:"https://ttv.example"},body:"x".repeat(32001)});
    expect((await handleCommunityRequest(huge,"profile",{id:"member",scopes:null},db)).status).toBe(413);
  });
  it("assesses only authorized shared evidence and rejects unknown bearer fallback", async () => {
    const f = fixture(); await f.member.createJourney(entry);
    await f.member.createJourney({...entry,description:"secret skill",visibility:"private"});
    const body = {id:"hiring",version:1,criteria:[{id:"tool",label:"Tool evidence",terms:["implemented"]}]};
    const req = new Request("https://ttv.example/api/community/profiles/member/assessment",{method:"POST",body:JSON.stringify(body)});
    const res = await handleCommunityRequest(req,"profiles/member/assessment",{id:"institution",scopes:["institution:read"]},f.db);
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({assessment:{status:"unavailable",errorCode:"provider_unavailable",rubric:{version:1},criteria:[]}});
    const spoof = new Request("https://ttv.example/api/community/profile",{headers:{Authorization:"Bearer unknown"}});
    expect((await handleCommunityRequest(spoof,"profile",{id:"member",scopes:null},f.db)).status).toBe(401);
  });
  it("uses the validated model contract over REST and authorizes before inference", async () => {
    const f = fixture(); const contribution = await f.member.createJourney(entry);
    await f.member.createJourney({...entry,description:"private-only-secret",visibility:"private"});
    const complete = vi.fn().mockResolvedValue(JSON.stringify({criteria:[{criterionId:"tool",status:"assessed",rating:3,explanation:"Specific documented contribution, not inferred ability.",citations:[{kind:"journey",id:contribution.id,version:1}]}]}));
    vi.spyOn(assessmentProvider,"createAssessmentProvider").mockReturnValue({model:"test-model",complete});
    const body = {id:"hiring",version:1,criteria:[{id:"tool",label:"Tool evidence",terms:["implemented"]}]};
    const request = () => new Request("https://ttv.example/api/community/profiles/member/assessment",{method:"POST",body:JSON.stringify(body)});
    const denied = await handleCommunityRequest(request(),"profiles/member/assessment",{id:"other",scopes:["institution:read"]},f.db);
    expect(denied.status).toBe(403); expect(complete).not.toHaveBeenCalled();
    const response = await handleCommunityRequest(request(),"profiles/member/assessment",{id:"institution",scopes:["institution:read"]},f.db);
    expect(await response.json()).toMatchObject({assessment:{status:"completed",method:"model-evidence-support-v1",criteria:[{criterionId:"tool",label:"Tool evidence",rating:3,citations:[{id:contribution.id,userId:"member",quote:entry.description}]}]}});
    expect(JSON.stringify(complete.mock.calls)).not.toContain("private-only-secret");
  });

});

describe('retained demo dataset isolation',()=>{
  it('scopes institution lookup/tools and mentor writes to exact demo IDs',async()=>{
    const f=fixture();
    const prefix='ttv-staging-demo-v1-';
    const member=prefix+'member-cohort',institution=prefix+'institution',mentor=prefix+'mentor';
    for(const id of [member,institution,mentor,prefix+'unknown']) f.sql.prepare('INSERT INTO user VALUES(?,?,null)').run(id,id);
    for(const [id,role] of [[institution,'INSTITUTION'],[mentor,'MENTOR']]) f.sql.prepare('INSERT INTO UserRoles VALUES(?,?,(SELECT id FROM Roles WHERE name=?))').run(id,id,role);
    const demoMember=createCommunityService(f.db,member,null,'staging');
    const demoInstitution=createCommunityService(f.db,institution,null,'staging');
    const demoMentor=createCommunityService(f.db,mentor,null,'staging');
    const realEntry=await f.member.createJourney(entry);
    const demoEntry=await demoMember.createJourney(entry);
    await f.mentor.confirmJourney(demoEntry.id,{statement:'Private real mentor statement',method:'Review',expectedRevision:1});
    await demoMentor.confirmJourney(demoEntry.id,{statement:'Synthetic confirmation',method:'Review',expectedRevision:1});
    for (const journeys of [await demoMember.listJourney(), await demoInstitution.listJourney(member), await demoMentor.listMentorship()]) {
      expect(journeys[0].confirmations.map(c=>c.mentorId)).toEqual([mentor]);
      expect(JSON.stringify(journeys)).not.toContain('Private real mentor statement');
    }
    const results=await demoInstitution.searchProfiles({});
    expect(results.map(p=>p.userId).toSorted()).toEqual([institution,member].toSorted());
    await expect(demoInstitution.getProfile('member')).rejects.toMatchObject({status:403});
    await expect(demoInstitution.listJourney('member')).rejects.toMatchObject({status:403});
    expect((await demoMentor.listMentorship()).map(j=>j.id)).toEqual([demoEntry.id]);
    await expect(demoMentor.confirmJourney(realEntry.id,{statement:'Observed work',method:'Review',expectedRevision:1})).rejects.toMatchObject({status:404});
    await expect(demoInstitution.setAccess({userId:member,role:'MENTOR',granted:true})).rejects.toMatchObject({status:403});
    expect(()=>createCommunityService(f.db,member,null,'production')).toThrow('Verified demo');
    expect(()=>createCommunityService(f.db,prefix+'unknown',null,'staging')).toThrow('Verified demo');
  });
});


it("atomically permits one confirmation per mentor and revision, preserving earlier revisions and other mentors",async()=>{
 const f=fixture();await f.member.updateOwnProfile(profile);const item=await f.member.createJourney(entry);
 const review={expectedRevision:1,statement:'Reviewed the described change',method:'Source review'};
 const results=await Promise.allSettled([f.mentor.confirmJourney(item.id,review),f.mentor.confirmJourney(item.id,review)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{status:409}});
 await expect(f.mentor.confirmJourney(item.id,review)).rejects.toMatchObject({status:409});
 expect((await f.mentor.listMentorship())[0].reviewedByCurrentMentor).toBe(true);
 await f.member.updateJourney(item.id,{...entry,description:'Updated documented change'});
 expect((await f.mentor.listMentorship())[0].reviewedByCurrentMentor).toBe(false);
 await f.mentor.confirmJourney(item.id,{...review,expectedRevision:2});
 f.sql.prepare("INSERT INTO UserRoles VALUES ('other-mentor','other',(SELECT id FROM Roles WHERE name='MENTOR'))").run();
 const other=createCommunityService(f.db,'other');await other.confirmJourney(item.id,{...review,expectedRevision:2});
 expect((await f.institution.listJourney('member'))[0].confirmations).toHaveLength(3);
});

it('keeps already-reviewed status authoritative when the display history limit omits that confirmation',async()=>{
 const f=fixture();await f.member.updateOwnProfile(profile);const item=await f.member.createJourney(entry);await f.mentor.confirmJourney(item.id,{expectedRevision:1,statement:'Current review',method:'Review'});
 f.sql.prepare("UPDATE communityConfirmation SET createdAt=1").run();
 const insert=f.sql.prepare("INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion,mentorRole,createdAt) VALUES(?,?,'other','Historical note','Review',0,'MENTOR',2)");
 for(let i=0;i<501;i++)insert.run('historical-'+i,item.id);
 const queue=await f.mentor.listMentorship();expect(queue[0].confirmations).toHaveLength(500);expect(queue[0].confirmations.some(c=>c.mentorId==='mentor')).toBe(false);expect(queue[0].reviewedByCurrentMentor).toBe(true);
});
