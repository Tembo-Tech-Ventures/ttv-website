export const PROGRAM_STAFF_ROLES = ["INSTRUCTOR", "TA"] as const;

export type ProgramStaffRole = (typeof PROGRAM_STAFF_ROLES)[number];

export type ProgramManagementErrorCode =
  | "INVALID_STAFF_USER"
  | "INVALID_STAFF_ROLE"
  | "UNKNOWN_PROGRAM"
  | "UNKNOWN_USER"
  | "DUPLICATE_STAFF_ROLE"
  | "STAFF_ROLE_NOT_CREATED"
  | "STAFF_ROLE_NOT_FOUND"
  | "INVALID_COHORT_NAME"
  | "INVALID_COHORT_DESCRIPTION"
  | "INVALID_CURRICULUM"
  | "INVALID_COHORT_DATE"
  | "INVALID_COHORT_DATE_RANGE"
  | "INVALID_APPLICATIONS_OPEN"
  | "UNKNOWN_CURRICULUM"
  | "COHORT_NOT_UPDATED";

export class ProgramManagementError extends Error {
  constructor(
    readonly code: ProgramManagementErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ProgramManagementError";
  }
}

export interface AtomicProgramStatement {
  sql: string;
  params: readonly (string | number | null)[];
  expectedChanges: number;
}

export interface CohortUpdate {
  name: string;
  description: string;
  curriculumId: string;
  startDate: Date | null;
  endDate: Date | null;
  applicationsOpen: boolean;
}

export interface CohortUpdateValues {
  name: string;
  description: string;
  curriculumId: string;
  startDate: string;
  endDate: string;
  applicationsOpen: boolean;
}

export type CohortUpdateField = keyof CohortUpdateValues;

const toEpochSeconds = (value: Date | null) =>
  value === null ? null : Math.floor(value.getTime() / 1_000);

const formText = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value : "";

const requiredText = (
  value: unknown,
  code: "INVALID_COHORT_NAME" | "INVALID_COHORT_DESCRIPTION",
  label: string
) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProgramManagementError(code, label + " is required.");
  }
  return value.trim();
};

const identifier = (
  value: unknown,
  code: "INVALID_STAFF_USER" | "INVALID_CURRICULUM",
  message: string
) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProgramManagementError(code, message);
  }
  return value.trim();
};

export function parseProgramStaffRole(value: unknown): ProgramStaffRole {
  if (value !== "INSTRUCTOR" && value !== "TA") {
    throw new ProgramManagementError(
      "INVALID_STAFF_ROLE",
      "Choose Instructor or TA for the cohort staff role."
    );
  }
  return value;
}

export function parseProgramStaffUserId(value: unknown): string {
  return identifier(
    value,
    "INVALID_STAFF_USER",
    "Choose an existing signed-in user for this cohort role."
  );
}

export function buildAddProgramRoleStatement({
  id,
  programId,
  userId,
  role,
  now = new Date(),
}: {
  id: string;
  programId: string;
  userId: string;
  role: ProgramStaffRole;
  now?: Date;
}): AtomicProgramStatement {
  const timestamp = toEpochSeconds(now);
  return {
    sql: [
      'INSERT OR IGNORE INTO "programRole"',
      '  ("id", "programId", "userId", "name", "createdAt", "updatedAt")',
      "SELECT ?, ?, ?, ?, ?, ?",
      'WHERE EXISTS (SELECT 1 FROM "program" WHERE "id" = ?)',
      '  AND EXISTS (SELECT 1 FROM "user" WHERE "id" = ?)',
      "  AND NOT EXISTS (",
      '    SELECT 1 FROM "programRole"',
      '    WHERE "programId" = ? AND "userId" = ? AND "name" = ?',
      "  )",
    ].join("\n"),
    params: [
      id,
      programId,
      userId,
      role,
      timestamp,
      timestamp,
      programId,
      userId,
      programId,
      userId,
      role,
    ],
    expectedChanges: 1,
  };
}

export function throwAddProgramRoleFailure({
  programExists,
  userExists,
  duplicateRole,
}: {
  programExists: boolean;
  userExists: boolean;
  duplicateRole: boolean;
}): never {
  if (!programExists) {
    throw new ProgramManagementError(
      "UNKNOWN_PROGRAM",
      "This cohort no longer exists. Return to Cohorts and try again."
    );
  }
  if (!userExists) {
    throw new ProgramManagementError(
      "UNKNOWN_USER",
      "That signed-in user no longer exists. Refresh the page and choose another user."
    );
  }
  if (duplicateRole) {
    throw new ProgramManagementError(
      "DUPLICATE_STAFF_ROLE",
      "That user already has this role in the cohort."
    );
  }
  throw new ProgramManagementError(
    "STAFF_ROLE_NOT_CREATED",
    "The cohort role could not be added because the staff list changed. Refresh the page and try again."
  );
}

export function buildRemoveProgramRoleStatement({
  programId,
  roleId,
}: {
  programId: string;
  roleId: string;
}): AtomicProgramStatement {
  return {
    sql: [
      'DELETE FROM "programRole"',
      'WHERE "id" = ? AND "programId" = ?',
    ].join("\n"),
    params: [roleId, programId],
    expectedChanges: 1,
  };
}

