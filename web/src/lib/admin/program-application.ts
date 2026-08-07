export const PROGRAM_APPLICATION_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "AUDIT",
  "COMPLETED",
] as const;

export type ProgramApplicationStatus =
  (typeof PROGRAM_APPLICATION_STATUSES)[number];

export type ProgramApplicationBadgeVariant =
  Lowercase<ProgramApplicationStatus>;

export const PROGRAM_APPLICATION_TRANSITIONS = {
  PENDING: ["APPROVED", "REJECTED", "AUDIT"],
  APPROVED: ["COMPLETED", "REJECTED"],
  REJECTED: [],
  AUDIT: ["APPROVED", "REJECTED"],
  COMPLETED: [],
} as const satisfies Record<
  ProgramApplicationStatus,
  readonly ProgramApplicationStatus[]
>;

export const ADMIN_ENROLLMENT_STATUSES = ["APPROVED", "COMPLETED"] as const;
export type AdminEnrollmentStatus =
  (typeof ADMIN_ENROLLMENT_STATUSES)[number];

export const BULK_PROGRAM_APPLICATION_ACTIONS = [
  "bulk-approve",
  "bulk-complete",
] as const;
export type BulkProgramApplicationAction =
  (typeof BULK_PROGRAM_APPLICATION_ACTIONS)[number];

export const APPLICATION_COMPLETION_CONFIRMATION =
  "Completing students immediately unlocks their certificates and builder portfolios. Continue?";

export const D1_MAX_BOUND_PARAMETERS = 100;
export const MAX_BULK_SELECTION_SIZE = 90;

const ADMIN_ENROLLMENT_APPLICATION = JSON.stringify({
  enrollment: {
    source: "ADMIN",
    schemaVersion: 1,
  },
});

export type ProgramApplicationErrorCode =
  | "INVALID_STATUS"
  | "INVALID_TRANSITION"
  | "STALE_TRANSITION"
  | "INVALID_COMPLETION_DATE"
  | "INVALID_ENROLLMENT_STATUS"
  | "INVALID_APPLICATION_PROGRAM"
  | "CLOSED_PROGRAM"
  | "DUPLICATE_APPLICATION"
  | "APPLICATION_NOT_CREATED"
  | "UNKNOWN_PROGRAM"
  | "UNKNOWN_USER"
  | "DUPLICATE_ENROLLMENT"
  | "ENROLLMENT_NOT_CREATED"
  | "INVALID_BULK_ACTION"
  | "EMPTY_SELECTION"
  | "INVALID_SELECTION"
  | "DUPLICATE_SELECTION"
  | "SELECTION_TOO_LARGE"
  | "MISSING_APPLICATION"
  | "WRONG_COHORT"
  | "INELIGIBLE_STATUS"
  | "STALE_BULK_SELECTION";

export class ProgramApplicationError extends Error {
  constructor(
    readonly code: ProgramApplicationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ProgramApplicationError";
  }
}

export interface ProgramApplicationStatusMutation {
  status: ProgramApplicationStatus;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface ProgramApplicationTransitionPlan
  extends ProgramApplicationStatusMutation {
  expectedStatus: ProgramApplicationStatus;
}

export interface AdminEnrollmentRecord
  extends ProgramApplicationStatusMutation {
  id: string;
  programId: string;
  userId: string;
  application: string;
  createdAt: Date;
}

export interface SelfApplicationRecord {
  id: string;
  programId: string;
  userId: string;
  status: "PENDING";
  application: "{}";
  completedAt: null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BulkApplicationRecord {
  id: string;
  programId: string | null;
  status: ProgramApplicationStatus;
}

export interface BulkProgramApplicationPlan
  extends ProgramApplicationStatusMutation {
  action: BulkProgramApplicationAction;
  programId: string;
  applicationIds: readonly string[];
  allowedSourceStatuses: readonly ProgramApplicationStatus[];
}

export interface AtomicMutationStatement {
  sql: string;
  params: readonly (string | number | null)[];
  expectedChanges: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clonedDate = (value: Date) => new Date(value.getTime());

export const formatDateInputValue = (value = new Date()) =>
  value.toISOString().slice(0, 10);

export function parseCompletionDate(
  value: unknown,
  now = new Date()
): Date {
  const dateValue =
    value === null || value === undefined || value === ""
      ? formatDateInputValue(now)
      : value;

  if (
    typeof dateValue !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)
  ) {
    throw new ProgramApplicationError(
      "INVALID_COMPLETION_DATE",
      "Enter a completion date in YYYY-MM-DD format."
    );
  }

