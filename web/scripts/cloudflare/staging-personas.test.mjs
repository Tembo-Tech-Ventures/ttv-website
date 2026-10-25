import { createHash } from "node:crypto";
import { rm, readFile } from "node:fs/promises";
import { runRetainedSearch } from "./staging-retained-search.mjs";
import { seedDemoData, DEMO_PERSONAS } from "./staging-demo-data.mjs";
import { createSqliteD1 } from "../../src/test/sqlite-d1";
import { handleCommunityRequest } from "../../src/lib/community/http";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { verifyStagingPersonas } from "./staging-fixture-verification.mjs";
import { withStagingPersonas } from "./staging-personas.mjs";
import { verifyStagingFixtureTarget, STAGING_FIXTURE_DATABASE_ID as dbId } from "./staging-fixture-target.mjs";
import { createAuth } from "../../src/lib/auth";
import { isAgentSession } from "../../src/lib/agent-auth";
import { resolveStagingFixtureIdentity } from "../../src/lib/staging-fixtures";
const signingSecret = "fictional-staging-secret-at-least-thirty-two-characters";
async function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const migrations = new URL("../../src/lib/db/migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter(n => n.endsWith(".sql")).toSorted()) db.exec(readFileSync(new URL(name, migrations), "utf8"));
  const accountId = "a".repeat(32), expectedVersion = "b".repeat(40);
  const api = vi.fn(async (path, options) => {
    if (path === "") return { id: accountId };
    if (path.endsWith("settings")) return { bindings: [{ name: "DB", type: "d1", id: dbId }, { name: "DEPLOYMENT_ENVIRONMENT", text: "staging" }, { name: "DEPLOYMENT_VERSION", text: expectedVersion }, { name: "PRIMARY_DOMAIN", text: "staging.tembotechventures.com" }, { name: "BETTER_AUTH_URL", text: "https://staging.tembotechventures.com" }] };
    if (path.endsWith(dbId)) return { uuid: dbId, name: "ttv-website-db-staging" };
    const { sql, params } = options.body;
    const statement = db.prepare(sql);
    return [{ results: sql.startsWith("SELECT") ? statement.all(...params) : (statement.run(...params), []) }];
  });
  const target = await verifyStagingFixtureTarget({ environmentName: "staging", accountId, expectedVersion, baseUrl: "https://staging.tembotechventures.com", api,
    fetchImpl: async () => Response.json({ service: "ttv-website", environment: "staging", version: expectedVersion, checks: { db: "ok" } }) });
  return { db, api, options: { target, signingSecret } };
}
const count = (db, table) => db.prepare(`SELECT count(*) n FROM "${table}"`).get().n;
describe("staging personas on application migrations", () => {
  it("runner verifies real SQL/API directory, bounds one simulated chat, then cleans only disposable actors",async()=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-25T09:30:00Z"));
    const {db,options}=await fixture();await seedDemoData(options.target);
    const d1=createSqliteD1(db).db;let modelRequests=0;
    const environment={GITHUB_RUN_ATTEMPT:'1',STAGING_ACTION:'retained-read-probe',STAGING_EXPECTED_SHA:options.target.expectedVersion,BETTER_AUTH_SECRET:signingSecret};
    const fetchImpl=async(url,init)=>{
      const token=init.headers.Authorization.slice(7);
      const row=db.prepare('SELECT userId FROM personal_access_token WHERE tokenHash=?').get(createHash('sha256').update(token).digest('hex'));
      expect(row).toBeDefined();const user=db.prepare('SELECT id,email FROM user WHERE id=?').get(row.userId);
      const identity=await resolveStagingFixtureIdentity({db:d1,envName:'staging',user,session:{id:'pat:test'},isPat:true,retainedProbeEnabled:'true'});
      if(init.method==='POST'){
        modelRequests++;const id=DEMO_PERSONAS.noncohort;
        const citation={kind:'journey',id:`${id}-journey-1`,userId:id,version:1};
        return Response.json({grounded:true,orderedProfiles:[{userId:id,name:'Fictional David',reason:'Published work',missingEvidence:['Testing unknown']}],evaluatedCandidates:1,answer:'Missing evidence remains unknown.',citations:[citation],retrievedSources:[citation],execution:{model:'@cf/zai-org/glm-5.3-flash',modelSteps:2,executedToolCalls:2}});
      }
      return handleCommunityRequest(new globalThis.Request(url,init),new URL(url).pathname.slice('/api/community/'.length),{id:user.id,fixture:identity,scopes:['community:read','institution:read']},d1,{DEPLOYMENT_ENVIRONMENT:'staging'});
    };
    try{
      const report=await runRetainedSearch({environment,api:async()=>({bindings:[{name:'STAGING_RETAINED_READ_PROBE_ENABLED',text:'true'},{name:'AI',type:'ai'},{name:'AI_GATEWAY_NAME',text:'ttv-website-ai-staging'}]}),validateRevision:vi.fn(),verifyTarget:async()=>options.target,fetchImpl,verifyBrowser:async({target,actor})=>{
        const response=await fetchImpl(`${target.baseUrl}/api/community/chat`,{method:'POST',headers:{Authorization:`Bearer ${actor.personalAccessToken}`}});
        return {status:response.status,data:await response.json(),latencyMs:1,screenshots:[]};
      }});
      expect(report.cleanup).toBe('verified');expect(report.directory.eligible).toBe(149);expect(modelRequests).toBe(1);
      expect(count(db,'user')).toBe(150);for(const table of ['session','personal_access_token','stagingFixtureIdentity'])expect(count(db,table)).toBe(0);
      const artifact=await readFile('test-results/staging-retained-search.json','utf8');expect(artifact).not.toContain('ttv_pat_');expect(artifact).toContain('Missing evidence remains unknown.');
    }finally{vi.useRealTimers();db.close();await rm('test-results/staging-retained-search.json',{force:true});}
  });
  it("retained mode creates only two read-only actors capped15min and revokes them even after failure",async()=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-25T09:30:00Z"));
    const {db,options}=await fixture();const audit=vi.fn();
    try {
      await expect(withStagingPersonas({...options,retainedReadProbe:true,audit,run:async personas=>{
        expect(Object.keys(personas)).toEqual(["institution","unapprovedInstitution"]);
        const identities=db.prepare('SELECT * FROM stagingFixtureIdentity').all();expect(identities).toHaveLength(2);
        for(const p of Object.values(personas)){expect(p.cookies).toEqual([]);expect(p.sessionId).toBe(`${p.userId}-retained-read-probe-session`);expect(p.expiresAt).toBeLessThanOrEqual(Math.min(Math.floor(Date.now()/1000)+900,Date.parse('2026-10-25T11:10:35Z')/1000));}
        expect(db.prepare('SELECT r.name FROM UserRoles ur JOIN Roles r ON r.id=ur.roleId').all()).toEqual([{name:'INSTITUTION'}]);
        for(const p of db.prepare('SELECT scopes FROM personal_access_token').all())expect(JSON.parse(p.scopes)).toEqual(['community:read','institution:read']);
        throw new Error('PRIVATE test provider failure');
      }})).rejects.toThrow('verification failed');
      for(const table of ['session','personal_access_token','stagingFixtureIdentity','UserRoles','user'])expect(count(db,table)).toBe(0);
      expect(JSON.stringify(audit.mock.calls)).not.toContain('PRIVATE');
    }finally{vi.useRealTimers();db.close();}
  });
  it("revokes actual fixture records when an asynchronous browser route fails", async () => {
    const { db, options } = await fixture(); const audit = vi.fn();
    let handler, routeContained = false; const close = vi.fn();
    try {
      await expect(withStagingPersonas({ ...options, audit, run: async personas => {
        const browser = { newContext: async () => ({
          route: async (pattern, callback) => { handler = callback; }, addCookies: async () => {}, close,
          request: { get: async () => ({ status: () => 200, json: async () => ({ profile: { userId: personas.member.userId } }) }) },
          newPage: async () => ({ goto: async () => {
            await handler({ request: () => ({ url: () => options.target.baseUrl + "/api/community/chat", method: () => "POST", redirectedFrom: () => null }),
              fetch: async () => { throw new Error("PRIVATE cookie=" + personas.member.cookies[0].value); },
              abort: async () => { throw new Error("PRIVATE abort"); } });
            routeContained = true;
            throw new Error("Navigation aborted");
          } }),
        }) };
        await verifyStagingPersonas({ browser, target: options.target, personas, browserChat: true, audienceEnabled: false });
      } })).rejects.toThrow("verification failed");
      expect(routeContained).toBe(true); expect(close).toHaveBeenCalledOnce();
      for (const table of ["session", "personal_access_token", "stagingFixtureIdentity", "UserRoles", "user"]) expect(count(db, table)).toBe(0);
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: "fixture-run-outcome", operationStatus: "failed", cleanupStatus: "passed" }));
      expect(JSON.stringify(audit.mock.calls)).not.toContain("PRIVATE");
    } finally { db.close(); }
  });
  it("reports failed verification separately from verified cleanup",async()=>{
    const {db,options}=await fixture();const audit=vi.fn();
    try {
      await expect(withStagingPersonas({...options,audit,run:async()=>{throw new Error("PRIVATE");}})).rejects.toThrow("verification failed");
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({event:"fixture-run-outcome",operation:"verification",operationStatus:"failed",cleanupStatus:"passed"}));
      expect(JSON.stringify(audit.mock.calls)).not.toContain("PRIVATE");
    } finally {db.close();}
  });
  it.each(["residual","unreadable"])("fails cleanup verification when counts are %s",async reason=>{
    const {db,api,options}=await fixture();const audit=vi.fn();
    const original=api.getMockImplementation();
    api.mockImplementation(async(path,args)=>{
      if(args?.body.sql.startsWith('SELECT COUNT(*)')) {
        if(reason==="unreadable")throw new Error("PRIVATE SQL binding");
        return [{results:[{remaining:1}]}];
      }
      return original(path,args);
    });
    try {
      await expect(withStagingPersonas({...options,audit,run:async()=>{}})).rejects.toThrow("cleanup failed");
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({event:"fixture-run-outcome",operationStatus:"passed",cleanupStatus:"failed"}));
      expect(JSON.stringify(audit.mock.calls)).not.toContain("PRIVATE");
    } finally {db.close();}
  });
  it.each([false,true])("dedicates only the assessment institution source session when probe=%s",async assessmentProbe=>{
    const {db,options}=await fixture();
    try {
      await withStagingPersonas({...options,assessmentProbe,run:async personas=>{
        for(const [role,p] of Object.entries(personas)) {
          expect(p.sessionId).toBe(`${p.userId}${assessmentProbe&&role==="institution"?"-assessment-session":"-session"}`);
          expect(db.prepare('SELECT sessionId FROM stagingFixtureIdentity WHERE userId=?').get(p.userId).sessionId).toBe(p.sessionId);
        }
      }});
      expect(count(db,"session")).toBe(0);
    } finally {db.close();}
  });
  it("authenticates fixture cookies through real schema/Drizzle/BetterAuth with second timestamps", async () => {
    const { db, options } = await fixture();
    const d1 = { prepare(sql) {
      const statement = db.prepare(sql);
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async raw() { statement.setReturnArrays(true); return statement.all(...params); },
        async all() { return { results: statement.all(...params) }; },
        async first() { return statement.get(...params) ?? null; },
        async run() { return { meta: statement.run(...params) }; },
      };
    } };
    const auth = createAuth({ DB: d1, BETTER_AUTH_SECRET: signingSecret, BETTER_AUTH_URL: options.target.baseUrl,
      GITHUB_CLIENT_ID: "fictional", GITHUB_CLIENT_SECRET: "fictional", AGENT_AUTH_ENABLED: "true" });
    let headers;
    let callbackError;
    try {
      await withStagingPersonas({ ...options, run: async personas => {
        try {
        const p = personas.mentor;
        headers = new globalThis.Headers({ cookie: p.cookies.map(c => `${c.name}=${c.value}`).join("; ") });
        const resolved = await auth.api.getSession({ headers });
        expect(resolved?.user.id).toBe(p.userId);
        expect(resolved?.session.id).toBe(p.sessionId);
        expect(resolved?.session.expiresAt.getTime()).toBe(p.expiresAt * 1000);
        expect(isAgentSession(resolved?.session.userAgent)).toBe(true);
        const actor = { db: d1, envName: "staging", user: resolved.user, session: resolved.session, isPat: false };
        expect(await resolveStagingFixtureIdentity(actor)).toMatchObject({ userId: p.userId, runId: p.runId, persona: "mentor" });
        db.prepare('UPDATE stagingFixtureIdentity SET expiresAt=? WHERE userId=?').run(Math.floor(Date.now() / 1000) - 1, p.userId);
        await expect(resolveStagingFixtureIdentity(actor)).rejects.toMatchObject({ status: 403 });
        db.prepare('UPDATE stagingFixtureIdentity SET expiresAt=? WHERE userId=?').run(p.expiresAt, p.userId);
        db.prepare('UPDATE session SET expiresAt=? WHERE id=?').run(Math.floor(Date.now() / 1000) - 1, p.sessionId);
        expect(await auth.api.getSession({ headers })).toBeNull();
        } catch (error) { callbackError = error; }
      } });
      if (callbackError) throw callbackError;
      expect(await auth.api.getSession({ headers })).toBeNull();
    } finally { db.close(); }
  });
  it("creates bounded synthetic roles/cookies/scoped PATs then removes all fixture records", async () => {
    const { db, options } = await fixture();
    const audit = vi.fn();
    try {
      await expect(withStagingPersonas({ ...options, audit, run: async personas => {
        expect(Object.keys(personas)).toHaveLength(6);
        expect(db.prepare('SELECT name FROM user WHERE id=?').get(personas.member.userId).name).toBe("Fictional Amina Wanjiku");
        expect(db.prepare('SELECT name FROM user WHERE id=?').get(personas.mentor.userId).name).toBe("Fictional Grace Njeri");
        expect(count(db, "session")).toBe(6);
        expect(count(db, "stagingFixtureIdentity")).toBe(6);
        expect(count(db, "personal_access_token")).toBe(3);
        expect(new Set(Object.values(personas).map(p => p.runId)).size).toBe(1);
        for (const p of Object.values(personas)) {
          expect(p.userId).toMatch(/^ttv-staging-fixture-[a-f0-9]{24}-/);
          expect(p.cookies[0].httpOnly).toBe(true);
          expect(p.expiresAt).toBeLessThanOrEqual(Date.now() / 1000 + 3601);
          expect(p.token).toBeUndefined();
        }
        const pats = db.prepare("SELECT tokenHash,scopes FROM personal_access_token").all();
        expect(pats.every(p => /^[a-f0-9]{64}$/.test(p.tokenHash))).toBe(true);
        expect(pats.some(p => p.scopes.includes("admin:"))).toBe(false);
        return "not forwarded";
      } })).resolves.toBeUndefined();
      expect(audit.mock.calls.map(([record]) => record.event)).toEqual(["fixture-run-started", "fixture-run-outcome", "fixture-run-cleaned"]);
      expect(audit.mock.calls.filter(([record]) => record.event !== "fixture-run-outcome").every(([record]) => Object.keys(record).toSorted().join(",") === "event,runId,version")).toBe(true);
      for (const table of ["session", "stagingFixtureIdentity", "personal_access_token", "UserRoles", "user"]) expect(count(db, table)).toBe(0);
    } finally { db.close(); }
  });
  it("rejects unverified targets before SQL", async () => {
    await expect(withStagingPersonas({ target: {}, signingSecret, run: vi.fn() })).rejects.toThrow("verified staging");
  });
  it("fails closed before provisioning if roles or registry are missing", async () => {
    const { db, options } = await fixture();
    try {
      db.exec("DELETE FROM Roles WHERE name='MENTOR'");
      await expect(withStagingPersonas({ ...options, run: vi.fn() })).rejects.toThrow("setup or verification failed");
      expect(count(db, "user")).toBe(0);
      db.exec("DROP TABLE stagingFixtureIdentity");
      await expect(withStagingPersonas({ ...options, run: vi.fn() })).rejects.toThrow("setup or verification failed");
      expect(count(db, "user")).toBe(0);
    } finally { db.close(); }
  });
  it("cleans partial setup and preserves real users/sessions", async () => {
    const { db, api, options } = await fixture();
    try {
      db.exec("INSERT INTO user (id,name,email) VALUES ('real','Existing user','real@example.test'); INSERT INTO session (id,userId,token,expiresAt) VALUES ('real-session','real','real-token',9999999999)");
      const original = api.getMockImplementation();
      api.mockImplementation(async (path, args) => {
        if (args?.body.sql.startsWith('INSERT INTO "user"') && args.body.params[0].endsWith("-mentor")) throw new Error("sensitive credential");
        return original(path, args);
      });
      await expect(withStagingPersonas({ ...options, run: vi.fn() })).rejects.toThrow("setup or verification failed");
      expect(db.prepare("SELECT id FROM user").all().map(r => r.id)).toEqual(["real"]);
      expect(db.prepare("SELECT id FROM session").all().map(r => r.id)).toEqual(["real-session"]);
    } finally { db.close(); }
  });
  it("cleans callback failures without leaking credentials", async () => {
    const { db, options } = await fixture();
    try {
      await expect(withStagingPersonas({ ...options, run: async p => { throw new Error(p.member.personalAccessToken); } })).rejects.toThrow(/^Staging persona setup or verification failed; inspect sanitized test evidence\.$/);
      expect(count(db, "user")).toBe(0);
    } finally { db.close(); }
  });
  it("continues cleanup after a deletion error and reports it", async () => {
    const { db, api, options } = await fixture();
    try {
      const original = api.getMockImplementation();
      api.mockImplementation(async (path, args) => {
        if (args?.body.sql.startsWith('DELETE FROM "personal_access_token"')) throw new Error("sensitive binding");
        return original(path, args);
      });
      await expect(withStagingPersonas({ ...options, run: async () => {} })).rejects.toThrow("cleanup failed");
      expect(count(db, "session")).toBe(0);
      expect(count(db, "user")).toBe(0);
      expect(count(db, "personal_access_token")).toBe(0); // user FK cascade still removes PATs
    } finally { db.close(); }
  });
});
