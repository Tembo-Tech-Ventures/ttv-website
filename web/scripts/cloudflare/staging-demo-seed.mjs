import { pathToFileURL } from "node:url";
import { cfApi } from "./lib.mjs";
import { validateStagingRevision } from "./staging-preflight.mjs";
import { verifyStagingFixtureTarget, STAGING_FIXTURE_ORIGIN } from "./staging-fixture-target.mjs";

// The reviewed seed module is delivered by PR210. This executor never creates
// sessions or enables demo access, and retains the fictional data after success.
export async function runDemoSeed(env, {
  validate = validateStagingRevision,
  verify = verifyStagingFixtureTarget,
  seed = async target => (await import(new URL("./staging-demo-data.mjs", import.meta.url).href)).seedDemoData(target),
  api = cfApi,
} = {}) {
  if (env.STAGING_ACTION !== "seed-demo" || env.GITHUB_RUN_ATTEMPT !== "1") throw new Error("One seed-demo dispatch is required.");
  const { sha } = await validate(env);
  const target = await verify({ environmentName: env.CLOUDFLARE_ENVIRONMENT_NAME, accountId: env.CLOUDFLARE_ACCOUNT_ID, expectedVersion: sha, baseUrl: STAGING_FIXTURE_ORIGIN, api });
  const result = await seed(target);
  // Only counts and the already-public deployment revision enter the receipt.
  return { event: "retained-demo-seeded", version: sha, profiles: result.profiles, cohortMembers: result.cohortMembers, retained: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runDemoSeed(process.env))); }
  catch { console.error("Retained demo seed failed. No credential or record values emitted."); process.exitCode = 1; }
}
