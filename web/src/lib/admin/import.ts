const IMPORTABLE_TABLE_KEYS = [
  "users",
  "curricula",
  "programPartners",
  "programs",
  "programRoles",
  "programApplications",
] as const;

export const PRIVILEGE_TABLE_KEYS = ["roles", "userRoles"] as const;

export type ImportableTableKey = (typeof IMPORTABLE_TABLE_KEYS)[number];
export type PrivilegeTableKey = (typeof PRIVILEGE_TABLE_KEYS)[number];

type SqlValue = string | number | null;
type ImportCounts = Record<ImportableTableKey, number>;
type IgnoredCounts = Record<PrivilegeTableKey, number>;

interface LegacyUser {
  id: string;
  email: string;
}

interface LegacyImportReferences {
  users: string[];
  curricula: string[];
  programs: string[];
  programPartners: string[];
  incomingUsers: LegacyUser[];
  incomingUserIds: string[];
  incomingCurriculumIds: string[];
  incomingProgramIds: string[];
  incomingProgramPartnerIds: string[];
}

export interface LegacyImportStatement {
  table: ImportableTableKey;
  sql: string;
  values: SqlValue[];
}

export interface LegacyImportPlan {
  statements: LegacyImportStatement[];
  attempted: ImportCounts;
  ignored: IgnoredCounts;
  references: LegacyImportReferences;
}

export interface LegacyImportResult {
  success: true;
  totalChanges: number;
  totalSkipped: number;
  totalIgnored: number;
  imported: ImportCounts;
  skipped: ImportCounts;
  ignored: IgnoredCounts;
}

export type LegacyImportErrorCode =
  | "empty_import"
  | "identity_collision"
  | "invalid_payload"
  | "invalid_reference";

export class LegacyImportValidationError extends Error {
  readonly code: LegacyImportErrorCode;

  constructor(code: LegacyImportErrorCode, message: string) {
    super(message);
    this.name = "LegacyImportValidationError";
    this.code = code;
  }
}

export const LEGACY_IMPORT_PRODUCTION_DISABLED_MESSAGE =
  "Legacy import is disabled in production. Manage current production data through reviewed admin tools.";

export const LEGACY_IMPORT_ENVIRONMENT_DISABLED_MESSAGE =
  "Legacy import is available only in staging and isolated agent preview environments for migration testing.";

const IDENTITY_COLLISION_MESSAGE =
  "Import stopped before changes: a legacy email belongs to a different current OAuth identity. Full identity reconciliation is deferred.";

const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;

const APPLICATION_STATUSES = new Set([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "AUDIT",
  "COMPLETED",
]);

const PROGRAM_ROLE_NAMES = new Set(["INSTRUCTOR", "TA"]);

function emptyImportCounts(): ImportCounts {
  return {
    users: 0,
    curricula: 0,
    programPartners: 0,
    programs: 0,
    programRoles: 0,
    programApplications: 0,
  };
}

function fail(
  message: string,
  code: LegacyImportErrorCode = "invalid_payload"
): never {
  throw new LegacyImportValidationError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(
  value: unknown,
  path: string
): Record<string, unknown> {
  if (!isRecord(value)) fail(`Invalid import payload: ${path} must be an object.`);
  return value;
}

function readSection(
  payload: Record<string, unknown>,
  key: string
): unknown[] {
  const value = payload[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    fail(`Invalid import payload: ${key} must be an array.`);
  }
  return value;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  path: string
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    fail(`Invalid import payload: ${path}.${key} must be a non-empty string.`);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  fallback = ""
): string {
  const value = record[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") {
    fail(`Invalid import payload: ${path}.${key} must be a string or null.`);
  }
  return value;
}

function nullableReference(
  record: Record<string, unknown>,
  key: string,
  path: string
): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    fail(
      `Invalid import payload: ${path}.${key} must be a non-empty string or null.`
    );
  }
  return value;
}

