import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { cfApi, getSecretBindings } from "./lib.mjs";
import { validateStagingRevision } from "./staging-preflight.mjs";
import { verifyStagingFixtureTarget, STAGING_FIXTURE_ORIGIN } from "./staging-fixture-target.mjs";
import { withStagingPersonas } from "./staging-personas.mjs";
import { verifyStagingPersonas } from "./staging-fixture-verification.mjs";

export async function runStagingFixtures({ environment = process.env, api = cfApi, browserType = chromium, getBindings = getSecretBindings, validateRevision = validateStagingRevision, verifyTarget = verifyStagingFixtureTarget, withPersonas = withStagingPersonas, verifyPersonas = verifyStagingPersonas } = {}) {
  // Repeat the GitHub check inside the credentialed runner immediately before writes.
  await validateRevision(environment);
  if (environment.CLOUDFLARE_ENVIRONMENT_NAME !== "staging") throw new Error("Shared staging required.");
  const target = await verifyTarget({ environmentName: "staging", accountId: environment.CLOUDFLARE_ACCOUNT_ID,
    expectedVersion: environment.STAGING_EXPECTED_SHA, baseUrl: STAGING_FIXTURE_ORIGIN, api });
  const signingSecret = getBindings().find(binding => binding.key === "BETTER_AUTH_SECRET")?.value;
  let browser;
  try {
    browser = await browserType.launch({ headless: true });
    await withPersonas({ target, signingSecret, audit: record => console.log(JSON.stringify(record)), run: personas => verifyPersonas({ browser, target, personas }) });
  } finally {
    await browser?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runStagingFixtures();
    console.log("Synthetic staging browser/PAT checks and fixture cleanup passed.");
  } catch {
    // Browser/provider exceptions can embed headers, SQL bindings or page contents.
    console.error("Synthetic staging verification failed. Inspect the fixed checks and sanitized evidence; verify cleanup before retrying.");
    process.exitCode = 1;
  }
}
