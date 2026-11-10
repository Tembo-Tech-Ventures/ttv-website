import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import {
  profileStateWithHighlights,
  replaceProfileHighlights,
  type HighlightProfileState,
  type ProfileHighlightValues,
} from "./profile-highlights";

const profile: HighlightProfileState = {
  id: "profile-1",
  userId: "user-1",
  status: "PUBLISHED",
  contentVersion: 8,
  handle: "builder",
  headline: "Developer",
  bio: "I build useful tools.",
  location: "Lagos",
  country: "Nigeria",
  skills: '["TypeScript"]',
  githubLogin: "builder",
  portfolioUrl: null,
  linkedinUrl: null,
  publicName: "Checked Builder",
  publicAvatarUrl: "/api/avatar/avatars/user-1/checked.webp",
  user: { name: "Mutable Name", image: null },
};

const highlight: ProfileHighlightValues = {
  repoFullName: "builder/project",
  repoUrl: "https://github.com/builder/project",
  description: "A useful project",
  language: "TypeScript",
  topics: '["web"]',
  stars: 3,
  pushedAt: new Date("2026-10-01T00:00:00Z"),
  blurb: "What I built",
  sortOrder: 0,
  snapshotAt: new Date("2026-10-10T00:00:00Z"),
};


import { readdirSync } from "node:fs";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { afterEach } from "vitest";
const databases: ReturnType<typeof createSqliteD1>["database"][]=[];
afterEach(()=>databases.splice(0).forEach(d=>d.close()));
function fixture() {
 const {db:client,database}=createSqliteD1();databases.push(database);
 for(const name of readdirSync(new URL("../db/migrations/",import.meta.url)).filter(n=>/^\d+.*\.sql$/.test(n)).toSorted()) database.exec(readMigration(name));
 database.exec(`INSERT INTO user(id,name,email) VALUES ('user-1','Synthetic Wanjiku','wanjiku@example.test');
 INSERT INTO studentProfile(id,userId,handle,status,contentVersion) VALUES ('profile-1','user-1','builder','PUBLISHED',8);`);
 return {db:drizzle(client,{schema}),database};
}
const pass={outcome:"pass" as const,flags:[],scores:{}};
describe("repository work writes",()=>{
 it("includes snapshot text in moderation",()=>{
   expect(profileStateWithHighlights(profile,["TypeScript"],[highlight]).highlights?.[0]).toMatchObject({repoFullName:highlight.repoFullName,topics:["web"]});
 });
 it("upserts in place, preserving confirmations and order, and makes deselected repos drafts",async()=>{
   const {db,database}=fixture();
   expect(await replaceProfileHighlights(db,profile,[highlight],pass)).toEqual({outcome:"saved"});
   const row=database.prepare("SELECT id FROM communityJourney").get() as {id:string};
   database.prepare("INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion) VALUES ('confirm',?,'user-1','Reviewed','Code',1)").run(row.id);
   expect(await replaceProfileHighlights(db,{...profile,contentVersion:9},[{...highlight,blurb:"New revision",sortOrder:3}],pass)).toEqual({outcome:"saved"});
   expect(database.prepare("SELECT id,sortOrder,version,description FROM communityJourney").get()).toEqual({id:row.id,sortOrder:3,version:2,description:"New revision"});
   expect(database.prepare("SELECT journeyId FROM communityConfirmation").get()).toEqual({journeyId:row.id});
   await replaceProfileHighlights(db,{...profile,contentVersion:10},[],pass);
   expect(database.prepare("SELECT state FROM communityJourney").get()).toEqual({state:"DRAFT"});
   expect(database.prepare("SELECT count(*) n FROM communityConfirmation").get()).toEqual({n:1});
 });
 it.each(["hold","error"] as const)("stores a %s decision on the work for human review",async outcome=>{
   const {db,database}=fixture();
   expect(await replaceProfileHighlights(db,profile,[highlight],{...pass,outcome})).toEqual({outcome:outcome==="hold"?"hold":"saved"});
   expect(database.prepare("SELECT moderationOutcome,moderationReviewRequired FROM communityJourney").get()).toEqual({moderationOutcome:outcome,moderationReviewRequired:1});
 });
 it("refuses stale and suspended writes without changing work",async()=>{
   const {db,database}=fixture();
   expect(await replaceProfileHighlights(db,{...profile,contentVersion:7},[highlight],pass)).toEqual({outcome:"conflict"});
   expect(await replaceProfileHighlights(db,{...profile,status:"SUSPENDED"},[highlight],pass)).toEqual({outcome:"suspended"});
   expect(database.prepare("SELECT count(*) n FROM communityJourney").get()).toEqual({n:0});
 });
});