function timestamp(value: unknown, path: string): number {
  const text = typeof value === "string" ? value : "";
  const match = ISO_TIMESTAMP.exec(text);
  if (!match) {
    fail(`Invalid import payload: ${path} must be an ISO-8601 timestamp.`);
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth =
    month >= 1 && month <= 12
      ? new Date(Date.UTC(year, month, 0)).getUTCDate()
      : 0;
  if (
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    fail(`Invalid import payload: ${path} must be a valid date.`);
  }

  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds)) {
    fail(`Invalid import payload: ${path} must be a valid date.`);
  }
  return Math.floor(milliseconds / 1_000);
}

function requiredTimestamp(
  record: Record<string, unknown>,
  key: string,
  path: string
): number {
  return timestamp(record[key], `${path}.${key}`);
}

function optionalTimestamp(
  record: Record<string, unknown>,
  key: string,
  path: string
): number | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  return timestamp(value, `${path}.${key}`);
}

function emailVerifiedValue(value: unknown, path: string): number {
  if (value === undefined || value === null || value === false) return 0;
  if (value === true) return 1;
  if (typeof value === "string") {
    timestamp(value, path);
    return 1;
  }
  return fail(
    `Invalid import payload: ${path} must be a boolean, verification timestamp, or null.`
  );
}

function applicationJson(value: unknown, path: string): string {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      fail(`Invalid import payload: ${path} must contain valid JSON.`);
    }
  }

  if (!isRecord(parsed)) {
    fail(`Invalid import payload: ${path} must be a JSON object.`);
  }

  try {
    return JSON.stringify(parsed);
  } catch {
    return fail(`Invalid import payload: ${path} must be serializable JSON.`);
  }
}

function addUnique(
  seen: Set<string>,
  value: string,
  path: string
): void {
  if (seen.has(value)) {
    fail(`Invalid import payload: ${path} contains a duplicate identifier.`);
  }
  seen.add(value);
}

function addUniqueNaturalKey(
  seen: Set<string>,
  values: string[],
  path: string,
  description: string
): void {
  const key = JSON.stringify(values);
  if (seen.has(key)) {
    fail(`Invalid import payload: ${path} duplicates ${description}.`);
  }
  seen.add(key);
}

function addStatement(
  plan: LegacyImportPlan,
  table: ImportableTableKey,
  sql: string,
  values: SqlValue[]
): void {
  plan.statements.push({ table, sql, values });
  plan.attempted[table] += 1;
}

export function isLegacyImportEnabled(
  deploymentEnvironment: string | undefined
): boolean {
  return (
    deploymentEnvironment === "staging" ||
    /^agent-[a-z0-9][a-z0-9-]*$/.test(deploymentEnvironment ?? "")
  );
}

export function legacyImportDisabledMessage(
  deploymentEnvironment: string | undefined
): string {
  return deploymentEnvironment === "production"
    ? LEGACY_IMPORT_PRODUCTION_DISABLED_MESSAGE
    : LEGACY_IMPORT_ENVIRONMENT_DISABLED_MESSAGE;
}

function planUsers(
  plan: LegacyImportPlan,
  payload: Record<string, unknown>
): void {
  const userIds = new Set<string>();
  const userEmails = new Set<string>();
  for (const [index, value] of readSection(payload, "users").entries()) {
    const path = `users[${index}]`;
    const row = requireRecord(value, path);
    const id = requiredString(row, "id", path);
    const name = requiredString(row, "name", path);
    const email = requiredString(row, "email", path);
    const normalizedEmail = email.toLowerCase();
    addUnique(userIds, id, "users");
    addUnique(userEmails, normalizedEmail, "users emails");
    optionalTimestamp(row, "createdAt", path);
    optionalTimestamp(row, "updatedAt", path);

    plan.references.incomingUsers.push({ id, email });
    plan.references.incomingUserIds.push(id);
    addStatement(
      plan,
      "users",
      `INSERT OR IGNORE INTO "user" ("id", "name", "email", "emailVerified", "image") VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        name,
        email,
        emailVerifiedValue(row.emailVerified, `${path}.emailVerified`),
        optionalString(row, "image", path, "") || null,
      ]
    );
  }
}

function planCurricula(
  plan: LegacyImportPlan,
  payload: Record<string, unknown>
): void {
  const curriculumIds = new Set<string>();
  for (const [index, value] of readSection(payload, "curricula").entries()) {
    const path = `curricula[${index}]`;
    const row = requireRecord(value, path);
    const id = requiredString(row, "id", path);
    addUnique(curriculumIds, id, "curricula");
    plan.references.incomingCurriculumIds.push(id);
    addStatement(
      plan,
      "curricula",
      `INSERT OR IGNORE INTO "curriculum" ("id", "title", "description", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        requiredString(row, "title", path),
        optionalString(row, "description", path),
        requiredTimestamp(row, "createdAt", path),
        requiredTimestamp(row, "updatedAt", path),
      ]
    );
  }
}

