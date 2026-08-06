import { describe, expect, it, vi } from "vitest";
import {
  LEGACY_IMPORT_PRODUCTION_DISABLED_MESSAGE,
  LegacyImportValidationError,
  createLegacyImportPlan,
  executeLegacyImport,
  isLegacyImportEnabled,
  legacyImportDisabledMessage,
  preflightLegacyImport,
} from "./import";

const DATE = "2026-08-01T12:00:00.000Z";

function validPayload() {
  return {
    version: 1,
    exportedAt: DATE,
    users: [
      {
        id: "legacy-user",
        name: "Legacy User",
        email: "legacy@example.test",
        emailVerified: DATE,
        createdAt: DATE,
        updatedAt: DATE,
      },
    ],
    roles: [],
    curricula: [
      {
        id: "curriculum-1",
        title: "Web Development",
        description: "Legacy curriculum",
        createdAt: DATE,
        updatedAt: DATE,
      },
    ],
    programPartners: [
      {
        id: "partner-1",
        name: "Partner",
        createdAt: DATE,
        updatedAt: DATE,
      },
    ],
    userRoles: [],
    programs: [
      {
        id: "program-1",
        name: "Cohort 1",
        description: "Legacy cohort",
        curriculumId: "curriculum-1",
        startDate: DATE,
        endDate: "2026-09-01T12:00:00.000Z",
        createdAt: DATE,
        updatedAt: DATE,
      },
    ],
    programRoles: [
      {
        id: "program-role-1",
        programId: "program-1",
        userId: "legacy-user",
        name: "TA",
        createdAt: DATE,
        updatedAt: DATE,
      },
    ],
    programApplications: [
      {
        id: "application-1",
        programId: "program-1",
        userId: "legacy-user",
        partnerId: "partner-1",
        status: "PENDING",
        application: { motivation: "Build with the community" },
        completedAt: null,
        createdAt: DATE,
        updatedAt: DATE,
      },
    ],
  };
}

interface FakeStatement {
  sql: string;
  values: unknown[];
  bind: (...values: unknown[]) => FakeStatement;
  all: () => Promise<{ results: Array<Record<string, unknown>> }>;
}

interface MockDatabaseOptions {
  changes?: number[];
  existing?: Partial<
    Record<"curriculum" | "program" | "programPartner" | "user", string[]>
  >;
  identityRows?: Array<{ id: string; email: string }>;
}

function mockDatabase({
  changes = [],
  existing = {},
  identityRows = [],
}: MockDatabaseOptions = {}) {
  const prepared: FakeStatement[] = [];
  const prepare = vi.fn((sql: string) => {
    const statement: FakeStatement = {
      sql,
      values: [],
      bind: (...values: unknown[]) => {
        statement.values = values;
        return statement;
      },
      all: async () => {
        if (sql.includes('SELECT "id", "email"')) {
          return { results: identityRows };
        }

        const table = (
          ["curriculum", "programPartner", "program", "user"] as const
        ).find((candidate) => sql.includes(`FROM "${candidate}"`));
        const ids = table ? existing[table] ?? [] : [];
        return { results: ids.map((id) => ({ id })) };
      },
    };
    prepared.push(statement);
    return statement;
  });
  const batch = vi.fn(async (statements: unknown[]) =>
    statements.map((_statement, index) => ({
      meta: { changes: changes[index] ?? 1 },
    }))
  );

  return {
    db: { prepare, batch } as unknown as D1Database,
    prepare,
    batch,
    prepared,
  };
}

