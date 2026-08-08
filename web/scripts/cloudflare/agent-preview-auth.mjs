import { createHmac } from "node:crypto";
import { Buffer } from "node:buffer";

const MINIMUM_PREVIEW_SECRET_LENGTH = 32;
const PREVIEW_TOKEN_CONTEXT = "ttv-agent-preview-token";
const PREVIEW_AUTH_SECRET_CONTEXT = "ttv-agent-preview-auth-secret";
const PREVIEW_CREDENTIAL_KEY_CONTEXT = "ttv-agent-preview-credential-key";

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

export function deriveAgentPreviewCredentialKey(secret, environmentName) {
  return Buffer.from(
    deriveSecret(secret, environmentName, PREVIEW_CREDENTIAL_KEY_CONTEXT),
    "hex"
  )
    .subarray(0, 32)
    .toString("base64");
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
    [
      "ttv-agent-preview-user-role",
      AGENT_PREVIEW_USER_ID,
      roleId,
      createdAt,
      createdAt,
    ]
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

export async function seedAgentPreviewFixtures({
  databaseId,
  executeQuery,
  now = new Date(),
}) {
  if (!databaseId) throw new Error("A D1 database ID is required.");
  if (typeof executeQuery !== "function") {
    throw new Error("A D1 query executor is required.");
  }

  const createdAt = Math.floor(now.getTime() / 1_000);
  const completedAt = createdAt;
  const publishedAt = createdAt;

  // Reset the preview user's own profile so every deploy starts pristine:
  // live journeys create and publish it, and per-feature suites assert the
  // no-profile gate states. Cascading deletes clear its highlights, leads,
  // and project interests.
  await executeQuery(
    databaseId,
    `DELETE FROM "studentProfile" WHERE "userId" = ?`,
    [AGENT_PREVIEW_USER_ID]
  );

  // Curriculum
  await executeQuery(
    databaseId,
    `INSERT INTO "curriculum" ("id", "title", "description", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "title" = excluded."title",
       "description" = excluded."description",
       "updatedAt" = excluded."updatedAt"`,
    [
      "ttv-fixture-curriculum",
      "Preview Curriculum",
      "Fixture curriculum for preview environments",
      createdAt,
      createdAt,
    ]
  );

  // Browser projects share one preview identity. Give every project/retry a
  // distinct open cohort so duplicate protection remains meaningful without
  // creating cross-project races.
  const selfApplicationFixtures = ["desktop", "mobile"].flatMap((viewport) =>
    Array.from({ length: 3 }, (_, retry) => {
      const viewportLabel =
        viewport.charAt(0).toUpperCase() + viewport.slice(1);
      return {
        id: `ttv-fixture-program-self-apply-${viewport}-${retry}`,
        name: `Open Cohort ${viewportLabel} Applications ${retry + 1}`,
        description: `Open self-application fixture for ${viewport} retry ${retry}`,
      };
    })
  );
  const closedApplicationFixture = {
    id: "ttv-fixture-program-applications-closed",
    name: "Closed Cohort Fixture",
    description: "Closed self-application failure fixture",
  };
  const programFixtures = [
    {
      id: "ttv-fixture-program-cohort-04",
      name: "Cohort 04",
      description: "Preview fixture cohort",
      applicationsOpen: false,
    },
    ...selfApplicationFixtures.map((fixture) => ({
      ...fixture,
      applicationsOpen: true,
    })),
    { ...closedApplicationFixture, applicationsOpen: false },
  ];

  for (const fixture of programFixtures) {
    await executeQuery(
      databaseId,
      `INSERT INTO "program"
        ("id", "name", "description", "curriculumId", "startDate", "endDate",
         "applicationsOpen", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)
       ON CONFLICT("id") DO UPDATE SET
         "name" = excluded."name",
         "description" = excluded."description",
         "curriculumId" = excluded."curriculumId",
         "startDate" = NULL,
         "endDate" = NULL,
         "applicationsOpen" = excluded."applicationsOpen",
         "updatedAt" = excluded."updatedAt"`,
      [
        fixture.id,
        fixture.name,
        fixture.description,
        "ttv-fixture-curriculum",
        fixture.applicationsOpen ? 1 : 0,
        createdAt,
        createdAt,
      ]
    );
  }

  const selfApplicationProgramIds = selfApplicationFixtures.map(
    (fixture) => fixture.id
  );
  await executeQuery(
    databaseId,
    `DELETE FROM "programApplication"
     WHERE "userId" = ?
       AND "programId" IN (${selfApplicationProgramIds.map(() => "?").join(", ")})`,
    [AGENT_PREVIEW_USER_ID, ...selfApplicationProgramIds]
  );

  // Each browser project also gets a distinct existing staff user. Remove
  // roles those journeys may have created, while preserving deterministic
  // cross-cohort roles used to prove scoped deletion.
  const staffFixtures = ["desktop", "mobile"].map((viewport) => {
    const viewportLabel =
      viewport.charAt(0).toUpperCase() + viewport.slice(1);
    return {
      viewport,
      userId: `ttv-fixture-user-staff-${viewport}`,
      name: `Cohort ${viewportLabel} Staff`,
      email: `cohort-staff-${viewport}@invalid.ttv`,
      crossCohortRoleId: `ttv-fixture-role-cross-cohort-${viewport}`,
    };
  });
  await executeQuery(
    databaseId,
    `DELETE FROM "programRole"
     WHERE "userId" IN (${staffFixtures.map(() => "?").join(", ")})
       AND "programId" IN (${selfApplicationProgramIds.map(() => "?").join(", ")})`,
    [
      ...staffFixtures.map((fixture) => fixture.userId),
      ...selfApplicationProgramIds,
    ]
  );

  for (const fixture of staffFixtures) {
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
      [fixture.userId, fixture.name, fixture.email, createdAt, createdAt]
    );
    await executeQuery(
      databaseId,
      `INSERT INTO "programRole"
        ("id", "programId", "userId", "name", "createdAt", "updatedAt")
       VALUES (?, ?, ?, 'INSTRUCTOR', ?, ?)
       ON CONFLICT("id") DO UPDATE SET
         "programId" = excluded."programId",
         "userId" = excluded."userId",
         "name" = 'INSTRUCTOR',
         "updatedAt" = excluded."updatedAt"`,
      [
        fixture.crossCohortRoleId,
        closedApplicationFixture.id,
        fixture.userId,
        createdAt,
        createdAt,
      ]
    );
  }

  // Cohort-management rows are split by Playwright project so desktop and
  // mobile journeys can mutate concurrently without racing each other. Reset
  // only these deterministic isolated-preview users on every seed so retries
  // and redeploys converge to the same starting roster.
  const cohortManagementFixtures = ["desktop", "mobile"].flatMap(
    (viewport) => {
      const viewportLabel =
        viewport.charAt(0).toUpperCase() + viewport.slice(1);
      const fixture = ({ key, label, applicationStatus = null }) => ({
        userId: `ttv-fixture-user-cohort-${viewport}-${key}`,
        applicationId: applicationStatus
          ? `ttv-fixture-app-cohort-${viewport}-${key}`
          : null,
        name: `Cohort ${viewportLabel} ${label}`,
        email: `cohort-${viewport}-${key}@invalid.ttv`,
        applicationStatus,
      });

      return [
        fixture({ key: "current", label: "Current Learner" }),
        fixture({ key: "alumni", label: "Historical Alumni" }),
        fixture({
          key: "pending",
          label: "Pending Learner",
          applicationStatus: "PENDING",
        }),
        fixture({
          key: "audit",
          label: "Audit Learner",
          applicationStatus: "AUDIT",
        }),
        fixture({
          key: "approved",
          label: "Approved Learner",
          applicationStatus: "APPROVED",
        }),
      ];
    }
  );
  const cohortManagementUserIds = cohortManagementFixtures.map(
    (fixture) => fixture.userId
  );

  await executeQuery(
    databaseId,
    `DELETE FROM "programApplication"
     WHERE "programId" = ?
       AND "userId" IN (${cohortManagementUserIds.map(() => "?").join(", ")})`,
    ["ttv-fixture-program-cohort-04", ...cohortManagementUserIds]
  );

  for (const fixture of cohortManagementFixtures) {
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
      [fixture.userId, fixture.name, fixture.email, createdAt, createdAt]
    );

    if (!fixture.applicationId || !fixture.applicationStatus) continue;

    await executeQuery(
      databaseId,
      `INSERT INTO "programApplication"
        ("id", "programId", "userId", "status", "application", "completedAt", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, '{}', NULL, ?, ?)
       ON CONFLICT("id") DO UPDATE SET
         "programId" = excluded."programId",
         "userId" = excluded."userId",
         "status" = excluded."status",
         "application" = '{}',
         "completedAt" = NULL,
         "updatedAt" = excluded."updatedAt"`,
      [
        fixture.applicationId,
        "ttv-fixture-program-cohort-04",
        fixture.userId,
        fixture.applicationStatus,
        createdAt,
        createdAt,
      ]
    );
  }

  // COMPLETED application for existing preview user
  await executeQuery(
    databaseId,
    `INSERT INTO "programApplication"
      ("id", "programId", "userId", "status", "application", "completedAt", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 'COMPLETED', '{}', ?, ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "programId" = excluded."programId",
       "userId" = excluded."userId",
       "status" = 'COMPLETED',
       "application" = '{}',
       "completedAt" = excluded."completedAt",
       "updatedAt" = excluded."updatedAt"`,
    [
      "ttv-fixture-app-preview",
      "ttv-fixture-program-cohort-04",
      AGENT_PREVIEW_USER_ID,
      completedAt,
      createdAt,
      createdAt,
    ]
  );

  // User: Amina Fixture
  await executeQuery(
    databaseId,
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 0, NULL, ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "name" = excluded."name",
       "email" = excluded."email",
       "updatedAt" = excluded."updatedAt"`,
    [
      "ttv-fixture-user-amina",
      "Amina Fixture",
      "amina-fixture@invalid.ttv",
      createdAt,
      createdAt,
    ]
  );

  // COMPLETED application for Amina
  await executeQuery(
    databaseId,
    `INSERT INTO "programApplication"
      ("id", "programId", "userId", "status", "application", "completedAt", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 'COMPLETED', '{}', ?, ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "programId" = excluded."programId",
       "userId" = excluded."userId",
       "status" = 'COMPLETED',
       "completedAt" = excluded."completedAt",
       "updatedAt" = excluded."updatedAt"`,
    [
      "ttv-fixture-app-amina",
      "ttv-fixture-program-cohort-04",
      "ttv-fixture-user-amina",
      completedAt,
      createdAt,
      createdAt,
    ]
  );

  // PUBLISHED profile for Amina
  await executeQuery(
    databaseId,
    `INSERT INTO "studentProfile"
      ("id", "userId", "handle", "status", "headline", "country", "skills",
       "openToFreelance", "openToRoles", "publishedAt", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 'PUBLISHED', ?, ?, ?, 1, 0, ?, ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "userId" = excluded."userId",
       "handle" = excluded."handle",
       "status" = 'PUBLISHED',
       "headline" = excluded."headline",
       "country" = excluded."country",
       "skills" = excluded."skills",
       "openToFreelance" = 1,
       "openToRoles" = 0,
       "publishedAt" = excluded."publishedAt",
       "updatedAt" = excluded."updatedAt"`,
    [
      "ttv-fixture-profile-amina",
      "ttv-fixture-user-amina",
      "amina-preview",
      "Full-stack developer · Nairobi",
      "Kenya",
      '["TypeScript","React","D1"]',
      publishedAt,
      createdAt,
      createdAt,
    ]
  );

  // Published profile with a legacy COMPLETED row missing completedAt. Public
  // talent and certificate routes must treat this as an invalid completion.
  await executeQuery(
    databaseId,
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 0, NULL, ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "name" = excluded."name",
       "email" = excluded."email",
       "updatedAt" = excluded."updatedAt"`,
    [
      "ttv-fixture-user-invalid-completion",
      "Invalid Completion Fixture",
      "invalid-completion-fixture@invalid.ttv",
      createdAt,
      createdAt,
    ]
  );

  await executeQuery(
    databaseId,
    `INSERT INTO "programApplication"
      ("id", "programId", "userId", "status", "application", "completedAt", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 'COMPLETED', '{}', NULL, ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "programId" = excluded."programId",
       "userId" = excluded."userId",
       "status" = 'COMPLETED',
       "application" = '{}',
       "completedAt" = NULL,
       "updatedAt" = excluded."updatedAt"`,
    [
      "ttv-fixture-app-invalid-completion",
      "ttv-fixture-program-cohort-04",
      "ttv-fixture-user-invalid-completion",
      createdAt,
      createdAt,
    ]
  );

  await executeQuery(
    databaseId,
    `INSERT INTO "studentProfile"
      ("id", "userId", "handle", "status", "headline", "country", "skills",
       "openToFreelance", "openToRoles", "publishedAt", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 'PUBLISHED', ?, ?, '[]', 0, 0, ?, ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "userId" = excluded."userId",
       "handle" = excluded."handle",
       "status" = 'PUBLISHED',
       "headline" = excluded."headline",
       "country" = excluded."country",
       "skills" = '[]',
       "openToFreelance" = 0,
       "openToRoles" = 0,
       "publishedAt" = excluded."publishedAt",
       "updatedAt" = excluded."updatedAt"`,
    [
      "ttv-fixture-profile-invalid-completion",
      "ttv-fixture-user-invalid-completion",
      "invalid-completion-preview",
      "Legacy completion without an issue date",
      "Kenya",
      publishedAt,
      createdAt,
      createdAt,
    ]
  );

  // Highlights for Amina
  await executeQuery(
    databaseId,
    `INSERT INTO "profileHighlight"
      ("id", "profileId", "repoFullName", "repoUrl", "description", "language",
       "topics", "stars", "sortOrder", "snapshotAt", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "profileId" = excluded."profileId",
       "repoFullName" = excluded."repoFullName",
       "repoUrl" = excluded."repoUrl",
       "description" = excluded."description",
       "language" = excluded."language",
       "topics" = excluded."topics",
       "stars" = excluded."stars",
       "sortOrder" = 0,
       "snapshotAt" = excluded."snapshotAt",
       "updatedAt" = excluded."updatedAt"`,
    [
      "ttv-fixture-highlight-amina-1",
      "ttv-fixture-profile-amina",
      "amina-fixture/savanna-api",
      "https://github.com/amina-fixture/savanna-api",
      "REST API for logistics tracking",
      "TypeScript",
      '["api","rest","cloudflare"]',
      12,
      createdAt,
      createdAt,
      createdAt,
    ]
  );

  await executeQuery(
    databaseId,
    `INSERT INTO "profileHighlight"
      ("id", "profileId", "repoFullName", "repoUrl", "description", "language",
       "topics", "stars", "sortOrder", "snapshotAt", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "profileId" = excluded."profileId",
       "repoFullName" = excluded."repoFullName",
       "repoUrl" = excluded."repoUrl",
       "description" = excluded."description",
       "language" = excluded."language",
       "topics" = excluded."topics",
       "stars" = excluded."stars",
       "sortOrder" = 1,
       "snapshotAt" = excluded."snapshotAt",
       "updatedAt" = excluded."updatedAt"`,
    [
      "ttv-fixture-highlight-amina-2",
      "ttv-fixture-profile-amina",
      "amina-fixture/react-dashboard",
      "https://github.com/amina-fixture/react-dashboard",
      "Admin dashboard with D1 backend",
      "TypeScript",
      '["react","dashboard","d1"]',
      8,
      createdAt,
      createdAt,
      createdAt,
    ]
  );

  // User: Kwame Fixture
  await executeQuery(
    databaseId,
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 0, NULL, ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "name" = excluded."name",
       "email" = excluded."email",
       "updatedAt" = excluded."updatedAt"`,
    [
      "ttv-fixture-user-kwame",
      "Kwame Fixture",
      "kwame-fixture@invalid.ttv",
      createdAt,
      createdAt,
    ]
  );

  // COMPLETED application for Kwame
  await executeQuery(
    databaseId,
    `INSERT INTO "programApplication"
      ("id", "programId", "userId", "status", "application", "completedAt", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 'COMPLETED', '{}', ?, ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "programId" = excluded."programId",
       "userId" = excluded."userId",
       "status" = 'COMPLETED',
       "completedAt" = excluded."completedAt",
       "updatedAt" = excluded."updatedAt"`,
    [
      "ttv-fixture-app-kwame",
      "ttv-fixture-program-cohort-04",
      "ttv-fixture-user-kwame",
      completedAt,
      createdAt,
      createdAt,
    ]
  );

  // IN_REVIEW profile for Kwame
  await executeQuery(
    databaseId,
    `INSERT INTO "studentProfile"
      ("id", "userId", "handle", "status", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 'IN_REVIEW', ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "userId" = excluded."userId",
       "handle" = excluded."handle",
       "status" = 'IN_REVIEW',
       "updatedAt" = excluded."updatedAt"`,
    [
      "ttv-fixture-profile-kwame",
      "ttv-fixture-user-kwame",
      "kwame-preview",
      createdAt,
      createdAt,
    ]
  );

  // Client project: APPROVED
  await executeQuery(
    databaseId,
    `INSERT INTO "clientProject"
      ("id", "organization", "contactName", "contactEmail", "title", "description",
       "skills", "budgetBand", "timeline", "status", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "organization" = excluded."organization",
       "contactName" = excluded."contactName",
       "contactEmail" = excluded."contactEmail",
       "title" = excluded."title",
       "description" = excluded."description",
       "skills" = excluded."skills",
       "budgetBand" = excluded."budgetBand",
       "timeline" = excluded."timeline",
       "status" = 'APPROVED',
       "updatedAt" = excluded."updatedAt"`,
    [
      "ttv-fixture-project-approved",
      "Savanna Logistics",
      "Fixture Contact",
      "contact@savanna-fixture.invalid",
      "Delivery tracking dashboard",
      "Build a real-time delivery tracking dashboard for fleet management.",
      '["React","APIs"]',
      "FROM_1K_TO_5K",
      "6 weeks",
      createdAt,
      createdAt,
    ]
  );

  // Client project: PENDING
  await executeQuery(
    databaseId,
    `INSERT INTO "clientProject"
      ("id", "organization", "contactName", "contactEmail", "title", "description",
       "skills", "status", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "organization" = excluded."organization",
       "contactName" = excluded."contactName",
       "contactEmail" = excluded."contactEmail",
       "title" = excluded."title",
       "description" = excluded."description",
       "skills" = excluded."skills",
       "status" = 'PENDING',
       "updatedAt" = excluded."updatedAt"`,
    [
      "ttv-fixture-project-pending",
      "Baraka Health",
      "Fixture Contact",
      "contact@baraka-fixture.invalid",
      "Clinic booking website",
      "An online booking system for community health clinics.",
      '["React","Node"]',
      createdAt,
      createdAt,
    ]
  );
}
