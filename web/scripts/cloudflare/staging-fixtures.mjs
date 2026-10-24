import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { cfApi, getSecretBindings } from "./lib.mjs";
import { validateStagingRevision } from "./staging-preflight.mjs";
import { verifyStagingFixtureTarget, STAGING_FIXTURE_ORIGIN } from "./staging-fixture-target.mjs";
import { withStagingPersonas } from "./staging-personas.mjs";
import { verifyStagingPersonas } from "./staging-fixture-verification.mjs";
import { discardCommunityEvidence, sealCommunityEvidence } from "./staging-community-evidence.mjs";

export async function runStagingFixtures({ environment = process.env, api = cfApi, browserType = chromium, getBindings = getSecretBindings, validateRevision = validateStagingRevision, verifyTarget = verifyStagingFixtureTarget, withPersonas = withStagingPersonas, verifyPersonas = verifyStagingPersonas, discardEvidence = discardCommunityEvidence, sealEvidence = sealCommunityEvidence } = {}) {
  const browserChat = environment.STAGING_BROWSER_CHAT === "true";
  if (![undefined, "false", "true"].includes(environment.STAGING_BROWSER_CHAT)) throw new Error("Invalid browser chat option.");
  const browserAssessment = environment.STAGING_BROWSER_ASSESSMENT === "true";
  if (![undefined, "false", "true"].includes(environment.STAGING_BROWSER_ASSESSMENT)) throw new Error("Invalid browser assessment option.");
  if (browserChat && browserAssessment) throw new Error("Select only one inference verification.");
  if ((browserChat || browserAssessment) && environment.GITHUB_RUN_ATTEMPT !== "1") throw new Error("Inference workflow reruns are disabled.");
  await discardEvidence();
  try {
    // Repeat the GitHub check inside the credentialed runner immediately before writes.
    await validateRevision(environment);
    if (environment.CLOUDFLARE_ENVIRONMENT_NAME !== "staging") throw new Error("Shared staging required.");
    const target = await verifyTarget({ environmentName: "staging", accountId: environment.CLOUDFLARE_ACCOUNT_ID,
      expectedVersion: environment.STAGING_EXPECTED_SHA, baseUrl: STAGING_FIXTURE_ORIGIN, api });
    if (browserChat || browserAssessment) {
      const settings = await api("/workers/scripts/ttv-website-staging/settings");
      const bindings = Array.isArray(settings?.bindings) ? settings.bindings : [];
      if (!bindings.some(b => b?.name === "AI" && b.type === "ai") || !bindings.some(b => b?.name === "AI_GATEWAY_NAME" && b.type === "plain_text" && b.text === "ttv-website-ai-staging")) throw new Error("Inference binding readiness failed.");
    }
    const signingSecret = getBindings().find(binding => binding.key === "BETTER_AUTH_SECRET")?.value;
    let browser;
    try {
      browser = await browserType.launch({ headless: true });
      await withPersonas({ target, signingSecret, assessmentProbe: browserAssessment, audit: record => console.log(JSON.stringify(record)), run: personas => verifyPersonas({ browser, target, personas, browserAssessment, browserChat }) });
    } finally {
      await browser?.close();
    }
    await sealEvidence(environment.STAGING_EXPECTED_SHA);
  } catch (error) {
    await discardEvidence();
    throw error;
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
