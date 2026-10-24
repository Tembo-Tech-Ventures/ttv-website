import { createHash, randomBytes } from "node:crypto";
import { assertVerifiedStagingFixtureTarget } from "./staging-fixture-target.mjs";
import { createStagingBrowserCookies } from "./staging-fixture-cookies.mjs";

export const STAGING_PERSONA_ROLES = Object.freeze({
  member: null, otherMember: null, mentor: "MENTOR", institution: "INSTITUTION", unapprovedInstitution: null, admin: "ADMIN",
});
const displayNames = Object.freeze({ member: "Fictional Amina Wanjiku", otherMember: "Fictional Brian Otieno", mentor: "Fictional Grace Njeri", institution: "Fictional David Mwangi", unapprovedInstitution: "Fictional Faith Achieng", admin: "Fictional Peter Kamau" });
const rows = result => (Array.isArray(result) ? result : [result]).flatMap(statement => statement?.results ?? []);

/** Runner-only. Credentials never leave the callback; default cleanup deletes all fixture-owned records. */
export async function withStagingPersonas({ target, signingSecret, run, audit = () => {}, now = new Date(), assessmentProbe = false }) {
  assertVerifiedStagingFixtureTarget(target);
  if (typeof run !== "function" || typeof signingSecret !== "string" || signingSecret.length < 32) throw new Error("A verification callback and staging signing configuration are required.");
  const timestamp = Math.floor(now.getTime() / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 60) throw new Error("Invalid fixture time.");
  const runId = randomBytes(12).toString("hex");
  const namespace = `ttv-staging-fixture-${runId}`;
  const marker = `ttv-agent:synthetic-staging:${runId}`;
  const execute = target.executeQuery;
  const userIds = [];
  const personas = {};
  let failure;
  let operation = "setup";
  let operationStatus = "failed";
  let cleanupStatus = "not-needed";
  try {
    audit({ event: "fixture-run-started", runId, version: target.expectedVersion });
    // Fail closed before identities are inserted if migrations have not landed.
    await execute('SELECT "userId","sessionId","runId","persona","expiresAt" FROM "stagingFixtureIdentity" LIMIT 0');
    const roles = {};
    for (const role of ["ADMIN", "MENTOR", "INSTITUTION"]) {
      const found = rows(await execute('SELECT "id" FROM "Roles" WHERE "name"=? LIMIT 1', [role]));
      if (!found[0]?.id) throw new Error("Required role migration missing");
      roles[role] = found[0].id;
    }
    for (const [persona, role] of Object.entries(STAGING_PERSONA_ROLES)) {
      const userId = `${namespace}-${persona}`;
      const sessionId = `${userId}${assessmentProbe === true && persona === "institution" ? "-assessment-session" : "-session"}`;
      const expiresAt = timestamp + 3600;
      userIds.push(userId);
      await execute('INSERT INTO "user" ("id","name","email","emailVerified","createdAt","updatedAt") VALUES (?,?,?,1,?,?)',
        [userId, displayNames[persona], `${userId}@invalid.ttv`, timestamp, timestamp]);
      if (role) await execute('INSERT INTO "UserRoles" ("id","userId","roleId","createdAt","updatedAt") VALUES (?,?,?,?,?)',
        [`${userId}-role`, userId, roles[role], timestamp, timestamp]);
      const token = randomBytes(32).toString("hex");
      await execute('INSERT INTO "session" ("id","expiresAt","token","userAgent","userId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)',
        [sessionId, expiresAt, token, marker, userId, timestamp, timestamp]);
      await execute('INSERT INTO "stagingFixtureIdentity" ("userId","sessionId","runId","persona","expiresAt") VALUES (?,?,?,?,?)',
        [userId, sessionId, runId, persona, expiresAt]);
      const cookies = createStagingBrowserCookies({ baseUrl: target.baseUrl, secret: signingSecret, token, expiresAt });
      let personalAccessToken;
      if (["member", "institution", "unapprovedInstitution"].includes(persona)) {
        personalAccessToken = `ttv_pat_${randomBytes(32).toString("hex")}`;
      const scopes = ["community:read", ...(persona === "member" ? ["community:write"] : []), ...(["institution", "unapprovedInstitution"].includes(persona) ? ["institution:read"] : [])];
        await execute('INSERT INTO "personal_access_token" ("id","userId","tokenHash","tokenPrefix","label","scopes","expiresAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)',
          [`${userId}-pat`, userId, createHash("sha256").update(personalAccessToken).digest("hex"), personalAccessToken.slice(0, 16), "Synthetic staging fixture", JSON.stringify(scopes), expiresAt, timestamp, timestamp]);
      }
      personas[persona] = { userId, sessionId, runId, expiresAt, cookies, personalAccessToken };
    }
    operation = "verification";
    await run(personas);
    operationStatus = "passed";
  } catch {
    failure = new Error("Staging persona setup or verification failed; inspect sanitized test evidence.");
  } finally {
    // Delete explicit IDs created by this run only, including interrupted setup.
    // Attempt every cleanup phase even if a previous delete failed.
    if (userIds.length > 0) {
      cleanupStatus = "passed";
      const placeholders = userIds.map(() => "?").join(",");
      const operations = [
        ['DELETE FROM "stagingFixtureIdentity" WHERE "runId"=? AND "userId" IN (' + placeholders + ')', [runId, ...userIds]],
        ['DELETE FROM "personal_access_token" WHERE "userId" IN (' + placeholders + ')', userIds],
        ['DELETE FROM "session" WHERE "userId" IN (' + placeholders + ')', userIds],
        ['DELETE FROM "UserRoles" WHERE "userId" IN (' + placeholders + ')', userIds],
        ['DELETE FROM "user" WHERE "id" IN (' + placeholders + ')', userIds],
      ];
      for (const [sql, params] of operations) {
        try { await execute(sql, params); }
        catch { cleanupStatus = "failed"; failure = new Error("Staging persona cleanup failed; credentials expire within one hour. Review this run's cleanup."); }
      }
      // Verify only this run's explicit IDs; never select session/token values.
      for (const table of ["stagingFixtureIdentity", "personal_access_token", "session", "UserRoles", "user"]) {
        const column = table === "user" ? "id" : "userId";
        try {
          const remaining = rows(await execute(`SELECT COUNT(*) AS remaining FROM "${table}" WHERE "${column}" IN (${placeholders})`, userIds));
          if (remaining.length !== 1 || remaining[0].remaining !== 0) {
            cleanupStatus = "failed";
            failure = new Error("Staging persona cleanup failed; credentials expire within one hour. Review this run's cleanup.");
          }
        } catch {
          cleanupStatus = "failed";
          failure = new Error("Staging persona cleanup failed; credentials expire within one hour. Review this run's cleanup.");
        }
      }
    }
  }
  audit({ event: "fixture-run-outcome", runId, version: target.expectedVersion, operation, operationStatus, cleanupStatus });
  audit({ event: failure ? "fixture-run-failed" : "fixture-run-cleaned", runId, version: target.expectedVersion });
  if (failure) throw failure;
}
