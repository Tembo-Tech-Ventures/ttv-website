import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, MINIMAL_AUTH_SCHEMA, readMigration } from "@/test/sqlite-d1";
import { resolveStagingFixtureIdentity, verifySameRunTarget, type StagingFixturePersona } from "./staging-fixtures";
const fixtures: ReturnType<typeof createSqliteD1>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.database.close(); });
const now = new Date("2026-10-24T12:00:00Z");
const seconds = now.getTime() / 1000;
const runId = "a".repeat(24);
function fixture() {
  const f = createSqliteD1(); fixtures.push(f);
  f.database.exec(MINIMAL_AUTH_SCHEMA + `CREATE TABLE session(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,userAgent TEXT,createdAt INTEGER,expiresAt INTEGER);`);
  f.database.exec(readMigration("0019_staging_fixture_identity.sql"));
  function add(persona: StagingFixturePersona = "member", run = runId, probe = false) {
    const userId = `ttv-staging-fixture-${run}-${persona}`;
    const email = `${userId}@invalid.ttv`;
    const sessionId = probe ? `${userId}-assessment-session` : `session-${run}-${persona}`;
    const marker = `ttv-agent:synthetic-staging:${run}`;
    f.database.prepare("INSERT INTO user(id,name,email) VALUES(?,?,?)").run(userId,persona,email);
    f.database.prepare("INSERT INTO session VALUES(?,?,?,?,?)").run(sessionId,userId,marker,seconds-30,seconds+3600);
    f.database.prepare("INSERT INTO stagingFixtureIdentity VALUES(?,?,?,?,?)").run(userId,sessionId,run,persona,seconds+3500);
    return { db: f.db, envName: "staging", user: { id: userId,email },session: { id: sessionId,userAgent: marker },isPat:false,now };
  }
  return { ...f, add };
}
describe("synthetic staging live identity boundary", () => {
  it("derives probe mode only from the registered dedicated institution source session", async () => {
    const f=fixture(), ordinary=f.add("institution"), probe=f.add("institution","b".repeat(24),true), member=f.add("member",runId,true);
    expect(await resolveStagingFixtureIdentity(ordinary)).not.toHaveProperty("assessmentProbe");
    expect(await resolveStagingFixtureIdentity(probe)).toMatchObject({assessmentProbe:true});
    expect(await resolveStagingFixtureIdentity({...probe,isPat:true,session:{id:"pat:1",userAgent:"ttv-pat:1"}})).toMatchObject({assessmentProbe:true});
    expect(await resolveStagingFixtureIdentity(member)).not.toHaveProperty("assessmentProbe");
    await expect(resolveStagingFixtureIdentity({...probe,envName:"production"})).rejects.toMatchObject({status:403});
  });
  it("does not query the DB for ordinary real actors", async () => {
    const prepare = vi.fn();
    expect(await resolveStagingFixtureIdentity({ db:{prepare} as unknown as D1Database,envName:"production",user:{id:"real",email:"real@example.com"},session:{id:"browser",userAgent:"browser"},isPat:false,now })).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });
  it.each(["production","agent-example","Staging","",undefined])("denies fixture actors outside exact staging: %s", async envName => {
    const f=fixture(); const actor=f.add();
    await expect(resolveStagingFixtureIdentity({...actor,envName})).rejects.toMatchObject({status:403});
  });
  it("accepts only a live exact cookie identity", async () => {
    const f=fixture(); const actor=f.add();
    expect(await resolveStagingFixtureIdentity(actor)).toEqual({runId,persona:"member",userId:actor.user.id,expiresAt:seconds+3500});
    await expect(resolveStagingFixtureIdentity({...actor,user:{...actor.user,id:`ttv-staging-fixture-${"b".repeat(24)}-member`}})).rejects.toMatchObject({status:403});
    await expect(resolveStagingFixtureIdentity({...actor,user:{...actor.user,email:"forged@example.com"}})).rejects.toMatchObject({status:403});
    await expect(resolveStagingFixtureIdentity({...actor,session:{...actor.session,id:"cached-other-session"}})).rejects.toMatchObject({status:403});
    await expect(resolveStagingFixtureIdentity({...actor,session:{...actor.session,userAgent:"browser"}})).rejects.toMatchObject({status:403});
  });
  it.each(["UPDATE stagingFixtureIdentity SET persona='mentor'","UPDATE stagingFixtureIdentity SET runId='invalid'","UPDATE user SET email='wrong@invalid.ttv'","UPDATE session SET userAgent='wrong'","DELETE FROM stagingFixtureIdentity","DELETE FROM session"])("rejects live registry/session tampering: %s", async mutation => {
    const f=fixture();const actor=f.add();f.database.exec(mutation);
    await expect(resolveStagingFixtureIdentity(actor)).rejects.toMatchObject({status:403});
  });
  it("enforces absolute registry expiry despite cached or extended browser sessions", async () => {
    const f=fixture();const actor=f.add();
    f.database.prepare("UPDATE session SET expiresAt=?").run(seconds+7*86400);
    f.database.prepare("UPDATE stagingFixtureIdentity SET expiresAt=?").run(seconds-1);
    await expect(resolveStagingFixtureIdentity(actor)).rejects.toMatchObject({status:403});
    f.database.prepare("UPDATE stagingFixtureIdentity SET expiresAt=?").run(seconds+3601);
    await expect(resolveStagingFixtureIdentity(actor)).rejects.toMatchObject({status:403});
  });
  it("rejects an expired source browser session even for PAT access", async () => {
    const f=fixture();const actor=f.add();f.database.prepare("UPDATE session SET expiresAt=?").run(seconds);
    await expect(resolveStagingFixtureIdentity({...actor,isPat:true,session:{id:"pat:1",userAgent:"ttv-pat:1"}})).rejects.toMatchObject({status:403});
  });
  it("allows already-authenticated PAT only while its registered browser session lives", async () => {
    const f=fixture();const actor=f.add();const pat={...actor,isPat:true,session:{id:"pat:1",userAgent:"ttv-pat:1"}};
    expect(await resolveStagingFixtureIdentity(pat)).toMatchObject({runId,persona:"member"});
    f.database.exec("DELETE FROM stagingFixtureIdentity");
    await expect(resolveStagingFixtureIdentity(pat)).rejects.toMatchObject({status:403});
  });
  it("restricts targets to live same-run fixtures and rechecks the caller", async () => {
    const f=fixture();const source=f.add();const target=f.add("mentor");const other=f.add("mentor","b".repeat(24));
    const actor=await resolveStagingFixtureIdentity(source);if(!actor) throw new Error("Fixture missing");
    const args={db:f.db,envName:"staging",actor,now};
    expect(await verifySameRunTarget({...args,targetUserId:target.user.id})).toMatchObject({persona:"mentor"});
    await expect(verifySameRunTarget({...args,targetUserId:other.user.id})).rejects.toMatchObject({status:403});
    await expect(verifySameRunTarget({...args,targetUserId:"real-user"})).rejects.toMatchObject({status:403});
    f.database.prepare("DELETE FROM stagingFixtureIdentity WHERE userId=?").run(source.user.id);
    await expect(verifySameRunTarget({...args,targetUserId:target.user.id})).rejects.toMatchObject({status:403});
  });
});