function expectValidation(
  action: () => unknown,
  code: LegacyImportValidationError["code"] = "invalid_payload"
) {
  try {
    action();
    throw new Error("Expected validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(LegacyImportValidationError);
    expect((error as LegacyImportValidationError).code).toBe(code);
  }
}

describe("legacy import environment policy", () => {
  it("enables migration testing only in staging and valid agent environments", () => {
    expect(isLegacyImportEnabled("staging")).toBe(true);
    expect(isLegacyImportEnabled("agent-pr-123")).toBe(true);
    expect(isLegacyImportEnabled("agent-task1")).toBe(true);
    expect(isLegacyImportEnabled("production")).toBe(false);
    expect(isLegacyImportEnabled("development")).toBe(false);
    expect(isLegacyImportEnabled(undefined)).toBe(false);
    expect(isLegacyImportEnabled("agent-")).toBe(false);
  });

  it("provides the reviewed-tools explanation in production", () => {
    expect(legacyImportDisabledMessage("production")).toBe(
      LEGACY_IMPORT_PRODUCTION_DISABLED_MESSAGE
    );
    expect(legacyImportDisabledMessage("production")).toContain(
      "reviewed admin tools"
    );
  });
});

describe("legacy import planning and validation", () => {
  it("strips legacy privilege data without generating or reporting grants", async () => {
    const payload = {
      version: 1,
      exportedAt: DATE,
      roles: [{ id: "admin-role", name: "ADMIN" }],
      userRoles: [
        {
          id: "grant-1",
          userId: "attacker",
          roleId: "admin-role",
        },
      ],
    };

    const plan = createLegacyImportPlan(payload);
    expect(plan.statements).toEqual([]);
    expect(plan.ignored).toEqual({ roles: 1, userRoles: 1 });
    expect(JSON.stringify(plan.statements)).not.toMatch(/Roles|UserRoles|ADMIN/);

    const database = mockDatabase();
    const result = await executeLegacyImport(database.db, payload);
    expect(database.batch).not.toHaveBeenCalled();
    expect(result.totalChanges).toBe(0);
    expect(result.imported).not.toHaveProperty("roles");
    expect(result.imported).not.toHaveProperty("userRoles");
    expect(result.ignored).toEqual({ roles: 1, userRoles: 1 });
  });

  it("uses bound values rather than embedding imported identity data in SQL", () => {
    const plan = createLegacyImportPlan(validPayload());
    const userStatement = plan.statements.find(
      (statement) => statement.table === "users"
    );

    expect(userStatement?.sql).not.toContain("legacy@example.test");
    expect(userStatement?.values).toContain("legacy@example.test");
  });

  it("leaves applicationsOpen out of legacy program inserts so the closed default applies", () => {
    const payload = validPayload();
    Object.assign(payload.programs[0], { applicationsOpen: true });

    const plan = createLegacyImportPlan(payload);
    const programStatement = plan.statements.find(
      (statement) => statement.table === "programs"
    );

    expect(programStatement?.sql).not.toContain("applicationsOpen");
    expect(programStatement?.sql.match(/\?/g)).toHaveLength(8);
    expect(programStatement?.values).toHaveLength(8);
    expect(programStatement?.values).not.toContain(true);
  });

  it.each([
    {
      name: "program role natural key",
      duplicate: (payload: ReturnType<typeof validPayload>) => {
        payload.programRoles.push({
          ...payload.programRoles[0],
          id: "program-role-2",
        });
      },
    },
    {
      name: "non-null application cohort pair",
      duplicate: (payload: ReturnType<typeof validPayload>) => {
        payload.programApplications.push({
          ...payload.programApplications[0],
          id: "application-2",
        });
      },
    },
  ])("rejects a duplicate $name before any D1 work", async ({ duplicate }) => {
    const payload = validPayload();
    duplicate(payload);
    const database = mockDatabase();

    await expect(executeLegacyImport(database.db, payload)).rejects.toMatchObject({
      code: "invalid_payload",
    });
    expect(database.prepare).not.toHaveBeenCalled();
    expect(database.batch).not.toHaveBeenCalled();
  });

  it("allows repeated null-program partner applications for the same user", () => {
    const payload = validPayload();
    const plan = createLegacyImportPlan({
      ...payload,
      programApplications: [
        {
          ...payload.programApplications[0],
          id: "partner-application-1",
          programId: null,
        },
        {
          ...payload.programApplications[0],
          id: "partner-application-2",
          programId: null,
        },
      ],
    });

    expect(plan.attempted.programApplications).toBe(2);
  });

  it.each([
    {
      name: "non-array section",
      mutate: (payload: Record<string, unknown>) => {
        payload.users = {};
      },
      message: "users must be an array",
    },
    {
      name: "unsupported application status",
      mutate: (payload: Record<string, unknown>) => {
        const applications = payload.programApplications as Array<
          Record<string, unknown>
        >;
        applications[0].status = "ADMIN";
      },
      message: "status is not supported",
    },
    {
      name: "malformed date",
      mutate: (payload: Record<string, unknown>) => {
        const programs = payload.programs as Array<Record<string, unknown>>;
        programs[0].startDate = "not-a-date";
      },
      message: "ISO-8601",
    },
    {
      name: "impossible calendar date",
      mutate: (payload: Record<string, unknown>) => {
        const programs = payload.programs as Array<Record<string, unknown>>;
        programs[0].startDate = "2026-02-30T12:00:00.000Z";
      },
      message: "valid date",
    },
    {
      name: "reversed cohort dates",
      mutate: (payload: Record<string, unknown>) => {
        const programs = payload.programs as Array<Record<string, unknown>>;
        programs[0].startDate = "2026-10-01T12:00:00.000Z";
      },
      message: "must not be after",
    },
    {
      name: "invalid application JSON",
      mutate: (payload: Record<string, unknown>) => {
        const applications = payload.programApplications as Array<
          Record<string, unknown>
        >;
        applications[0].application = "{invalid";
      },
      message: "valid JSON",
    },
    {
      name: "completed application without date",
      mutate: (payload: Record<string, unknown>) => {
        const applications = payload.programApplications as Array<
          Record<string, unknown>
        >;
        applications[0].status = "COMPLETED";
      },
      message: "completedAt is required",
    },
    {
      name: "non-completed application with completion date",
      mutate: (payload: Record<string, unknown>) => {
        const applications = payload.programApplications as Array<
          Record<string, unknown>
        >;
        applications[0].completedAt = DATE;
      },
      message: "allowed only",
    },
    {
      name: "invalid program role",
      mutate: (payload: Record<string, unknown>) => {
        const roles = payload.programRoles as Array<Record<string, unknown>>;
        roles[0].name = "ADMIN";
      },
      message: "INSTRUCTOR or TA",
    },
  ])("rejects $name before statement execution", ({ mutate, message }) => {
    const payload = validPayload() as Record<string, unknown>;
    mutate(payload);

    expect(() => createLegacyImportPlan(payload)).toThrow(message);
  });

  it("rejects malformed ignored privilege sections instead of coercing them", () => {
    expectValidation(() =>
      createLegacyImportPlan({
        version: 1,
        exportedAt: DATE,
        roles: "ADMIN",
      })
    );
  });
});

describe("legacy import database preflight", () => {
  it("rejects invalid foreign-key references before opening a batch", async () => {
    const payload = validPayload();
    payload.programs[0].curriculumId = "missing-curriculum";
    payload.curricula = [];
    const database = mockDatabase();

    await expect(executeLegacyImport(database.db, payload)).rejects.toMatchObject({
      code: "invalid_reference",
    });
    expect(database.batch).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "same email under a different id",
      rows: [{ id: "current-oauth-user", email: "legacy@example.test" }],
    },
    {
      name: "same id under a different email",
      rows: [{ id: "legacy-user", email: "current@example.test" }],
    },
  ])("classifies $name as deferred identity reconciliation", async ({ rows }) => {
    const database = mockDatabase({ identityRows: rows });

    await expect(
      preflightLegacyImport(database.db, validPayload())
    ).rejects.toMatchObject({
      code: "identity_collision",
      message: expect.stringContaining("Full identity reconciliation is deferred"),
    });
    expect(database.batch).not.toHaveBeenCalled();

    try {
      await preflightLegacyImport(database.db, validPayload());
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("legacy@example.test");
      expect(message).not.toContain("current-oauth-user");
    }
  });

  it("accepts an idempotent current identity with the same id and email", async () => {
    const database = mockDatabase({
      identityRows: [{ id: "legacy-user", email: "LEGACY@example.test" }],
    });

    await expect(
      preflightLegacyImport(database.db, validPayload())
    ).resolves.toMatchObject({
      attempted: {
        users: 1,
        curricula: 1,
        programPartners: 1,
        programs: 1,
        programRoles: 1,
        programApplications: 1,
      },
    });
  });

  it("reports D1 batch changes and zero-change skips instead of input lengths", async () => {
    const database = mockDatabase({
      changes: [0, 1, 0, 1, 0, 1],
      identityRows: [{ id: "legacy-user", email: "legacy@example.test" }],
    });

    const result = await executeLegacyImport(database.db, validPayload());

    expect(database.batch).toHaveBeenCalledTimes(1);
    expect(result.totalChanges).toBe(3);
    expect(result.totalSkipped).toBe(3);
    expect(result.imported).toEqual({
      users: 0,
      curricula: 1,
      programPartners: 0,
      programs: 1,
      programRoles: 0,
      programApplications: 1,
    });
    expect(result.skipped).toEqual({
      users: 1,
      curricula: 0,
      programPartners: 1,
      programs: 0,
      programRoles: 1,
      programApplications: 0,
    });
    expect(result.ignored).toEqual({ roles: 0, userRoles: 0 });
  });

  it("reports a fully idempotent replay as skipped with no imported rows", async () => {
    const database = mockDatabase({
      changes: [0, 0, 0, 0, 0, 0],
      identityRows: [{ id: "legacy-user", email: "legacy@example.test" }],
    });

    const result = await executeLegacyImport(database.db, validPayload());

    expect(result.totalChanges).toBe(0);
    expect(result.totalSkipped).toBe(6);
    expect(Object.values(result.imported)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
