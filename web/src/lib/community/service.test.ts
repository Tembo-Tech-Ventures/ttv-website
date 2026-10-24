import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createCommunityService } from "./service";
import { handleCommunityRequest } from "./http";
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const migration = readFileSync(new URL("../db/migrations/0017_community_discovery.sql", import.meta.url),"utf8").replaceAll("--> statement-breakpoint", "");
function fixture() {
  const sql = new DatabaseSync(":memory:"); databases.push(sql);
  sql.exec(`PRAGMA foreign_keys=ON; CREATE TABLE user (id TEXT PRIMARY KEY,name TEXT NOT NULL,image TEXT);
    CREATE TABLE Roles (id TEXT PRIMARY KEY,name TEXT UNIQUE,createdAt INTEGER DEFAULT(unixepoch()),updatedAt INTEGER DEFAULT(unixepoch()));
    CREATE TABLE UserRoles (id TEXT PRIMARY KEY,userId TEXT,roleId TEXT,UNIQUE(userId,roleId));
    INSERT INTO user VALUES ('member','Member',null),('other','Other',null),('mentor','Mentor',null),('institution','Institution',null);`);
  sql.exec(migration);
  for (const [actor,role] of [["mentor","MENTOR"],["institution","INSTITUTION"]]) sql.prepare(`INSERT INTO UserRoles VALUES (?,?,(SELECT id FROM Roles WHERE name=?))`).run(actor,actor,role);
  const db = { prepare(query: string) {
    let values: (string | number | null)[] = [];
    const statement = {
      bind(...args: (string | number | null)[]) { values = args; return statement; },
      async first() { return sql.prepare(query).get(...values) ?? null; },
      async all() { return { results: sql.prepare(query).all(...values) }; },
      async run() { const r = sql.prepare(query).run(...values); return { success: true, meta: { changes: Number(r.changes) } }; },
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
  it("excludes private contributions from institution and mentor reads", async () => {
    const f = fixture(); await f.member.createJourney(entry);
    const hidden = await f.member.createJourney({...entry,title:"Private",description:"Private call",visibility:"private"});
    expect(await f.member.listJourney()).toHaveLength(2);
    const shared = await f.institution.listJourney("member"); expect(shared).toHaveLength(1);
    expect(JSON.stringify(shared)).not.toContain("Private call");
    await expect(f.mentor.confirmJourney(hidden.id,{statement:"I checked the code",method:"Review"})).rejects.toMatchObject({status:404});
    await expect(createCommunityService(f.db,"other").getProfile("member")).rejects.toMatchObject({status:403});
  });
  it("records scoped mentor provenance and rejects self confirmation and revoked mentors", async () => {
    const f = fixture(); const item = await f.member.createJourney(entry);
    const claim = {statement:"I reviewed the test implementation",method:"Repository review"};
    await f.mentor.confirmJourney(item.id,claim);
    expect((await f.institution.listJourney("member"))[0].confirmations).toEqual([expect.objectContaining({mentorId:"mentor",journeyVersion:1,...claim})]);
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
  it("versions edited evidence without transferring a mentor confirmation to the revision", async () => {
    const f = fixture(); const item = await f.member.createJourney(entry);
    await f.mentor.confirmJourney(item.id,{statement:"I checked the original implementation",method:"Review"});
    await expect(createCommunityService(f.db,"other").updateJourney(item.id,{...entry,title:"Changed"})).rejects.toMatchObject({status:404});
    await f.member.updateJourney(item.id,{...entry,title:"Changed implementation"});
    const [saved] = await f.institution.listJourney("member");
    expect(saved).toMatchObject({version:2,title:"Changed implementation"});
    expect(saved.confirmations[0].journeyVersion).toBe(1);
  });
  it("lets owners retract shared evidence while rejecting other users", async () => {
    const f = fixture(); const item = await f.member.createJourney(entry);
    await f.mentor.confirmJourney(item.id,{statement:"I reviewed this code",method:"Review"});
    await expect(createCommunityService(f.db,"other").setJourneyVisibility(item.id,{visibility:"private"})).rejects.toMatchObject({status:404});
    await f.member.setJourneyVisibility(item.id,{visibility:"private"});
    expect(await f.institution.listJourney("member")).toEqual([]);
    expect(await f.mentor.listMentorship()).toEqual([]);
    await expect(f.mentor.confirmJourney(item.id,{statement:"I checked this code",method:"Review"})).rejects.toMatchObject({status:404});
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
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({assessment:{rubric:{version:1},criteria:[{status:"supported"}]}});
    const spoof = new Request("https://ttv.example/api/community/profile",{headers:{Authorization:"Bearer unknown"}});
    expect((await handleCommunityRequest(spoof,"profile",{id:"member",scopes:null},f.db)).status).toBe(401);
  });

});