  const parsed = new Date(dateValue + "T00:00:00.000Z");
  if (
    Number.isNaN(parsed.getTime()) ||
    formatDateInputValue(parsed) !== dateValue
  ) {
    throw new ProgramApplicationError(
      "INVALID_COMPLETION_DATE",
      "Enter a real completion date in YYYY-MM-DD format."
    );
  }

  if (dateValue > formatDateInputValue(now)) {
    throw new ProgramApplicationError(
      "INVALID_COMPLETION_DATE",
      "Completion date cannot be in the future."
    );
  }

  return parsed;
}

const toEpochSeconds = (value: Date | null) =>
  value === null ? null : Math.floor(value.getTime() / 1_000);

const placeholders = (count: number) =>
  Array.from({ length: count }, () => "?").join(", ");

export function isProgramApplicationStatus(
  value: unknown
): value is ProgramApplicationStatus {
  return (
    typeof value === "string" &&
    PROGRAM_APPLICATION_STATUSES.some((status) => status === value)
  );
}

export function parseProgramApplicationStatus(
  value: unknown,
  fieldName = "status"
): ProgramApplicationStatus {
  if (!isProgramApplicationStatus(value)) {
    throw new ProgramApplicationError(
      "INVALID_STATUS",
      `Invalid application ${fieldName}. Refresh the page and try again.`
    );
  }

  return value;
}

export function getAvailableApplicationTransitions(
  status: ProgramApplicationStatus
): readonly ProgramApplicationStatus[] {
  return PROGRAM_APPLICATION_TRANSITIONS[status];
}

export function toProgramApplicationBadgeVariant(
  status: ProgramApplicationStatus
): ProgramApplicationBadgeVariant {
  return status.toLowerCase() as ProgramApplicationBadgeVariant;
}

export function createStatusMutation(
  status: ProgramApplicationStatus,
  now = new Date(),
  completionDate?: unknown
): ProgramApplicationStatusMutation {
  const timestamp = clonedDate(now);
  return {
    status,
    completedAt:
      status === "COMPLETED"
        ? parseCompletionDate(completionDate, timestamp)
        : null,
    updatedAt: timestamp,
  };
}

export function planApplicationTransition({
  expectedStatus: expectedValue,
  currentStatus: currentValue,
  targetStatus: targetValue,
  now = new Date(),
  completionDate,
}: {
  expectedStatus: unknown;
  currentStatus: unknown;
  targetStatus: unknown;
  now?: Date;
  completionDate?: unknown;
}): ProgramApplicationTransitionPlan {
  const expectedStatus = parseProgramApplicationStatus(
    expectedValue,
    "expected status"
  );
  const currentStatus = parseProgramApplicationStatus(
    currentValue,
    "current status"
  );
  const targetStatus = parseProgramApplicationStatus(
    targetValue,
    "target status"
  );

  if (expectedStatus !== currentStatus) {
    throw new ProgramApplicationError(
      "STALE_TRANSITION",
      `This application changed from ${expectedStatus} to ${currentStatus}. Refresh the page before changing it again.`
    );
  }

  if (
    !getAvailableApplicationTransitions(currentStatus).some(
      (status) => status === targetStatus
    )
  ) {
    throw new ProgramApplicationError(
      "INVALID_TRANSITION",
      `Cannot transition an application from ${currentStatus} to ${targetStatus}.`
    );
  }

  return {
    expectedStatus,
    ...createStatusMutation(targetStatus, now, completionDate),
  };
}

export function parseAdminEnrollmentStatus(
  value: unknown
): AdminEnrollmentStatus {
  if (
    value !== "APPROVED" &&
    value !== "COMPLETED"
  ) {
    throw new ProgramApplicationError(
      "INVALID_ENROLLMENT_STATUS",
      "Direct enrollment must be APPROVED for a current learner or COMPLETED for historical alumni."
    );
  }

  return value;
}

export function createAdminEnrollment({
  id,
  programId,
  userId,
  status: statusValue,
  now = new Date(),
  completionDate,
}: {
  id: string;
  programId: string;
  userId: string;
  status: unknown;
  now?: Date;
  completionDate?: unknown;
}): AdminEnrollmentRecord {
  const status = parseAdminEnrollmentStatus(statusValue);
  const timestamp = clonedDate(now);

  return {
    id,
    programId,
    userId,
    application: ADMIN_ENROLLMENT_APPLICATION,
    createdAt: clonedDate(timestamp),
    ...createStatusMutation(status, timestamp, completionDate),
  };
}

export function createSelfApplication({
  id,
  programId: programIdValue,
  userId,
  now = new Date(),
}: {
  id: string;
  programId: unknown;
  userId: string;
  now?: Date;
}): SelfApplicationRecord {
  if (
    typeof programIdValue !== "string" ||
    programIdValue.trim().length === 0
  ) {
    throw new ProgramApplicationError(
      "INVALID_APPLICATION_PROGRAM",
      "Choose an open cohort before applying."
    );
  }

  const timestamp = clonedDate(now);
  return {
    id,
    programId: programIdValue.trim(),
    userId,
    status: "PENDING",
    application: "{}",
    completedAt: null,
    createdAt: clonedDate(timestamp),
    updatedAt: timestamp,
  };
}

export function buildSelfApplicationStatement(
  application: SelfApplicationRecord
): AtomicMutationStatement {
  return {
    sql: [
      'INSERT OR IGNORE INTO "programApplication"',
      '  ("id", "programId", "userId", "status", "application", "completedAt", "createdAt", "updatedAt")',
      "SELECT ?, ?, ?, ?, ?, ?, ?, ?",
      'WHERE EXISTS (',
      '  SELECT 1 FROM "program"',
      '  WHERE "id" = ? AND "applicationsOpen" = 1',
      ")",
      '  AND EXISTS (SELECT 1 FROM "user" WHERE "id" = ?)',
      "  AND NOT EXISTS (",
      '    SELECT 1 FROM "programApplication"',
      '    WHERE "programId" = ? AND "userId" = ?',
      "  )",
    ].join("\n"),
    params: [
      application.id,
      application.programId,
      application.userId,
      application.status,
      application.application,
      application.completedAt,
      toEpochSeconds(application.createdAt),
      toEpochSeconds(application.updatedAt),
      application.programId,
      application.userId,
      application.programId,
      application.userId,
    ],
    expectedChanges: 1,
  };
}

export function throwSelfApplicationFailure({
  programExists,
  applicationsOpen,
  userExists,
  alreadyApplied,
}: {
  programExists: boolean;
  applicationsOpen: boolean;
  userExists: boolean;
  alreadyApplied: boolean;
}): never {
  if (!programExists) {
    throw new ProgramApplicationError(
      "UNKNOWN_PROGRAM",
      "That cohort does not exist. Choose one of the open cohorts shown below."
    );
  }
  if (!applicationsOpen) {
    throw new ProgramApplicationError(
      "CLOSED_PROGRAM",
      "Applications for that cohort are closed."
    );
  }
  if (alreadyApplied) {
    throw new ProgramApplicationError(
      "DUPLICATE_APPLICATION",
      "You have already applied to that cohort."
    );
  }
  if (!userExists) {
    throw new ProgramApplicationError(
      "UNKNOWN_USER",
      "Your signed-in user no longer exists. Sign in again before applying."
    );
  }
  throw new ProgramApplicationError(
    "APPLICATION_NOT_CREATED",
    "The application could not be created because cohort availability changed. Refresh the page and try again."
  );
}

export function getEnrollmentSource(
  applicationJson: string
): "ADMIN" | "SELF_APPLIED" {
  try {
    const application: unknown = JSON.parse(applicationJson);
    if (!isRecord(application) || !isRecord(application.enrollment)) {
      return "SELF_APPLIED";
    }

    return application.enrollment.source === "ADMIN" &&
      application.enrollment.schemaVersion === 1
      ? "ADMIN"
      : "SELF_APPLIED";
  } catch {
    return "SELF_APPLIED";
  }
}

export function throwAdminEnrollmentFailure({
  programExists,
  userExists,
  alreadyEnrolled,
}: {
  programExists: boolean;
  userExists: boolean;
  alreadyEnrolled: boolean;
}): never {
  if (!programExists) {
    throw new ProgramApplicationError(
      "UNKNOWN_PROGRAM",
      "This cohort no longer exists. Return to Programs and choose a current cohort."
    );
  }
  if (!userExists) {
    throw new ProgramApplicationError(
      "UNKNOWN_USER",
      "That signed-in user no longer exists. Refresh the roster and choose another user."
    );
  }
  if (alreadyEnrolled) {
    throw new ProgramApplicationError(
      "DUPLICATE_ENROLLMENT",
      "That user is already enrolled in this cohort. Refresh the roster to see their application."
    );
  }

  throw new ProgramApplicationError(
    "ENROLLMENT_NOT_CREATED",
    "The enrollment could not be created because the roster changed. Refresh the page and try again."
  );
}

export function parseBulkApplicationAction(
  value: unknown
): BulkProgramApplicationAction {
  if (
    value !== "bulk-approve" &&
    value !== "bulk-complete"
  ) {
    throw new ProgramApplicationError(
      "INVALID_BULK_ACTION",
      "Choose a supported cohort bulk action and try again."
    );
  }
  return value;
}

export function parseSelectedApplicationIds(
  values: readonly unknown[]
): readonly string[] {
  if (values.length === 0) {
    throw new ProgramApplicationError(
      "EMPTY_SELECTION",
      "Select at least one cohort application before running a bulk action."
    );
  }
  if (values.length > MAX_BULK_SELECTION_SIZE) {
    throw new ProgramApplicationError(
      "SELECTION_TOO_LARGE",
      `Select at most ${MAX_BULK_SELECTION_SIZE} applications at a time.`
    );
  }

  const applicationIds = values.map((value) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ProgramApplicationError(
        "INVALID_SELECTION",
        "The cohort selection contained an invalid application. Refresh the page and select the rows again."
      );
    }
    return value.trim();
  });

