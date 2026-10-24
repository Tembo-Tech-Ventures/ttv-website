import { randomBytes } from "node:crypto";

export const STAGING_PERSONA_ROLES = Object.freeze({
  member: null,
  otherMember: null,
  mentor: "MENTOR",
  institution: "INSTITUTION",
  unapprovedInstitution: null,
});

/**
 * Runner-only capability; never expose as an application endpoint.
 * The caller resolves database metadata from Cloudflare, then supplies an
 * executor bound to that verified database. Tokens exist only in this callback
 * and D1, not workflow outputs, arguments, artifacts or logs.
 */
export async function withStagingPersonas({
  environmentName,
  database,
  executeQuery,
  run,
  now = new Date(),
}) {
  if (environmentName !== "staging" || database?.name !== "ttv-website-db-staging" ||
      !database?.uuid) {
    throw new Error("Synthetic personas require the exact shared staging database.");
  }
  if (typeof executeQuery !== "function" || typeof run !== "function") {
    throw new TypeError("A database executor and verification callback are required.");
  }
  const timestamp = Math.floor(now.getTime() / 1000);
  if (!Number.isSafeInteger(timestamp)) throw new Error("Invalid fixture time.");
  const namespace = `ttv-hackathon-demo-${randomBytes(12).toString("hex")}`;
  const personas = {};
  const userIds = [];
  let failure;
  try {
    // Roles must come from the application's idempotent migrations, not this
    // seeder. Fail before creating identities when a migration is missing.
    const roles = {};
    for (const role of ["MENTOR", "INSTITUTION"]) {
      const result = await executeQuery(database.uuid,
        'SELECT "id" FROM "Roles" WHERE "name" = ? LIMIT 1', [role]);
      const rows = (Array.isArray(result) ? result : [result])
        .flatMap((statement) => statement?.results ?? []);
      if (!rows[0]?.id) throw new Error("Required persona role migration is missing.");
      roles[role] = rows[0].id;
    }
    for (const [persona, role] of Object.entries(STAGING_PERSONA_ROLES)) {
      const userId = `${namespace}-${persona}`;
      userIds.push(userId);
      await executeQuery(database.uuid,
        'INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)',
        [userId, `Fictional demo ${persona}`, `${userId}@invalid.ttv`, timestamp, timestamp]);
      if (role) {
        await executeQuery(database.uuid,
          'INSERT INTO "UserRoles" ("id", "userId", "roleId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)',
          [`${userId}-role`, userId, roles[role], timestamp, timestamp]);
      }
      const token = randomBytes(32).toString("hex");
      await executeQuery(database.uuid,
        'INSERT INTO "session" ("id", "expiresAt", "token", "userAgent", "userId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
        [`${userId}-session`, timestamp + 3600, token, "ttv-hackathon:synthetic-staging", userId, timestamp, timestamp]);
      personas[persona] = { userId, token, expiresAt: timestamp + 3600 };
    }
    await run(personas);
    // Deliberately do not forward the callback result (it could contain tokens).
  } catch {
    // D1/client error bodies can echo SQL bindings, including session tokens.
    failure = new Error("Staging persona setup or verification failed; inspect sanitized test evidence.");
  } finally {
    // Revoke only sessions created by this invocation, including partial setup.
    // Keep labelled fictional data for reviewed screenshots; no broad deletion.
    if (userIds.length > 0) {
      try {
        await executeQuery(database.uuid,
          `DELETE FROM "session" WHERE "userId" IN (${userIds.map(() => "?").join(", ")}) AND "userAgent" = ?`,
          [...userIds, "ttv-hackathon:synthetic-staging"]);
      } catch {
        failure = new Error("Staging persona session cleanup failed; sessions expire within one hour.");
      }
    }
  }
  if (failure) throw failure;
}
