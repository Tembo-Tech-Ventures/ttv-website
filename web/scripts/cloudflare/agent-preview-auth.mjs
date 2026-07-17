import { createHmac } from "node:crypto";

const MINIMUM_PREVIEW_SECRET_LENGTH = 32;
const PREVIEW_TOKEN_CONTEXT = "ttv-agent-preview-token";
const PREVIEW_AUTH_SECRET_CONTEXT = "ttv-agent-preview-auth-secret";

export const AGENT_PREVIEW_USER_ID = "ttv-agent-preview-user";
export const AGENT_PREVIEW_SESSION_ID = "ttv-agent-preview-session";
export const AGENT_PREVIEW_SESSION_MARKER = "ttv-agent:isolated-preview";

export function isAgentEnvironmentName(value) {
  return /^agent-[a-z0-9](?:[a-z0-9-]{0,32}[a-z0-9])?$/.test(value);
}

export function assertAgentEnvironmentName(value) {
  if (!isAgentEnvironmentName(value)) {
    throw new Error(
      `Agent environment names must start with "agent-", contain at most 40 lowercase letters, numbers, or hyphens, and may not end in a hyphen; received "${value}".`
    );
  }
  return value;
}

function assertPreviewSecret(secret) {
  if (secret.length < MINIMUM_PREVIEW_SECRET_LENGTH) {
    throw new Error(
      `AGENT_PREVIEW_SECRET must contain at least ${MINIMUM_PREVIEW_SECRET_LENGTH} characters.`
    );
  }
}

function deriveSecret(secret, environmentName, context) {
  assertPreviewSecret(secret);
  assertAgentEnvironmentName(environmentName);
  return createHmac("sha256", secret)
    .update(`${context}:${environmentName}`)
    .digest("hex");
}

export function deriveAgentPreviewToken(secret, environmentName) {
  return deriveSecret(secret, environmentName, PREVIEW_TOKEN_CONTEXT);
}

export function deriveAgentPreviewAuthSecret(secret, environmentName) {
  return deriveSecret(secret, environmentName, PREVIEW_AUTH_SECRET_CONTEXT);
}

function firstQueryRow(result) {
  const statements = Array.isArray(result) ? result : [result];
  return statements.flatMap((statement) => statement?.results ?? [])[0];
}

export async function seedAgentPreviewAccess({
  databaseId,
  environmentName,
  previewSecret,
  executeQuery,
  now = new Date(),
}) {
  assertAgentEnvironmentName(environmentName);
  if (!databaseId) throw new Error("A D1 database ID is required.");
  if (typeof executeQuery !== "function") {
    throw new Error("A D1 query executor is required.");
  }

  const createdAt = Math.floor(now.getTime() / 1_000);
  const expiresAt = createdAt + 8 * 60 * 60;
  const token = deriveAgentPreviewToken(previewSecret, environmentName);

  await executeQuery(
    databaseId,
    `INSERT INTO "user"
      ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 1, NULL, ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "name" = excluded."name",
       "email" = excluded."email",
       "emailVerified" = 1,
       "updatedAt" = excluded."updatedAt"`,
    [
      AGENT_PREVIEW_USER_ID,
      "TTV Preview Agent",
      "agent-preview@invalid.ttv",
      createdAt,
      createdAt,
    ]
  );

  await executeQuery(
    databaseId,
    `INSERT INTO "Roles" ("id", "name", "createdAt", "updatedAt")
     VALUES (?, 'ADMIN', ?, ?)
     ON CONFLICT("name") DO NOTHING`,
    ["ttv-agent-preview-admin-role", createdAt, createdAt]
  );

  const roleResult = await executeQuery(
    databaseId,
    `SELECT "id" FROM "Roles" WHERE "name" = 'ADMIN' LIMIT 1`,
    []
  );
  const roleId = firstQueryRow(roleResult)?.id;
  if (!roleId) throw new Error("Unable to resolve the preview ADMIN role.");

  await executeQuery(
    databaseId,
    `INSERT INTO "UserRoles"
      ("id", "userId", "roleId", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "userId" = excluded."userId",
       "roleId" = excluded."roleId",
       "updatedAt" = excluded."updatedAt"`,
    ["ttv-agent-preview-user-role", AGENT_PREVIEW_USER_ID, roleId, createdAt, createdAt]
  );

  await executeQuery(
    databaseId,
    `INSERT INTO "session"
      ("id", "expiresAt", "token", "ipAddress", "userAgent", "userId", "createdAt", "updatedAt")
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "expiresAt" = excluded."expiresAt",
       "token" = excluded."token",
       "ipAddress" = NULL,
       "userAgent" = excluded."userAgent",
       "userId" = excluded."userId",
       "updatedAt" = excluded."updatedAt"`,
    [
      AGENT_PREVIEW_SESSION_ID,
      expiresAt,
      token,
      AGENT_PREVIEW_SESSION_MARKER,
      AGENT_PREVIEW_USER_ID,
      createdAt,
      createdAt,
    ]
  );

  return {
    userId: AGENT_PREVIEW_USER_ID,
    sessionId: AGENT_PREVIEW_SESSION_ID,
    expiresAt: new Date(expiresAt * 1_000),
  };
}