  if (new Set(applicationIds).size !== applicationIds.length) {
    throw new ProgramApplicationError(
      "DUPLICATE_SELECTION",
      "The same application was selected more than once. Refresh the page and try again."
    );
  }

  return applicationIds;
}

const BULK_ACTION_CONFIG = {
  "bulk-approve": {
    targetStatus: "APPROVED",
    allowedSourceStatuses: ["PENDING", "AUDIT"],
    actionLabel: "Bulk approve",
  },
  "bulk-complete": {
    targetStatus: "COMPLETED",
    allowedSourceStatuses: ["APPROVED"],
    actionLabel: "Bulk complete",
  },
} as const satisfies Record<
  BulkProgramApplicationAction,
  {
    targetStatus: ProgramApplicationStatus;
    allowedSourceStatuses: readonly ProgramApplicationStatus[];
    actionLabel: string;
  }
>;

export function planBulkProgramApplicationMutation({
  action: actionValue,
  programId,
  applicationIds: selectedValues,
  applications,
  now = new Date(),
  completionDate,
}: {
  action: unknown;
  programId: string;
  applicationIds: readonly unknown[];
  applications: readonly BulkApplicationRecord[];
  now?: Date;
  completionDate?: unknown;
}): BulkProgramApplicationPlan {
  const action = parseBulkApplicationAction(actionValue);
  const applicationIds = parseSelectedApplicationIds(selectedValues);
  const config = BULK_ACTION_CONFIG[action];
  const recordsById = new Map(
    applications.map((application) => [application.id, application])
  );

  for (const applicationId of applicationIds) {
    const application = recordsById.get(applicationId);
    if (!application) {
      throw new ProgramApplicationError(
        "MISSING_APPLICATION",
        `Application ${applicationId} no longer exists. Refresh the roster before trying again.`
      );
    }
    if (application.programId !== programId) {
      throw new ProgramApplicationError(
        "WRONG_COHORT",
        `Application ${applicationId} does not belong to this cohort. Refresh the roster and select only this cohort's rows.`
      );
    }
    if (
      !config.allowedSourceStatuses.some(
        (status) => status === application.status
      )
    ) {
      throw new ProgramApplicationError(
        "INELIGIBLE_STATUS",
        `${config.actionLabel} cannot include a ${application.status} application. Refresh the roster and select only ${config.allowedSourceStatuses.join(" or ")} applications.`
      );
    }
  }

  return {
    action,
    programId,
    applicationIds,
    allowedSourceStatuses: config.allowedSourceStatuses,
    ...createStatusMutation(config.targetStatus, now, completionDate),
  };
}

