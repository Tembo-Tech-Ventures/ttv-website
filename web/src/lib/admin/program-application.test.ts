import { describe, expect, it } from "vitest";
import {
  ADMIN_ENROLLMENT_STATUSES,
  APPLICATION_COMPLETION_CONFIRMATION,
  D1_MAX_BOUND_PARAMETERS,
  MAX_BULK_SELECTION_SIZE,
  PROGRAM_APPLICATION_STATUSES,
  PROGRAM_APPLICATION_TRANSITIONS,
  ProgramApplicationError,
  assertAtomicMutationApplied,
  buildAdminEnrollmentStatement,
  buildApplicationTransitionStatement,
  buildBulkMutationStatement,
  createAdminEnrollment,
  createStatusMutation,
  formatDateInputValue,
  getAvailableApplicationTransitions,
  getEnrollmentSource,
  isProgramApplicationStatus,
  parseAdminEnrollmentStatus,
  parseBulkApplicationAction,
  parseCompletionDate,
  parseProgramApplicationStatus,
  parseSelectedApplicationIds,
  planApplicationTransition,
  planBulkProgramApplicationMutation,
  throwAdminEnrollmentFailure,
  toProgramApplicationBadgeVariant,
  type BulkApplicationRecord,
  type ProgramApplicationStatus,
} from "./program-application";

