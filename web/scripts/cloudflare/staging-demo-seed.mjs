import { pathToFileURL } from "node:url";
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
  if (env.STAGING_ACTION !== "seed-demo" || env.GITHUB_RUN_ATTEMPT !== "1") throw new Error("One seed-demo dispatch is required.");
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runDemoSeed(process.env))); }
  catch (error) { console.error(JSON.stringify(error.diagnostic ?? { event: "retained-demo-seed-failed", stage: "dispatch-guard" })); process.exitCode = 1; }
}