export function buildAdminEnrollmentStatement(
  enrollment: AdminEnrollmentRecord
): AtomicMutationStatement {
  return {
    sql: `INSERT INTO "programApplication"
      ("id", "programId", "userId", "status", "application", "completedAt", "createdAt", "updatedAt")
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM "program" WHERE "id" = ?)
      AND EXISTS (SELECT 1 FROM "user" WHERE "id" = ?)
      AND NOT EXISTS (
        SELECT 1 FROM "programApplication"
        WHERE "programId" = ? AND "userId" = ?
      )`,
    params: [
      enrollment.id,
      enrollment.programId,
      enrollment.userId,
      enrollment.status,
      enrollment.application,
      toEpochSeconds(enrollment.completedAt),
      toEpochSeconds(enrollment.createdAt),
      toEpochSeconds(enrollment.updatedAt),
      enrollment.programId,
      enrollment.userId,
      enrollment.programId,
      enrollment.userId,
    ],
    expectedChanges: 1,
  };
}

export function buildApplicationTransitionStatement({
  applicationId,
  transition,
}: {
  applicationId: string;
  transition: ProgramApplicationTransitionPlan;
}): AtomicMutationStatement {
  return {
    sql: `UPDATE "programApplication"
      SET "status" = ?, "completedAt" = ?, "updatedAt" = ?
      WHERE "id" = ? AND "status" = ?`,
    params: [
      transition.status,
      toEpochSeconds(transition.completedAt),
      toEpochSeconds(transition.updatedAt),
      applicationId,
      transition.expectedStatus,
    ],
    expectedChanges: 1,
  };
}