const NOW = new Date("2026-08-06T12:34:56.789Z");
const TODAY = new Date("2026-08-06T00:00:00.000Z");
const HISTORICAL_COMPLETION = new Date("2025-04-12T00:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000);
const HISTORICAL_COMPLETION_SECONDS = Math.floor(
  HISTORICAL_COMPLETION.getTime() / 1_000
);

const expectDomainError = (
  callback: () => unknown,
  code: ProgramApplicationError["code"],
  message: string
) => {
  try {
    callback();
    throw new Error("Expected a ProgramApplicationError");
  } catch (error) {
    expect(error).toBeInstanceOf(ProgramApplicationError);
    expect(error).toMatchObject({ code });
    expect((error as Error).message).toContain(message);
  }
};

describe("program application statuses", () => {
  it("recognizes every schema status and rejects other values", () => {
    for (const status of PROGRAM_APPLICATION_STATUSES) {
      expect(isProgramApplicationStatus(status)).toBe(true);
      expect(parseProgramApplicationStatus(status)).toBe(status);
    }
    expect(isProgramApplicationStatus("WAITLISTED")).toBe(false);
    expect(isProgramApplicationStatus(null)).toBe(false);
    expectDomainError(
      () => parseProgramApplicationStatus("WAITLISTED"),
      "INVALID_STATUS",
      "Invalid application status"
    );
  });

  it("exposes typed badge variants for every status", () => {
    expect(
      PROGRAM_APPLICATION_STATUSES.map(toProgramApplicationBadgeVariant)
    ).toEqual(["pending", "approved", "rejected", "audit", "completed"]);
  });

  it("preserves the existing transition map", () => {
    expect(PROGRAM_APPLICATION_TRANSITIONS).toEqual({
      PENDING: ["APPROVED", "REJECTED", "AUDIT"],
      APPROVED: ["COMPLETED", "REJECTED"],
      REJECTED: [],
      AUDIT: ["APPROVED", "REJECTED"],
      COMPLETED: [],
    });
    expect(getAvailableApplicationTransitions("PENDING")).toEqual([
      "APPROVED",
      "REJECTED",
      "AUDIT",
    ]);
  });
});

describe("individual transitions", () => {
  const allowedTransitions: [
    ProgramApplicationStatus,
    ProgramApplicationStatus,
  ][] = [
    ["PENDING", "APPROVED"],
    ["PENDING", "REJECTED"],
    ["PENDING", "AUDIT"],
    ["APPROVED", "COMPLETED"],
    ["APPROVED", "REJECTED"],
    ["AUDIT", "APPROVED"],
    ["AUDIT", "REJECTED"],
  ];

  it.each(allowedTransitions)("allows %s → %s", (from, to) => {
    const plan = planApplicationTransition({
      expectedStatus: from,
      currentStatus: from,
      targetStatus: to,
      now: NOW,
    });
    expect(plan.status).toBe(to);
    expect(plan.expectedStatus).toBe(from);
  });

  it("rejects an invalid transition with a clear message", () => {
    expectDomainError(
      () =>
        planApplicationTransition({
          expectedStatus: "PENDING",
          currentStatus: "PENDING",
          targetStatus: "COMPLETED",
        }),
      "INVALID_TRANSITION",
      "PENDING to COMPLETED"
    );
  });

  it("rejects a stale expected status before planning a mutation", () => {
    expectDomainError(
      () =>
        planApplicationTransition({
          expectedStatus: "PENDING",
          currentStatus: "APPROVED",
          targetStatus: "APPROVED",
        }),
      "STALE_TRANSITION",
      "changed from PENDING to APPROVED"
    );
  });

  it("rejects unknown expected, current, and target statuses", () => {
    for (const input of [
      { expectedStatus: "UNKNOWN", currentStatus: "PENDING", targetStatus: "APPROVED" },
      { expectedStatus: "PENDING", currentStatus: "UNKNOWN", targetStatus: "APPROVED" },
      { expectedStatus: "PENDING", currentStatus: "PENDING", targetStatus: "UNKNOWN" },
    ]) {
      expectDomainError(
        () => planApplicationTransition(input),
        "INVALID_STATUS",
        "Invalid application"
      );
    }
  });

  it("atomically targets the expected source status", () => {
    const transition = planApplicationTransition({
      expectedStatus: "APPROVED",
      currentStatus: "APPROVED",
      targetStatus: "COMPLETED",
      now: NOW,
      completionDate: "2025-04-12",
    });
    const statement = buildApplicationTransitionStatement({
      applicationId: "app-1",
      transition,
    });
    expect(statement.sql).toContain('WHERE "id" = ? AND "status" = ?');
    expect(statement.params).toEqual([
      "COMPLETED",
      HISTORICAL_COMPLETION_SECONDS,
      NOW_SECONDS,
      "app-1",
      "APPROVED",
    ]);
    expect(statement.expectedChanges).toBe(1);
  });
});

describe("completedAt behavior", () => {
  it("defaults completion to today's UTC calendar date", () => {
    const mutation = createStatusMutation("COMPLETED", NOW);
    expect(mutation.completedAt).toEqual(TODAY);
    expect(mutation.updatedAt).toEqual(NOW);
    expect(mutation.completedAt).not.toBe(TODAY);
    expect(formatDateInputValue(NOW)).toBe("2026-08-06");
  });

  it("accepts an explicit historical YYYY-MM-DD date", () => {
    expect(
      parseCompletionDate("2025-04-12", NOW)
    ).toEqual(HISTORICAL_COMPLETION);
  });

  it.each([
    "2026-8-06",
    " 2026-08-06",
    "2026-02-29",
    "2026-13-01",
    new Date("2026-08-06T00:00:00.000Z"),
  ])("rejects malformed or unreal completion date %j", (value) => {
    expectDomainError(
      () => parseCompletionDate(value, NOW),
      "INVALID_COMPLETION_DATE",
      "date"
    );
  });

  it("rejects a future completion date", () => {
    expectDomainError(
      () => parseCompletionDate("2026-08-07", NOW),
      "INVALID_COMPLETION_DATE",
      "future"
    );
  });

  it.each(["PENDING", "APPROVED", "REJECTED", "AUDIT"] as const)(
    "clears completedAt for %s even when a date is supplied",
    (status) => {
      expect(
        createStatusMutation(status, NOW, "2099-01-01").completedAt
      ).toBeNull();
    }
  );
});

describe("admin enrollment", () => {
  it.each(ADMIN_ENROLLMENT_STATUSES)(
    "accepts %s direct enrollment",
    (status) => expect(parseAdminEnrollmentStatus(status)).toBe(status)
  );

  it("rejects statuses outside the two supported enrollment choices", () => {
    expectDomainError(
      () => parseAdminEnrollmentStatus("PENDING"),
      "INVALID_ENROLLMENT_STATUS",
      "APPROVED for a current learner"
    );
  });

  it("creates non-PII admin metadata and stamps historical completion", () => {
    const enrollment = createAdminEnrollment({
      id: "app-admin",
      programId: "program-1",
      userId: "user-1",
      status: "COMPLETED",
      now: NOW,
      completionDate: "2025-04-12",
    });
    expect(JSON.parse(enrollment.application)).toEqual({
      enrollment: { source: "ADMIN", schemaVersion: 1 },
    });
    expect(enrollment.application).not.toContain("user-1");
    expect(enrollment.completedAt).toEqual(HISTORICAL_COMPLETION);
    expect(enrollment.createdAt).toEqual(NOW);
  });

  it("leaves a current learner incomplete", () => {
    expect(
      createAdminEnrollment({
        id: "app-admin",
        programId: "program-1",
        userId: "user-1",
        status: "APPROVED",
        now: NOW,
      }).completedAt
    ).toBeNull();
  });

  it("recognizes only the explicit versioned admin metadata", () => {
    expect(
      getEnrollmentSource(
        JSON.stringify({
          enrollment: { source: "ADMIN", schemaVersion: 1 },
        })
      )
    ).toBe("ADMIN");
    for (const value of [
      "{}",
      "not-json",
      "null",
      JSON.stringify({ enrollment: { source: "ADMIN" } }),
      JSON.stringify({ enrollment: { source: "STUDENT", schemaVersion: 1 } }),
    ]) {
      expect(getEnrollmentSource(value)).toBe("SELF_APPLIED");
    }
  });

  it("builds one guarded insert for user, program, and duplicate checks", () => {
    const statement = buildAdminEnrollmentStatement(
      createAdminEnrollment({
        id: "app-admin",
        programId: "program-1",
        userId: "user-1",
        status: "COMPLETED",
        now: NOW,
        completionDate: "2025-04-12",
      })
    );
    expect(statement.sql).toContain('EXISTS (SELECT 1 FROM "program"');
    expect(statement.sql).toContain('EXISTS (SELECT 1 FROM "user"');
    expect(statement.sql).toContain("NOT EXISTS");
    expect(statement.params).toEqual([
      "app-admin",
      "program-1",
      "user-1",
      "COMPLETED",
      JSON.stringify({ enrollment: { source: "ADMIN", schemaVersion: 1 } }),
      HISTORICAL_COMPLETION_SECONDS,
      NOW_SECONDS,
      NOW_SECONDS,
      "program-1",
      "user-1",
      "program-1",
      "user-1",
    ]);
    expect(statement.expectedChanges).toBe(1);
  });

  it.each([
    {
      state: { programExists: false, userExists: true, alreadyEnrolled: false },
      code: "UNKNOWN_PROGRAM" as const,
      message: "cohort no longer exists",
    },
    {
      state: { programExists: true, userExists: false, alreadyEnrolled: false },
      code: "UNKNOWN_USER" as const,
      message: "user no longer exists",
    },
    {
      state: { programExists: true, userExists: true, alreadyEnrolled: true },
      code: "DUPLICATE_ENROLLMENT" as const,
      message: "already enrolled",
    },
    {
      state: { programExists: true, userExists: true, alreadyEnrolled: false },
      code: "ENROLLMENT_NOT_CREATED" as const,
      message: "roster changed",
    },
  ])("classifies $code failures", ({ state, code, message }) => {
    expectDomainError(
      () => throwAdminEnrollmentFailure(state),
      code,
      message
    );
  });
});

describe("bulk cohort actions", () => {
  const applications: BulkApplicationRecord[] = [
    { id: "pending", programId: "program-1", status: "PENDING" },
    { id: "audit", programId: "program-1", status: "AUDIT" },
    { id: "approved", programId: "program-1", status: "APPROVED" },
    { id: "other", programId: "program-2", status: "PENDING" },
    { id: "completed", programId: "program-1", status: "COMPLETED" },
  ];

  it("parses both supported actions and rejects unknown actions", () => {
    expect(parseBulkApplicationAction("bulk-approve")).toBe("bulk-approve");
    expect(parseBulkApplicationAction("bulk-complete")).toBe("bulk-complete");
    expectDomainError(
      () => parseBulkApplicationAction("bulk-reject"),
      "INVALID_BULK_ACTION",
      "supported cohort bulk action"
    );
  });

  it("rejects empty, malformed, duplicate, and oversized selections", () => {
    expectDomainError(
      () => parseSelectedApplicationIds([]),
      "EMPTY_SELECTION",
      "Select at least one"
    );
    expectDomainError(
      () => parseSelectedApplicationIds([""]),
      "INVALID_SELECTION",
      "invalid application"
    );
    expectDomainError(
      () => parseSelectedApplicationIds(["app", "app"]),
      "DUPLICATE_SELECTION",
      "more than once"
    );
    expectDomainError(
      () =>
        parseSelectedApplicationIds(
          Array.from(
            { length: MAX_BULK_SELECTION_SIZE + 1 },
            (_, index) => `app-${index}`
          )
        ),
      "SELECTION_TOO_LARGE",
      `at most ${MAX_BULK_SELECTION_SIZE}`
    );
  });

  it("plans one approval for eligible PENDING and AUDIT rows", () => {
    const plan = planBulkProgramApplicationMutation({
      action: "bulk-approve",
      programId: "program-1",
      applicationIds: ["pending", "audit"],
      applications,
      now: NOW,
    });
    expect(plan).toMatchObject({
      status: "APPROVED",
      completedAt: null,
      allowedSourceStatuses: ["PENDING", "AUDIT"],
    });
  });

  it("plans completion only for APPROVED rows and stamps completedAt", () => {
    const plan = planBulkProgramApplicationMutation({
      action: "bulk-complete",
      programId: "program-1",
      applicationIds: ["approved"],
      applications,
      now: NOW,
      completionDate: "2025-04-12",
    });
    expect(plan.status).toBe("COMPLETED");
    expect(plan.completedAt).toEqual(HISTORICAL_COMPLETION);
    expect(plan.allowedSourceStatuses).toEqual(["APPROVED"]);
  });

  it("rejects missing, cross-cohort, and ineligible rows before mutation", () => {
    for (const failure of [
      {
        applicationIds: ["missing"],
        action: "bulk-approve",
        code: "MISSING_APPLICATION" as const,
        message: "no longer exists",
      },
      {
        applicationIds: ["other"],
        action: "bulk-approve",
        code: "WRONG_COHORT" as const,
        message: "does not belong",
      },
      {
        applicationIds: ["pending", "completed"],
        action: "bulk-approve",
        code: "INELIGIBLE_STATUS" as const,
        message: "cannot include a COMPLETED",
      },
      {
        applicationIds: ["pending"],
        action: "bulk-complete",
        code: "INELIGIBLE_STATUS" as const,
        message: "only APPROVED",
      },
    ]) {
      expectDomainError(
        () =>
          planBulkProgramApplicationMutation({
            action: failure.action,
            programId: "program-1",
            applicationIds: failure.applicationIds,
            applications,
          }),
        failure.code,
        failure.message
      );
    }
  });

  it("builds a materialized all-or-none bulk update guard", () => {
    const statement = buildBulkMutationStatement(
      planBulkProgramApplicationMutation({
        action: "bulk-approve",
        programId: "program-1",
        applicationIds: ["pending", "audit"],
        applications,
        now: NOW,
      })
    );
    expect(statement.sql).toContain('WITH "eligible" AS MATERIALIZED');
    expect(statement.sql).toContain(
      'AND (SELECT COUNT(*) FROM "eligible") = ?'
    );
    expect(statement.params).toEqual([
      "program-1",
      "pending",
      "audit",
      "PENDING",
      "AUDIT",
      "APPROVED",
      null,
      NOW_SECONDS,
      2,
    ]);
    expect(statement.expectedChanges).toBe(2);
  });

  it("keeps the maximum bulk statement within D1's parameter limit", () => {
    const maximumApplications = Array.from(
      { length: MAX_BULK_SELECTION_SIZE },
      (_, index): BulkApplicationRecord => ({
        id: `pending-${index}`,
        programId: "program-1",
        status: "PENDING",
      })
    );
    const statement = buildBulkMutationStatement(
      planBulkProgramApplicationMutation({
        action: "bulk-approve",
        programId: "program-1",
        applicationIds: maximumApplications.map(({ id }) => id),
        applications: maximumApplications,
        now: NOW,
      })
    );

    expect(MAX_BULK_SELECTION_SIZE).toBeLessThanOrEqual(90);
    expect(statement.params).toHaveLength(MAX_BULK_SELECTION_SIZE + 7);
    expect(statement.params.length).toBeLessThanOrEqual(
      D1_MAX_BOUND_PARAMETERS
    );
  });

  it("includes certificate and portfolio effects in completion confirmation", () => {
    expect(APPLICATION_COMPLETION_CONFIRMATION).toMatch(/certificates/i);
    expect(APPLICATION_COMPLETION_CONFIRMATION).toMatch(/builder portfolios/i);
  });
});

describe("atomic mutation results", () => {
  const statement = { sql: "UPDATE", params: [], expectedChanges: 2 };

  it("accepts the exact expected row count", () => {
    expect(() =>
      assertAtomicMutationApplied({
        actualChanges: 2,
        statement,
        staleCode: "STALE_BULK_SELECTION",
        staleMessage: "stale",
      })
    ).not.toThrow();
  });

  it("turns zero changes into an actionable stale domain error", () => {
    expectDomainError(
      () =>
        assertAtomicMutationApplied({
          actualChanges: 0,
          statement,
          staleCode: "STALE_BULK_SELECTION",
          staleMessage: "Refresh the roster",
        }),
      "STALE_BULK_SELECTION",
      "Refresh the roster"
    );
  });

  it("treats an impossible partial count as an internal invariant failure", () => {
    expect(() =>
      assertAtomicMutationApplied({
        actualChanges: 1,
        statement,
        staleCode: "STALE_BULK_SELECTION",
        staleMessage: "stale",
      })
    ).toThrow("changed 1 rows; expected 2");
  });
});
