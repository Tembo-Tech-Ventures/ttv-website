import { describe, expect, it } from "vitest";
import {
  ProgramManagementError,
  assertProgramRoleRemoved,
  buildAddProgramRoleStatement,
  buildCohortUpdateStatement,
  buildRemoveProgramRoleStatement,
  cohortUpdateErrorField,
  cohortUpdateValuesFromFormData,
  parseCohortUpdate,
  parseOptionalCohortDate,
  parseProgramStaffRole,
  parseProgramStaffUserId,
  throwAddProgramRoleFailure,
  throwCohortUpdateFailure,
} from "./program-management";

const NOW = new Date("2026-08-06T12:34:56.789Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000);

const expectDomainError = (
  callback: () => unknown,
  code: ProgramManagementError["code"],
  message: string
) => {
  try {
    callback();
    throw new Error("Expected ProgramManagementError");
  } catch (error) {
    expect(error).toBeInstanceOf(ProgramManagementError);
    expect(error).toMatchObject({ code });
    expect((error as Error).message).toContain(message);
  }
};

describe("cohort staff roles", () => {
  it.each(["INSTRUCTOR", "TA"] as const)("accepts exact role %s", (role) => {
    expect(parseProgramStaffRole(role)).toBe(role);
  });

  it.each(["instructor", " INSTRUCTOR", "MENTOR", "", null])(
    "rejects forged role %j",
    (role) => {
      expectDomainError(
        () => parseProgramStaffRole(role),
        "INVALID_STAFF_ROLE",
        "Instructor or TA"
      );
    }
  );

  it("requires a non-empty user id and trims it", () => {
    expect(parseProgramStaffUserId("  user-1  ")).toBe("user-1");
    expectDomainError(
      () => parseProgramStaffUserId(" "),
      "INVALID_STAFF_USER",
      "existing signed-in user"
    );
  });

  it("builds one guarded duplicate-safe role insert", () => {
    const statement = buildAddProgramRoleStatement({
      id: "role-1",
      programId: "program-1",
      userId: "user-1",
      role: "INSTRUCTOR",
      now: NOW,
    });

    expect(statement.sql).toContain('INSERT OR IGNORE INTO "programRole"');
    expect(statement.sql).toContain('EXISTS (SELECT 1 FROM "user"');
    expect(statement.sql).toContain(
      '"programId" = ? AND "userId" = ? AND "name" = ?'
    );
    expect(statement.params).toEqual([
      "role-1",
      "program-1",
      "user-1",
      "INSTRUCTOR",
      NOW_SECONDS,
      NOW_SECONDS,
      "program-1",
      "user-1",
      "program-1",
      "user-1",
      "INSTRUCTOR",
    ]);
    expect(statement.expectedChanges).toBe(1);
  });

  it.each([
    {
      state: {
        programExists: false,
        userExists: true,
        duplicateRole: false,
      },
      code: "UNKNOWN_PROGRAM" as const,
      message: "cohort no longer exists",
    },
    {
      state: {
        programExists: true,
        userExists: false,
        duplicateRole: false,
      },
      code: "UNKNOWN_USER" as const,
      message: "user no longer exists",
    },
    {
      state: {
        programExists: true,
        userExists: true,
        duplicateRole: true,
      },
      code: "DUPLICATE_STAFF_ROLE" as const,
      message: "already has this role",
    },
    {
      state: {
        programExists: true,
        userExists: true,
        duplicateRole: false,
      },
      code: "STAFF_ROLE_NOT_CREATED" as const,
      message: "staff list changed",
    },
  ])("classifies $code after a zero-change insert", ({ state, code, message }) => {
    expectDomainError(
      () => throwAddProgramRoleFailure(state),
      code,
      message
    );
  });

  it("scopes role deletion by both role id and current cohort", () => {
    const statement = buildRemoveProgramRoleStatement({
      programId: "program-current",
      roleId: "role-other-cohort",
    });
    expect(statement.sql).toContain(
      'WHERE "id" = ? AND "programId" = ?'
    );
    expect(statement.params).toEqual([
      "role-other-cohort",
      "program-current",
    ]);
    expect(statement.expectedChanges).toBe(1);
  });

  it("rejects a forged cross-cohort or stale deletion", () => {
    expectDomainError(
      () => assertProgramRoleRemoved(0),
      "STAFF_ROLE_NOT_FOUND",
      "does not belong to this cohort"
    );
    expect(() => assertProgramRoleRemoved(1)).not.toThrow();
    expect(() => assertProgramRoleRemoved(2)).toThrow(
      "changed 2 rows; expected 1"
    );
  });
});

describe("typed cohort editing", () => {
  it("preserves raw form values and reads only the exact open checkbox", () => {
    const formData = new FormData();
    formData.set("name", "  Cohort 05  ");
    formData.set("description", "  Builders shipping together.  ");
    formData.set("curriculumId", " curriculum-1 ");
    formData.set("startDate", " 2026-09-01 ");
    formData.set("endDate", "2026-12-01");
    formData.set("applicationsOpen", "on");

    expect(cohortUpdateValuesFromFormData(formData)).toEqual({
      name: "  Cohort 05  ",
      description: "  Builders shipping together.  ",
      curriculumId: " curriculum-1 ",
      startDate: " 2026-09-01 ",
      endDate: "2026-12-01",
      applicationsOpen: true,
    });

    formData.set("applicationsOpen", "true");
    formData.set("description", new File(["forged"], "description.txt"));
    expect(cohortUpdateValuesFromFormData(formData)).toMatchObject({
      description: "",
      applicationsOpen: false,
    });
  });

  it.each([
    [
      new ProgramManagementError("INVALID_COHORT_NAME", "name"),
      "name",
    ],
    [
      new ProgramManagementError("INVALID_COHORT_DESCRIPTION", "description"),
      "description",
    ],
    [
      new ProgramManagementError("UNKNOWN_CURRICULUM", "curriculum"),
      "curriculumId",
    ],
    [
      new ProgramManagementError("INVALID_COHORT_DATE", "Enter start date"),
      "startDate",
    ],
    [
      new ProgramManagementError("INVALID_COHORT_DATE_RANGE", "range"),
      "endDate",
    ],
    [
      new ProgramManagementError("INVALID_APPLICATIONS_OPEN", "toggle"),
      "applicationsOpen",
    ],
  ] as const)("maps a safe inline error to %s", (error, field) => {
    expect(cohortUpdateErrorField(error)).toBe(field);
  });

  it("leaves non-field failures in the page-level alert", () => {
    expect(
      cohortUpdateErrorField(
        new ProgramManagementError("COHORT_NOT_UPDATED", "stale")
      )
    ).toBeNull();
  });

  it("trims required text, parses dates, and reads the open toggle", () => {
    expect(
      parseCohortUpdate({
        name: "  Cohort 05  ",
        description: "  Builders shipping together.  ",
        curriculumId: "  curriculum-1  ",
        startDate: " 2026-09-01 ",
        endDate: "2026-12-01 ",
        applicationsOpen: "on",
      })
    ).toEqual({
      name: "Cohort 05",
      description: "Builders shipping together.",
      curriculumId: "curriculum-1",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-12-01T00:00:00.000Z"),
      applicationsOpen: true,
    });
  });

  it("defaults an absent applications checkbox to closed", () => {
    const update = parseCohortUpdate({
      name: "Cohort 05",
      description: "Description",
      curriculumId: "curriculum-1",
      startDate: "",
      endDate: "",
      applicationsOpen: null,
    });
    expect(update.startDate).toBeNull();
    expect(update.endDate).toBeNull();
    expect(update.applicationsOpen).toBe(false);
  });

  it.each([
    {
      input: {
        name: " ",
        description: "Description",
        curriculumId: "curriculum-1",
      },
      code: "INVALID_COHORT_NAME" as const,
      message: "name is required",
    },
    {
      input: {
        name: "Cohort",
        description: "",
        curriculumId: "curriculum-1",
      },
      code: "INVALID_COHORT_DESCRIPTION" as const,
      message: "description is required",
    },
    {
      input: {
        name: "Cohort",
        description: "Description",
        curriculumId: " ",
      },
      code: "INVALID_CURRICULUM" as const,
      message: "existing curriculum",
    },
  ])("rejects required field failure $code", ({ input, code, message }) => {
    expectDomainError(
      () =>
        parseCohortUpdate({
          ...input,
          startDate: "",
          endDate: "",
          applicationsOpen: null,
        }),
      code,
      message
    );
  });

  it.each([
    "2026-2-01",
    "+2026-02-01",
    "2026-02-29",
    "2026-13-01",
    "0000-01-01",
  ])(
    "rejects malformed or unreal date %s",
    (date) => {
      expectDomainError(
        () => parseOptionalCohortDate(date, "start date"),
        "INVALID_COHORT_DATE",
        "start date"
      );
    }
  );

  it("trims optional date whitespace and treats whitespace-only dates as blank", () => {
    expect(parseOptionalCohortDate(" 2028-02-29 ", "start date")).toEqual(
      new Date("2028-02-29T00:00:00.000Z")
    );
    expect(parseOptionalCohortDate("  ", "end date")).toBeNull();
  });

  it("accepts a real leap date and rejects reversed dates", () => {
    expect(parseOptionalCohortDate("2028-02-29", "start date")).toEqual(
      new Date("2028-02-29T00:00:00.000Z")
    );
    expectDomainError(
      () =>
        parseCohortUpdate({
          name: "Cohort",
          description: "Description",
          curriculumId: "curriculum-1",
          startDate: "2026-12-02",
          endDate: "2026-12-01",
          applicationsOpen: null,
        }),
      "INVALID_COHORT_DATE_RANGE",
      "on or after"
    );
  });

  it("rejects forged toggle values", () => {
    expectDomainError(
      () =>
        parseCohortUpdate({
          name: "Cohort",
          description: "Description",
          curriculumId: "curriculum-1",
          startDate: "",
          endDate: "",
          applicationsOpen: "true",
        }),
      "INVALID_APPLICATIONS_OPEN",
      "checkbox"
    );
  });

  it("builds an existing-curriculum guarded update", () => {
    const update = parseCohortUpdate({
      name: " Cohort 05 ",
      description: " Description ",
      curriculumId: "curriculum-1",
      startDate: "2026-09-01",
      endDate: "2026-12-01",
      applicationsOpen: "on",
    });
    const statement = buildCohortUpdateStatement({
      programId: "program-1",
      update,
      now: NOW,
    });

    expect(statement.sql).toContain('"applicationsOpen" = ?');
    expect(statement.sql).toContain(
      'EXISTS (SELECT 1 FROM "curriculum" WHERE "id" = ?)'
    );
    expect(statement.params).toEqual([
      "Cohort 05",
      "Description",
      "curriculum-1",
      Math.floor(new Date("2026-09-01T00:00:00.000Z").getTime() / 1_000),
      Math.floor(new Date("2026-12-01T00:00:00.000Z").getTime() / 1_000),
      1,
      NOW_SECONDS,
      "program-1",
      "curriculum-1",
    ]);
  });

  it.each([
    {
      state: { programExists: false, curriculumExists: true },
      code: "UNKNOWN_PROGRAM" as const,
      message: "cohort no longer exists",
    },
    {
      state: { programExists: true, curriculumExists: false },
      code: "UNKNOWN_CURRICULUM" as const,
      message: "curriculum no longer exists",
    },
    {
      state: { programExists: true, curriculumExists: true },
      code: "COHORT_NOT_UPDATED" as const,
      message: "details changed",
    },
  ])("classifies guarded update failure $code", ({ state, code, message }) => {
    expectDomainError(
      () => throwCohortUpdateFailure(state),
      code,
      message
    );
  });
});