export function buildBulkMutationStatement(
  plan: BulkProgramApplicationPlan
): AtomicMutationStatement {
  const idPlaceholders = placeholders(plan.applicationIds.length);
  const statusPlaceholders = placeholders(plan.allowedSourceStatuses.length);

  return {
    sql: `WITH "eligible" AS MATERIALIZED (
      SELECT "id" FROM "programApplication"
      WHERE "programId" = ?
        AND "id" IN (${idPlaceholders})
        AND "status" IN (${statusPlaceholders})
    )
    UPDATE "programApplication"
    SET "status" = ?, "completedAt" = ?, "updatedAt" = ?
    WHERE "id" IN (SELECT "id" FROM "eligible")
      AND (SELECT COUNT(*) FROM "eligible") = ?`,
    params: [
      plan.programId,
      ...plan.applicationIds,
      ...plan.allowedSourceStatuses,
      plan.status,
      toEpochSeconds(plan.completedAt),
      toEpochSeconds(plan.updatedAt),
      plan.applicationIds.length,
    ],
    expectedChanges: plan.applicationIds.length,
  };
}

export function assertAtomicMutationApplied({
  actualChanges,
  statement,
  staleCode,
  staleMessage,
}: {
  actualChanges: number;
  statement: AtomicMutationStatement;
  staleCode: "STALE_TRANSITION" | "STALE_BULK_SELECTION";
  staleMessage: string;
}): void {
  if (actualChanges === statement.expectedChanges) return;
  if (actualChanges === 0) {
    throw new ProgramApplicationError(staleCode, staleMessage);
  }

  throw new Error(
    `Atomic program application mutation changed ${actualChanges} rows; expected ${statement.expectedChanges}.`
  );
}
