import { pathToFileURL } from "node:url";
import { buildDemoDataset } from "./staging-demo-data.mjs";
import { cfApi } from "./lib.mjs";
import { validateStagingRevision } from "./staging-preflight.mjs";
import { verifyStagingFixtureTarget, STAGING_FIXTURE_ORIGIN, STAGING_FIXTURE_DATABASE_ID } from "./staging-fixture-target.mjs";

// The reviewed seed module is delivered by PR210. This executor never creates
// sessions or enables demo access, and retains the fictional data after success.
export async function runDemoSeed(env, {
  validate = validateStagingRevision,
  verify = verifyStagingFixtureTarget,
  seed = async target => (await import(new URL("./staging-demo-data.mjs", import.meta.url).href)).seedDemoData(target),
  api = cfApi,
} = {}) {
  if (env.STAGING_ACTION !== "seed-demo" || env.GITHUB_RUN_ATTEMPT !== "1" || env.STAGING_EXPECTED_DEPLOYED_SHA) throw new Error("One seed-demo dispatch is required.");
  let stage = "revision";
  let readsCompleted = 0;
  let writesAttempted = 0;
  let writesCompleted = 0;
  const observedApi = async (path, options) => {
    const query = path === `/d1/database/${STAGING_FIXTURE_DATABASE_ID}/query`;
    const read = query && /^\s*SELECT\b/i.test(options?.body?.sql ?? "");
    stage = query ? (read ? "seed-read" : "seed-write") :
      path === "" ? "account" : path.endsWith("/settings") ? "worker-identity" : "database-identity";
    if (query && !read) writesAttempted++;
    const result = await api(path, options);
    if (query && read) readsCompleted++;
    if (query && !read) writesCompleted++;
    if (!query && path.startsWith("/d1/database/")) stage = "health-identity";
    return result;
  };
  try {
    const { sha } = await validate(env);
    stage = "target-identity";
    const target = await verify({ environmentName: env.CLOUDFLARE_ENVIRONMENT_NAME, accountId: env.CLOUDFLARE_ACCOUNT_ID, expectedVersion: sha, baseUrl: STAGING_FIXTURE_ORIGIN, api: observedApi });
    stage = "seed-module";
    const result = await seed(target);
    return { event: "retained-demo-seeded", version: sha, profiles: result.profiles, cohortMembers: result.cohortMembers, retained: true };
  } catch {
    // Never attach the upstream error: it may contain credentials or SQL values.
    const error = new Error("Retained demo seed failed.");
    error.diagnostic = Object.freeze({ event: "retained-demo-seed-failed", stage, readsCompleted, writesAttempted, writesCompleted,
      writeState: writesAttempted === 0 ? "not-started" : "partial-or-complete-unknown" });
    throw error;
  }
}

// Read-only demo readiness: require the exact current integration revision live.
export async function runDemoDiagnostic(env, { validate = validateStagingRevision, verify = verifyStagingFixtureTarget, api = cfApi } = {}) {
  try {
    if (env.STAGING_ACTION !== "diagnose-demo" || env.GITHUB_RUN_ATTEMPT !== "1" ||
        !/^([a-f0-9]{40})$/.test(env.STAGING_EXPECTED_SHA ?? "") ||
        env.STAGING_EXPECTED_DEPLOYED_SHA !== env.STAGING_EXPECTED_SHA) throw new Error();
    const { sha } = await validate(env);
    const target = await verify({ environmentName: env.CLOUDFLARE_ENVIRONMENT_NAME, accountId: env.CLOUDFLARE_ACCOUNT_ID,
      expectedVersion: sha, baseUrl: STAGING_FIXTURE_ORIGIN, api });
    const aggregate = async (sql, params) => {
      const result = await target.executeQuery(sql, params);
      const envelopes = Array.isArray(result) ? result : [result];
      if (envelopes.some(item => item?.success === false)) throw new Error();
      const rows = envelopes.flatMap(item => item?.results ?? []);
      if (rows.length !== 1 || !Number.isSafeInteger(rows[0].total) || rows[0].total < 0) throw new Error();
      return rows[0].total;
    };
    const requiredRoles = {};
    for (const name of ["MENTOR", "INSTITUTION", "STUDENT"]) {
      const count = await aggregate('SELECT COUNT(*) AS total FROM "Roles" WHERE name = ?', [name]);
      requiredRoles[name] = count === 1;
    }
    const records = buildDemoDataset();
    records.UserRoles = [records.user[0], records.user[1], ...records.programApplication.map(application => ({ id: application.userId }))].map(user => ({id: `${user.id}-role`}));
    const ownedCounts = {};
    for (const [table, list] of Object.entries(records)) {
      const key = table === "communityProfile" ? "userId" : "id";
      let total = 0;
      for (let start = 0; start < list.length; start += 40) {
        const ids = list.slice(start, start + 40).map(record => record[key]);
        total += await aggregate(`SELECT COUNT(*) AS total FROM "${table}" WHERE "${key}" IN (${ids.map(() => "?").join(",")})`, ids);
      }
      ownedCounts[table] = total;
    }
    const prefix="ttv-staging-demo-v1-";
    const personas={};
    for(const [persona,role] of [["member-cohort",null],["member-noncohort",null],["mentor","MENTOR"],["institution","INSTITUTION"]]) {
      const id=prefix+persona;
      const user=await aggregate('SELECT COUNT(*) AS total FROM user WHERE id=? AND email=?',[id,id+'@invalid.ttv']);
      const roles=await aggregate('SELECT COUNT(*) AS total FROM UserRoles WHERE userId=?',[id]);
      const matching=role ? await aggregate('SELECT COUNT(*) AS total FROM UserRoles ur JOIN Roles r ON r.id=ur.roleId WHERE ur.userId=? AND r.name=?',[id,role]) : 0;
      const membership=persona.startsWith('member-') ? await aggregate("SELECT COUNT(*) AS total FROM programApplication a JOIN program p ON p.id=a.programId WHERE a.userId=? AND a.programId=? AND a.status='APPROVED' AND p.curriculumId=? AND p.applicationsOpen=0",[id,prefix+'program',prefix+'curriculum']) : 0;
      personas[persona]=user===1 && roles===(role?1:0) && matching===(role?1:0) && membership===(persona==='member-cohort'?1:0);
    }
    let syntheticPeople=0;
    for(let start=0;start<records.user.length;start+=40) {
      const ids=records.user.slice(start,start+40).map(u=>u.id);
      syntheticPeople+=await aggregate(`SELECT COUNT(*) AS total FROM user WHERE id IN (${ids.map(()=>'?').join(',')}) AND email=id||'@invalid.ttv'`,ids);
    }
    return { event: "retained-demo-diagnostic", executorVersion: sha, deployedVersion: sha, requiredRoles, ownedCounts, syntheticPeople, personas };
  } catch {
    throw new Error("Read-only retained demo diagnostic failed; no record values emitted.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await (process.env.STAGING_ACTION === "diagnose-demo" ? runDemoDiagnostic(process.env) : runDemoSeed(process.env)))); }
  catch (error) { console.error(JSON.stringify(error.diagnostic ?? { event: process.env.STAGING_ACTION === "diagnose-demo" ? "retained-demo-diagnostic-failed" : "retained-demo-seed-failed", stage: "dispatch-guard" })); process.exitCode = 1; }
}