export function assertProgramRoleRemoved(actualChanges: number): void {
  if (actualChanges === 1) return;
  if (actualChanges === 0) {
    throw new ProgramManagementError(
      "STAFF_ROLE_NOT_FOUND",
      "That staff role does not belong to this cohort or was already removed."
    );
  }
  throw new Error(
    "Scoped cohort role removal changed " +
      actualChanges +
      " rows; expected 1."
  );
}

export function cohortUpdateValuesFromFormData(
  formData: FormData
): CohortUpdateValues {
  return {
    name: formText(formData.get("name")),
    description: formText(formData.get("description")),
    curriculumId: formText(formData.get("curriculumId")),
    startDate: formText(formData.get("startDate")),
    endDate: formText(formData.get("endDate")),
    applicationsOpen: formData.get("applicationsOpen") === "on",
  };
}

export function cohortUpdateErrorField(
  error: ProgramManagementError
): CohortUpdateField | null {
  switch (error.code) {
    case "INVALID_COHORT_NAME":
      return "name";
    case "INVALID_COHORT_DESCRIPTION":
      return "description";
    case "INVALID_CURRICULUM":
    case "UNKNOWN_CURRICULUM":
      return "curriculumId";
    case "INVALID_COHORT_DATE":
      return error.message.includes("start date") ? "startDate" : "endDate";
    case "INVALID_COHORT_DATE_RANGE":
      return "endDate";
    case "INVALID_APPLICATIONS_OPEN":
      return "applicationsOpen";
    default:
      return null;
  }
}

export function parseOptionalCohortDate(
  value: unknown,
  label: string
): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new ProgramManagementError(
      "INVALID_COHORT_DATE",
      "Enter " + label + " in YYYY-MM-DD format."
    );
  }

  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new ProgramManagementError(
      "INVALID_COHORT_DATE",
      "Enter " + label + " in YYYY-MM-DD format."
    );
  }

  const parsed = new Date(normalized + "T00:00:00.000Z");
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new ProgramManagementError(
      "INVALID_COHORT_DATE",
      "Enter a real " + label + " in YYYY-MM-DD format."
    );
  }
  return parsed;
}

export function parseCohortUpdate(input: {
  name: unknown;
  description: unknown;
  curriculumId: unknown;
  startDate: unknown;
  endDate: unknown;
  applicationsOpen: unknown;
}): CohortUpdate {
  const name = requiredText(input.name, "INVALID_COHORT_NAME", "Cohort name");
  const description = requiredText(
    input.description,
    "INVALID_COHORT_DESCRIPTION",
    "Cohort description"
  );
  const curriculumId = identifier(
    input.curriculumId,
    "INVALID_CURRICULUM",
    "Choose an existing curriculum."
  );
  const startDate = parseOptionalCohortDate(input.startDate, "start date");
  const endDate = parseOptionalCohortDate(input.endDate, "end date");

  if (
    startDate !== null &&
    endDate !== null &&
    startDate.getTime() > endDate.getTime()
  ) {
    throw new ProgramManagementError(
      "INVALID_COHORT_DATE_RANGE",
      "End date must be on or after start date."
    );
  }

  if (input.applicationsOpen !== null && input.applicationsOpen !== "on") {
    throw new ProgramManagementError(
      "INVALID_APPLICATIONS_OPEN",
      "Applications open must be changed with the cohort checkbox."
    );
  }

  return {
    name,
    description,
    curriculumId,
    startDate,
    endDate,
    applicationsOpen: input.applicationsOpen === "on",
  };
}

export function buildCohortUpdateStatement({
  programId,
  update,
  now = new Date(),
}: {
  programId: string;
  update: CohortUpdate;
  now?: Date;
}): AtomicProgramStatement {
  return {
    sql: [
      'UPDATE "program"',
      'SET "name" = ?,',
      '    "description" = ?,',
      '    "curriculumId" = ?,',
      '    "startDate" = ?,',
      '    "endDate" = ?,',
      '    "applicationsOpen" = ?,',
      '    "updatedAt" = ?',
      'WHERE "id" = ?',
      '  AND EXISTS (SELECT 1 FROM "curriculum" WHERE "id" = ?)',
    ].join("\n"),
    params: [
      update.name,
      update.description,
      update.curriculumId,
      toEpochSeconds(update.startDate),
      toEpochSeconds(update.endDate),
      update.applicationsOpen ? 1 : 0,
      toEpochSeconds(now),
      programId,
      update.curriculumId,
    ],
    expectedChanges: 1,
  };
}

export function throwCohortUpdateFailure({
  programExists,
  curriculumExists,
}: {
  programExists: boolean;
  curriculumExists: boolean;
}): never {
  if (!programExists) {
    throw new ProgramManagementError(
      "UNKNOWN_PROGRAM",
      "This cohort no longer exists. Return to Cohorts and try again."
    );
  }
  if (!curriculumExists) {
    throw new ProgramManagementError(
      "UNKNOWN_CURRICULUM",
      "That curriculum no longer exists. Choose an existing curriculum and try again."
    );
  }
  throw new ProgramManagementError(
    "COHORT_NOT_UPDATED",
    "The cohort could not be updated because its details changed. Refresh the page and try again."
  );
}
