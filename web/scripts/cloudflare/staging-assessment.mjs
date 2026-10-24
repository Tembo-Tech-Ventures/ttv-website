import { mkdir, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { cfApi, getSecretBindings } from "./lib.mjs";
import { validateStagingRevision } from "./staging-preflight.mjs";
import { verifyStagingFixtureTarget, STAGING_FIXTURE_ORIGIN } from "./staging-fixture-target.mjs";
import { withStagingPersonas } from "./staging-personas.mjs";
import { verifyStagingAssessment } from "./staging-assessment-verification.mjs";

const directory = "test-results/staging-assessment";
const stages = new Set(["client-preflight", "profile-write", "journey-write", "denied-role", "no-evidence", "assessment", "assessment-validation", "consumed-session"]);
const codes = new Set(["started", "http-response", "validation-failed", "transport-failed", "response-too-large", "response-read-failed", "response-json-invalid", "assessment-response"]);
export async function runStagingAssessment({ environment = process.env, api = cfApi, getBindings = getSecretBindings,
  validateRevision = validateStagingRevision, verifyTarget = verifyStagingFixtureTarget, withPersonas = withStagingPersonas,
  verifyAssessment = verifyStagingAssessment, discard = () => rm(directory, { recursive: true, force: true }),
  publish = async evidence => { await mkdir(directory, { recursive: true }); await writeFile(`${directory}/manifest.json`, JSON.stringify(evidence, null, 2)); },
  publishFailure = async evidence => { await mkdir(directory, { recursive: true }); await writeFile(`${directory}/failure.json`, JSON.stringify(evidence, null, 2)); },
  audit = record => console.log(JSON.stringify(record)) } = {}) {
  const diagnostic = { stage: "runner-preflight", code: "started", httpStatus: null, claim: "unknown", assessmentStatus: "unknown", assessmentErrorCode: "unknown" };
  let lifecycle = { operation: "unknown", operationStatus: "unknown", cleanupStatus: "not-started" };
  const progress = record => {
    if (!stages.has(record?.stage) || !codes.has(record?.code)) return;
    if (record.stage !== diagnostic.stage) diagnostic.httpStatus = null;
    if (record.stage === "assessment") {
      if (typeof record.claimed === "boolean") diagnostic.claim = record.claimed;
      if (["completed", "unavailable", "invalid_output"].includes(record.assessmentStatus)) diagnostic.assessmentStatus = record.assessmentStatus;
      if (["provider_unavailable", "invalid_output"].includes(record.assessmentErrorCode)) diagnostic.assessmentErrorCode = record.assessmentErrorCode;
      for (const key of ["payloadBytes", "payloadCharacters"]) if (Number.isInteger(record[key]) && record[key] >= 0 && record[key] <= 8000) diagnostic[key] = record[key];
    }
    diagnostic.stage = record.stage;
    diagnostic.code = record.code;
    if (Number.isInteger(record.httpStatus) && record.httpStatus >= 100 && record.httpStatus <= 599) diagnostic.httpStatus = record.httpStatus;
  };
  await discard();
  try {
    // Rerunning a workflow must not quietly create a fresh inference allowance.
    if (environment.GITHUB_RUN_ATTEMPT !== "1") throw new Error("Assessment workflow reruns are disabled.");
    diagnostic.stage = "revision-preflight";
    await validateRevision(environment);
    if (environment.CLOUDFLARE_ENVIRONMENT_NAME !== "staging") throw new Error("Shared staging required.");
    diagnostic.stage = "target-preflight";
    const target = await verifyTarget({ environmentName: "staging", accountId: environment.CLOUDFLARE_ACCOUNT_ID,
      expectedVersion: environment.STAGING_EXPECTED_SHA, baseUrl: STAGING_FIXTURE_ORIGIN, api });
    diagnostic.stage = "provider-readiness";
    const settings = await api("/workers/scripts/ttv-website-staging/settings");
    const bindings = Array.isArray(settings?.bindings) ? settings.bindings : [];
    // Native inference uses the preauthenticated AI binding, not an HTTP token.
    // This fixed staging runner must not route to another environment's gateway.
    if (!bindings.some(b => b?.name === "AI" && b.type === "ai") ||
        !bindings.some(b => b?.name === "AI_GATEWAY_NAME" && b.type === "plain_text" &&
          b.text === "ttv-website-ai-staging")) {
      diagnostic.code = "required-binding-missing";
      throw new Error("Assessment binding readiness failed.");
    }
    diagnostic.stage = "signing-configuration";
    const signingSecret = getBindings().find(binding => binding.key === "BETTER_AUTH_SECRET")?.value;
    let evidence;
    diagnostic.stage = "fixture-setup";
    await withPersonas({ target, signingSecret, assessmentProbe: true, audit: record => {
      // Only locally generated enums pass through. Never forward arbitrary audit fields.
      if (record?.event === "fixture-run-outcome" && ["setup", "verification"].includes(record.operation) &&
          ["passed", "failed"].includes(record.operationStatus) && ["passed", "failed", "not-needed"].includes(record.cleanupStatus)) {
        lifecycle = { operation: record.operation, operationStatus: record.operationStatus, cleanupStatus: record.cleanupStatus };
        audit({ event: "assessment-fixture-outcome", ...lifecycle });
      }
    }, run: async personas => { evidence = await verifyAssessment({ target, personas, progress }); } });
    // Only fixed sanitized metadata is returned; no response text, credentials or traces.
    Object.assign(diagnostic, { stage: "success-artifact", code: "started", httpStatus: null });
    await publish(evidence);
  } catch {
    await discard();
    if (diagnostic.code === "started") diagnostic.code = "operation-failed";
    const failure = { schemaVersion: 1, status: "failed", synthetic: true,
      expectedVersion: /^[a-f0-9]{40}$/.test(environment.STAGING_EXPECTED_SHA ?? "") ? environment.STAGING_EXPECTED_SHA : null,
      ...diagnostic, ...lifecycle, providerInvocation: "unknown", billing: "unavailable", retryAllowed: false };
    audit({ event: "assessment-failed", ...failure });
    await publishFailure(failure);
    throw new Error("Synthetic assessment failed; verify cleanup before any new PM-authorized run.");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runStagingAssessment(); console.log("Synthetic assessment and cleanup completed."); }
  catch { console.error("Synthetic assessment failed; no automatic retry is allowed."); process.exitCode = 1; }
}
