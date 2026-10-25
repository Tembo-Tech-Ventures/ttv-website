import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { buildDemoDataset, seedDemoData, DEMO_PERSONAS } from "./staging-demo-data.mjs";
import { verifyStagingFixtureTarget, STAGING_FIXTURE_DATABASE_ID as dbId } from "./staging-fixture-target.mjs";
import { createCommunityService } from "../../src/lib/community/service";
const databases=[];
afterEach(()=>{for(const db of databases.splice(0))db.close();});
async function fixture(){
 const db=new DatabaseSync(":memory:");databases.push(db);db.exec("PRAGMA foreign_keys=ON");
 const migrations=new URL("../../src/lib/db/migrations/",import.meta.url);
 for(const file of readdirSync(migrations).filter(n=>n.endsWith(".sql")).toSorted())db.exec(readFileSync(new URL(file,migrations),"utf8"));
 db.prepare('INSERT INTO Roles(id,name) VALUES(?,?) ON CONFLICT(name) DO NOTHING').run("demo-test-student","STUDENT");
 let failAfter=null,writes=0;
 const queries=[];const api=async(path,options)=>{
 if(path==="")return{id:"a".repeat(32)};
 if(path.endsWith("settings"))return{bindings:[{name:"DB",type:"d1",id:dbId},{name:"DEPLOYMENT_ENVIRONMENT",text:"staging"},{name:"DEPLOYMENT_VERSION",text:"b".repeat(40)},{name:"PRIMARY_DOMAIN",text:"staging.tembotechventures.com"},{name:"BETTER_AUTH_URL",text:"https://staging.tembotechventures.com"}]};
 if(path.endsWith(dbId))return{uuid:dbId,name:"ttv-website-db-staging"};
 const{sql,params}=options.body;queries.push(sql);expect(params.length).toBeLessThanOrEqual(90);if(!sql.startsWith("SELECT")&&failAfter!==null&&writes++>=failAfter)throw new Error("PRIVATE database details");const q=db.prepare(sql);return[{results:sql.startsWith("SELECT")?q.all(...params):(q.run(...params),[])}];};
 const target=await verifyStagingFixtureTarget({environmentName:"staging",accountId:"a".repeat(32),expectedVersion:"b".repeat(40),baseUrl:"https://staging.tembotechventures.com",api,fetchImpl:async()=>Response.json({service:"ttv-website",environment:"staging",version:"b".repeat(40),checks:{db:"ok"}})});
 const d1={prepare(sql){let params=[];const q={bind(...args){params=args;return q;},async all(){return{results:db.prepare(sql).all(...params)};},async first(){return db.prepare(sql).get(...params)??null;}};return q;}};
 return{db,target,queries,d1,interruptAfter(n){failAfter=n;writes=0;}};
}
const count=(db,table)=>db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get().n;
it("generates150 deterministic varied explicitly fictional profiles",()=>{
 const data=buildDemoDataset();expect(data).toEqual(buildDemoDataset());expect(data.user).toHaveLength(150);expect(new Set(data.user.map(u=>u.name)).size).toBe(150);expect(data.user.every(u=>u.name.startsWith("Fictional ")&&u.email===`${u.id}@invalid.ttv`)).toBe(true);expect(data.programApplication).toHaveLength(74);expect(new Set(data.communityProfile.map(p=>p.skills)).size).toBeGreaterThanOrEqual(10);expect(data.communityJourney.some(j=>j.visibility==="private")).toBe(true);expect(data.communityJourney.some(j=>j.evidenceUrl===null)).toBe(true);expect(data.communityConfirmation.every(c=>c.statement.startsWith("Synthetic")&&c.journeyVersion===1)).toBe(true);
});
it("seeds actual migrations idempotently, preserves edits/real records and mints no auth",async()=>{
 const f=await fixture();f.db.prepare('INSERT INTO user(id,name,email)VALUES(?,?,?)').run("real","Real","real@example.com");
 const receipt=await seedDemoData(f.target);f.db.prepare('UPDATE communityProfile SET headline=? WHERE userId=?').run("Fictional edited note",DEMO_PERSONAS.noncohort);expect(await seedDemoData(f.target)).toEqual(receipt);expect(count(f.db,"user")).toBe(151);expect(count(f.db,"communityProfile")).toBe(150);expect(f.db.prepare('SELECT headline FROM communityProfile WHERE userId=?').get(DEMO_PERSONAS.noncohort).headline).toBe("Fictional edited note");expect(f.db.prepare('SELECT name FROM user WHERE id=?').get("real").name).toBe("Real");
 for(const table of["session","account","personal_access_token","stagingFixtureIdentity","studentProfile","recording"])expect(count(f.db,table)).toBe(0);
 expect(f.queries.every(sql=>! /\b(UPDATE|DELETE|REPLACE)\b/.test(sql))).toBe(true);
});
it("includes institutional and both cohort modes as talent but excludes mentor",async()=>{
 const f=await fixture();await seedDemoData(f.target);const service=createCommunityService(f.d1,DEMO_PERSONAS.institution);
 for(const id of[DEMO_PERSONAS.institution,DEMO_PERSONAS.cohort,DEMO_PERSONAS.noncohort]){const name=f.db.prepare('SELECT name FROM user WHERE id=?').get(id).name;expect((await service.searchProfiles({query:name})).map(p=>p.userId)).toContain(id);}
 const name=f.db.prepare('SELECT name FROM user WHERE id=?').get(DEMO_PERSONAS.mentor).name;expect(await service.searchProfiles({query:name})).toEqual([]);expect(f.db.prepare('SELECT status FROM programApplication WHERE userId=?').get(DEMO_PERSONAS.cohort).status).toBe("APPROVED");expect(f.db.prepare('SELECT id FROM programApplication WHERE userId=?').get(DEMO_PERSONAS.noncohort)).toBeUndefined();
});
it.each(["identity","journey","privilege","email"])("rejects %s collision before writes",async kind=>{
 const f=await fixture(),id=DEMO_PERSONAS.noncohort;f.db.prepare('INSERT INTO user(id,name,email)VALUES(?,?,?)').run("real","Real",kind==="email"?`${id}@invalid.ttv`:"real@example.com");
 if(kind==="identity")f.db.prepare('INSERT INTO user(id,name,email)VALUES(?,?,?)').run(id,"Wrong","wrong@example.com");
 if(kind==="journey")f.db.prepare('INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility)VALUES(?,?,?,?,?,?)').run(`${id}-journey-1`,"real","Real","Private","2026-10-01","private");
 if(kind==="privilege"){f.db.prepare('INSERT INTO user(id,name,email)VALUES(?,?,?)').run(id,"Fictional",`${id}@invalid.ttv`);f.db.prepare('INSERT INTO Roles(id,name)VALUES(?,?)ON CONFLICT(name)DO NOTHING').run("admin-test","ADMIN");f.db.prepare('INSERT INTO UserRoles(id,userId,roleId)VALUES(?,?,(SELECT id FROM Roles WHERE name=?))').run("admin-link",id,"ADMIN");}
 const before=count(f.db,"user");f.queries.length=0;await expect(seedDemoData(f.target)).rejects.toThrow("Retained demo seed incomplete");expect(count(f.db,"user")).toBe(before);expect(f.queries.every(sql=>sql.startsWith("SELECT"))).toBe(true);
});
it("requires verified staging and refuses missing global roles without writes",async()=>{
 await expect(seedDemoData({executeQuery:vi.fn()})).rejects.toThrow("verified staging");const f=await fixture();f.db.exec("DELETE FROM Roles WHERE name='STUDENT'");const audit=vi.fn();await expect(seedDemoData(f.target,audit)).rejects.toThrow("Retained demo seed incomplete");expect(count(f.db,"user")).toBe(0);expect(audit).toHaveBeenCalledWith(expect.objectContaining({status:"failed"}));
});

it("reports partial failure without raw details and resumes missing rows without duplicates",async()=>{
 const f=await fixture(),audit=vi.fn();f.interruptAfter(4);
 await expect(seedDemoData(f.target,audit)).rejects.toThrow("Retained demo seed incomplete");
 expect(count(f.db,"user")).toBeGreaterThan(0);expect(count(f.db,"user")).toBeLessThan(150);
 expect(JSON.stringify(audit.mock.calls)).not.toContain("PRIVATE");
 f.interruptAfter(null);expect((await seedDemoData(f.target)).profiles).toBe(150);
 const before=count(f.db,"communityJourney");await seedDemoData(f.target);expect(count(f.db,"communityJourney")).toBe(before);expect(count(f.db,"user")).toBe(150);
});
