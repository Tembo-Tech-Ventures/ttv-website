import { pathToFileURL } from "node:url";
import { cfApi } from "./lib.mjs";
import { validateStagingRevision } from "./staging-preflight.mjs";
import { verifyStagingFixtureTarget, assertVerifiedStagingFixtureTarget, STAGING_FIXTURE_ORIGIN } from "./staging-fixture-target.mjs";

// Incident-specific containment. No caller-selected IDs, credentials or SQL.
export const INCIDENT_RUN = "8a214212f2e59c76cbff4c33";
const deployedVersion = "c96608f0d0585478f8bf9881d741e3e56467cdb8";
export const INCIDENT_USERS = Object.freeze(["institution", "unapprovedInstitution"].map(role => `ttv-staging-fixture-${INCIDENT_RUN}-${role}`));
const placeholders = INCIDENT_USERS.map(() => "?").join(",");
const rows = result => (Array.isArray(result) ? result : [result]).flatMap(statement => statement?.results ?? []);

export async function cleanupIncident(target, audit = () => {}) {
  assertVerifiedStagingFixtureTarget(target);
  if (target.expectedVersion !== deployedVersion) throw new Error("Incident deployment mismatch.");
  const execute = target.executeQuery;
  const users = rows(await execute(`SELECT id,email FROM "user" WHERE id IN (${placeholders})`, INCIDENT_USERS));
  if (users.some(user => !INCIDENT_USERS.includes(user.id) || user.email !== `${user.id}@invalid.ttv`)) throw new Error("Incident identity mismatch.");
  const count = async (table, column) => {
    const result = rows(await execute(`SELECT COUNT(*) AS remaining FROM "${table}" WHERE "${column}" IN (${placeholders})`, INCIDENT_USERS));
    return result.length === 1 && result[0].remaining === 0;
  };
  // Revoke both credential types even when one operation fails. Never select tokens.
  let failed = false;
  for (const table of ["session", "personal_access_token"]) {
    try { await execute(`DELETE FROM "${table}" WHERE "userId" IN (${placeholders})`, INCIDENT_USERS); } catch { failed = true; }
  }
  let revoked = true;
  for (const table of ["session", "personal_access_token"]) {
    try { if (!await count(table, "userId")) revoked = false; } catch { revoked = false; }
  }
  audit({ event: "incident-credentials", runId: INCIDENT_RUN, revoked });
  for (const [table, column] of [["stagingFixtureIdentity", "userId"], ["UserRoles", "userId"], ["user", "id"]]) {
    try { await execute(`DELETE FROM "${table}" WHERE "${column}" IN (${placeholders})`, INCIDENT_USERS); } catch { failed = true; }
  }
  // User deletion cascades to owned community data; independently verify those rows too.
  for (const [table, column] of [["session", "userId"], ["personal_access_token", "userId"], ["stagingFixtureIdentity", "userId"], ["UserRoles", "userId"], ["user", "id"], ["communityProfile", "userId"], ["communityJourney", "userId"], ["communityConfirmation", "mentorId"]]) {
    try { if (!await count(table, column)) failed = true; } catch { failed = true; }
  }
  audit({ event: "incident-cleanup", runId: INCIDENT_RUN, cleanup: !failed && revoked ? "passed" : "failed" });
  if (failed || !revoked) throw new Error("Incident cleanup incomplete.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.GITHUB_RUN_ATTEMPT !== "1") throw new Error("No automatic reruns.");
    await validateStagingRevision(process.env);
    const target = await verifyStagingFixtureTarget({ environmentName: process.env.CLOUDFLARE_ENVIRONMENT_NAME, accountId: process.env.CLOUDFLARE_ACCOUNT_ID, expectedVersion: deployedVersion, baseUrl: STAGING_FIXTURE_ORIGIN, api: cfApi });
    await cleanupIncident(target, record => console.log(JSON.stringify(record)));
  } catch {
    console.error("Incident cleanup failed; inspect sanitized receipts. No credential values emitted.");
    process.exitCode = 1;
  }
}
