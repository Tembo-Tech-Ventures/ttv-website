import { mkdir, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { cfApi, getSecretBindings } from "./lib.mjs";
import { validateStagingRevision } from "./staging-preflight.mjs";
import { verifyStagingFixtureTarget, STAGING_FIXTURE_ORIGIN } from "./staging-fixture-target.mjs";
import { withStagingPersonas } from "./staging-personas.mjs";
import { verifyStagingAssessment } from "./staging-assessment-verification.mjs";

const directory = "test-results/staging-assessment";
export async function runStagingAssessment({ environment = process.env, api = cfApi, getBindings = getSecretBindings,
  validateRevision = validateStagingRevision, verifyTarget = verifyStagingFixtureTarget, withPersonas = withStagingPersonas,
  verifyAssessment = verifyStagingAssessment, discard = () => rm(directory, { recursive: true, force: true }),
  publish = async evidence => { await mkdir(directory, { recursive: true }); await writeFile(`${directory}/manifest.json`, JSON.stringify(evidence, null, 2)); } } = {}) {
  await discard();
  try {
    // Rerunning a workflow must not quietly create a fresh inference allowance.
    if (environment.GITHUB_RUN_ATTEMPT !== "1") throw new Error("Assessment workflow reruns are disabled.");
    await validateRevision(environment);
    if (environment.CLOUDFLARE_ENVIRONMENT_NAME !== "staging") throw new Error("Shared staging required.");
    const target = await verifyTarget({ environmentName: "staging", accountId: environment.CLOUDFLARE_ACCOUNT_ID,
      expectedVersion: environment.STAGING_EXPECTED_SHA, baseUrl: STAGING_FIXTURE_ORIGIN, api });
    const signingSecret = getBindings().find(binding => binding.key === "BETTER_AUTH_SECRET")?.value;
    let evidence;
    await withPersonas({ target, signingSecret, audit: record => console.log(JSON.stringify(record)),
      run: async personas => { evidence = await verifyAssessment({ target, personas }); } });
    // Only fixed sanitized metadata is returned; no response text, credentials or traces.
    await publish(evidence);
  } catch {
    await discard();
    throw new Error("Synthetic assessment failed; verify cleanup before any new PM-authorized run.");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runStagingAssessment(); console.log("Synthetic assessment and cleanup completed."); }
  catch { console.error("Synthetic assessment failed; no automatic retry is allowed."); process.exitCode = 1; }
}