function planProgramPartners(
  plan: LegacyImportPlan,
  payload: Record<string, unknown>
): void {
  const partnerIds = new Set<string>();
  for (const [index, value] of readSection(
    payload,
    "programPartners"
  ).entries()) {
    const path = `programPartners[${index}]`;
    const row = requireRecord(value, path);
    const id = requiredString(row, "id", path);
    addUnique(partnerIds, id, "programPartners");
    plan.references.incomingProgramPartnerIds.push(id);
    addStatement(
      plan,
      "programPartners",
      `INSERT OR IGNORE INTO "programPartner" ("id", "name", "createdAt", "updatedAt") VALUES (?, ?, ?, ?)`,
      [
        id,
        requiredString(row, "name", path),
        requiredTimestamp(row, "createdAt", path),
        requiredTimestamp(row, "updatedAt", path),
      ]
    );
  }
}

function planPrograms(
  plan: LegacyImportPlan,
  payload: Record<string, unknown>
): void {
  const programIds = new Set<string>();
  for (const [index, value] of readSection(payload, "programs").entries()) {
    const path = `programs[${index}]`;
    const row = requireRecord(value, path);
    const id = requiredString(row, "id", path);
    const curriculumId = requiredString(row, "curriculumId", path);
    const startDate = optionalTimestamp(row, "startDate", path);
    const endDate = optionalTimestamp(row, "endDate", path);
    if (startDate !== null && endDate !== null && startDate > endDate) {
      fail(
        `Invalid import payload: ${path}.startDate must not be after endDate.`
      );
    }
    addUnique(programIds, id, "programs");
    plan.references.incomingProgramIds.push(id);
    plan.references.curricula.push(curriculumId);
    addStatement(
      plan,
      "programs",
      `INSERT OR IGNORE INTO "program" ("id", "name", "description", "curriculumId", "startDate", "endDate", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        requiredString(row, "name", path),
        optionalString(row, "description", path),
        curriculumId,
        startDate,
        endDate,
        requiredTimestamp(row, "createdAt", path),
        requiredTimestamp(row, "updatedAt", path),
      ]
    );
  }
}

function planProgramRoles(
  plan: LegacyImportPlan,
  payload: Record<string, unknown>
): void {
  const programRoleIds = new Set<string>();
  const programRoleNaturalKeys = new Set<string>();
  for (const [index, value] of readSection(payload, "programRoles").entries()) {
    const path = `programRoles[${index}]`;
    const row = requireRecord(value, path);
    const id = requiredString(row, "id", path);
    const programId = requiredString(row, "programId", path);
    const userId = requiredString(row, "userId", path);
    const name = requiredString(row, "name", path);
    if (!PROGRAM_ROLE_NAMES.has(name)) {
      fail(
        `Invalid import payload: ${path}.name must be INSTRUCTOR or TA.`
      );
    }
    addUnique(programRoleIds, id, "programRoles");
    addUniqueNaturalKey(
      programRoleNaturalKeys,
      [programId, userId, name],
      path,
      "an earlier programId, userId, and name combination"
    );
    plan.references.programs.push(programId);
    plan.references.users.push(userId);
    addStatement(
      plan,
      "programRoles",
      `INSERT OR IGNORE INTO "programRole" ("id", "programId", "userId", "name", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        programId,
        userId,
        name,
        requiredTimestamp(row, "createdAt", path),
        requiredTimestamp(row, "updatedAt", path),
      ]
    );
  }
}

function planProgramApplications(
  plan: LegacyImportPlan,
  payload: Record<string, unknown>
): void {
  const applicationIds = new Set<string>();
  const applicationCohortPairs = new Set<string>();
  for (const [index, value] of readSection(
    payload,
    "programApplications"
  ).entries()) {
    const path = `programApplications[${index}]`;
    const row = requireRecord(value, path);
    const id = requiredString(row, "id", path);
    const userId = requiredString(row, "userId", path);
    const programId = nullableReference(row, "programId", path);
    const partnerId = nullableReference(row, "partnerId", path);
    const status = requiredString(row, "status", path);
    if (!APPLICATION_STATUSES.has(status)) {
      fail(`Invalid import payload: ${path}.status is not supported.`);
    }
    const completedAt = optionalTimestamp(row, "completedAt", path);
    if (status === "COMPLETED" && completedAt === null) {
      fail(
        `Invalid import payload: ${path}.completedAt is required for COMPLETED applications.`
      );
    }
    if (status !== "COMPLETED" && completedAt !== null) {
      fail(
        `Invalid import payload: ${path}.completedAt is allowed only for COMPLETED applications.`
      );
    }
    addUnique(applicationIds, id, "programApplications");
    if (programId !== null) {
      addUniqueNaturalKey(
        applicationCohortPairs,
        [programId, userId],
        path,
        "an earlier non-null programId and userId combination"
      );
    }
    plan.references.users.push(userId);
    if (programId) plan.references.programs.push(programId);
    if (partnerId) plan.references.programPartners.push(partnerId);
    addStatement(
      plan,
      "programApplications",
      `INSERT OR IGNORE INTO "programApplication" ("id", "programId", "userId", "partnerId", "status", "application", "completedAt", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        programId,
        userId,
        partnerId,
        status,
        applicationJson(row.application, `${path}.application`),
        completedAt,
        requiredTimestamp(row, "createdAt", path),
        requiredTimestamp(row, "updatedAt", path),
      ]
    );
  }
}

export function createLegacyImportPlan(input: unknown): LegacyImportPlan {
  const payload = requireRecord(input, "root");
  const version = payload.version;
  if (!Number.isInteger(version) || Number(version) <= 0) {
    fail("Invalid import payload: version must be a positive integer.");
  }
  timestamp(payload.exportedAt, "exportedAt");

  const roles = readSection(payload, "roles");
  const userRoles = readSection(payload, "userRoles");
  const plan: LegacyImportPlan = {
    statements: [],
    attempted: emptyImportCounts(),
    ignored: {
      roles: roles.length,
      userRoles: userRoles.length,
    },
    references: {
      users: [],
      curricula: [],
      programs: [],
      programPartners: [],
      incomingUsers: [],
      incomingUserIds: [],
      incomingCurriculumIds: [],
      incomingProgramIds: [],
      incomingProgramPartnerIds: [],
    },
  };

  planUsers(plan, payload);
  planCurricula(plan, payload);
  planProgramPartners(plan, payload);
  planPrograms(plan, payload);
  planProgramRoles(plan, payload);
  planProgramApplications(plan, payload);

  if (
    plan.statements.length === 0 &&
    plan.ignored.roles === 0 &&
    plan.ignored.userRoles === 0
  ) {
    fail("Invalid import payload: no records were found.", "empty_import");
  }

  return plan;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function existingIds(
  db: D1Database,
  table: "curriculum" | "program" | "programPartner" | "user",
  ids: string[]
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const group of chunks(unique(ids), 80)) {
    if (group.length === 0) continue;
    const placeholders = group.map(() => "?").join(", ");
    const result = await db
      .prepare(`SELECT "id" FROM "${table}" WHERE "id" IN (${placeholders})`)
      .bind(...group)
      .all<{ id: string }>();
    for (const row of result.results) found.add(row.id);
  }
  return found;
}

async function assertNoIdentityCollisions(
  db: D1Database,
  users: LegacyUser[]
): Promise<void> {
  for (const group of chunks(users, 35)) {
    if (group.length === 0) continue;
    const ids = group.map((user) => user.id);
    const emails = group.map((user) => user.email.toLowerCase());
    const idPlaceholders = ids.map(() => "?").join(", ");
    const emailPlaceholders = emails.map(() => "?").join(", ");
    const result = await db
      .prepare(
        `SELECT "id", "email" FROM "user" WHERE "id" IN (${idPlaceholders}) OR lower("email") IN (${emailPlaceholders})`
      )
      .bind(...ids, ...emails)
      .all<{ id: string; email: string }>();

    for (const incoming of group) {
      const normalizedEmail = incoming.email.toLowerCase();
      const collision = result.results.some(
        (existing) =>
          (existing.id === incoming.id &&
            existing.email.toLowerCase() !== normalizedEmail) ||
          (existing.id !== incoming.id &&
            existing.email.toLowerCase() === normalizedEmail)
      );
      if (collision) {
        fail(IDENTITY_COLLISION_MESSAGE, "identity_collision");
      }
    }
  }
}

function assertReferences(
  references: string[],
  incoming: string[],
  existing: Set<string>,
  label: string
): void {
  const incomingIds = new Set(incoming);
  if (
    unique(references).some(
      (reference) => !incomingIds.has(reference) && !existing.has(reference)
    )
  ) {
    fail(
      `Import stopped before changes: ${label} contains an invalid foreign-key reference.`,
      "invalid_reference"
    );
  }
}

export async function preflightLegacyImport(
  db: D1Database,
  input: unknown
): Promise<LegacyImportPlan> {
  const plan = createLegacyImportPlan(input);
  await assertNoIdentityCollisions(db, plan.references.incomingUsers);

  const [users, curricula, programs, partners] = await Promise.all([
    existingIds(db, "user", plan.references.users),
    existingIds(db, "curriculum", plan.references.curricula),
    existingIds(db, "program", plan.references.programs),
    existingIds(db, "programPartner", plan.references.programPartners),
  ]);

  assertReferences(
    plan.references.users,
    plan.references.incomingUserIds,
    users,
    "a user reference"
  );
  assertReferences(
    plan.references.curricula,
    plan.references.incomingCurriculumIds,
    curricula,
    "a curriculum reference"
  );
  assertReferences(
    plan.references.programs,
    plan.references.incomingProgramIds,
    programs,
    "a program reference"
  );
  assertReferences(
    plan.references.programPartners,
    plan.references.incomingProgramPartnerIds,
    partners,
    "a program-partner reference"
  );

  return plan;
}

export async function executeLegacyImport(
  db: D1Database,
  input: unknown
): Promise<LegacyImportResult> {
  const plan = await preflightLegacyImport(db, input);
  const imported = emptyImportCounts();
  const skipped = emptyImportCounts();

  if (plan.statements.length > 0) {
    const prepared = plan.statements.map((statement) =>
      db.prepare(statement.sql).bind(...statement.values)
    );
    const results = await db.batch(prepared);

    if (results.length !== plan.statements.length) {
      throw new Error("Legacy import batch returned an unexpected result count.");
    }

    for (const [index, result] of results.entries()) {
      const changes = result.meta.changes;
      if (!Number.isInteger(changes) || changes < 0) {
        throw new Error("Legacy import batch returned invalid change metadata.");
      }
      const table = plan.statements[index].table;
      imported[table] += changes;
      if (changes === 0) skipped[table] += 1;
    }
  }

  const totalChanges = IMPORTABLE_TABLE_KEYS.reduce(
    (total, table) => total + imported[table],
    0
  );
  const totalSkipped = IMPORTABLE_TABLE_KEYS.reduce(
    (total, table) => total + skipped[table],
    0
  );
  const totalIgnored = PRIVILEGE_TABLE_KEYS.reduce(
    (total, table) => total + plan.ignored[table],
    0
  );

  return {
    success: true,
    totalChanges,
    totalSkipped,
    totalIgnored,
    imported,
    skipped,
    ignored: plan.ignored,
  };
}
