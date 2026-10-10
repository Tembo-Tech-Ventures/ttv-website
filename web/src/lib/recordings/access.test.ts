import { describe, expect, it, vi } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import {
  COHORT_ACCESS_STATUSES,
  getAccessibleProgramIds,
  userCanAccessProgram,
} from "./access";
import type { Database } from "@/lib/db/schema";

const dialect = new SQLiteSyncDialect();

type ApplicationStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "AUDIT"
  | "COMPLETED";

const APPLICATION_STATUSES = new Set<ApplicationStatus>([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "AUDIT",
  "COMPLETED",
]);

function getAllowedApplicationStatuses(where: SQL) {
  return new Set(
    dialect
      .sqlToQuery(where)
      .params.filter(
        (value): value is ApplicationStatus =>
          typeof value === "string" &&
          APPLICATION_STATUSES.has(value as ApplicationStatus)
      )
  );
}

function createDatabase({
  applications = [],
  staffRoles = [],
  applicationAccess = null,
  staffRoleAccess = null,
}: {
  applications?: Array<{
    programId: string | null;
    status?: ApplicationStatus;
  }>;
  staffRoles?: Array<{ programId: string }>;
  applicationAccess?: { id: string; status?: ApplicationStatus } | null;
  staffRoleAccess?: unknown;
}) {
  const findManyApplications = vi.fn(
    async ({ where }: { where: SQL }) => {
      const allowedStatuses = getAllowedApplicationStatuses(where);

      return applications
        .filter(
          (application) =>
            !application.status || allowedStatuses.has(application.status)
        )
        .map(({ programId }) => ({ programId }));
    }
  );
  const findApplication = vi.fn(async ({ where }: { where: SQL }) => {
    if (!applicationAccess?.status) return applicationAccess;
    return getAllowedApplicationStatuses(where).has(applicationAccess.status)
      ? applicationAccess
      : null;
  });

  return {
    query: {
      programApplication: {
        findMany: findManyApplications,
        findFirst: findApplication,
      },
      programRole: {
        findMany: vi.fn().mockResolvedValue(staffRoles),
        findFirst: vi.fn().mockResolvedValue(staffRoleAccess),
      },
    },
  } as unknown as Database;
}

describe("recording access", () => {
  it("defines audit, approved, and completed as the only cohort-access statuses", () => {
    expect(COHORT_ACCESS_STATUSES).toEqual([
      "APPROVED",
      "AUDIT",
      "COMPLETED",
    ]);
    expect(COHORT_ACCESS_STATUSES).not.toContain("PENDING");
    expect(COHORT_ACCESS_STATUSES).not.toContain("REJECTED");
  });

  it("returns programs for audit, approved, and completed applications only", async () => {
    const db = createDatabase({
      applications: [
        { programId: "program-audit", status: "AUDIT" },
        { programId: "program-approved", status: "APPROVED" },
        { programId: "program-completed", status: "COMPLETED" },
        { programId: "program-pending", status: "PENDING" },
        { programId: "program-rejected", status: "REJECTED" },
        { programId: null, status: "AUDIT" },
      ],
    });

    await expect(getAccessibleProgramIds(db, "user-1")).resolves.toEqual([
      "program-audit",
      "program-approved",
      "program-completed",
    ]);
  });

  it("returns programs where the user is an instructor or TA", async () => {
    const db = createDatabase({
      staffRoles: [{ programId: "program-2024" }, { programId: "program-2025" }],
    });

    await expect(getAccessibleProgramIds(db, "instructor-1")).resolves.toEqual([
      "program-2024",
      "program-2025",
    ]);
  });

  it("deduplicates programs available through both applications and staff roles", async () => {
    const db = createDatabase({
      applications: [{ programId: "program-2024" }],
      staffRoles: [{ programId: "program-2024" }, { programId: "program-2025" }],
    });

    await expect(getAccessibleProgramIds(db, "user-1")).resolves.toEqual([
      "program-2024",
      "program-2025",
    ]);
  });

  it("allows direct recording access through an audit application", async () => {
    const db = createDatabase({
      applicationAccess: { id: "application-1", status: "AUDIT" },
    });

    await expect(userCanAccessProgram(db, "user-1", "program-2024")).resolves.toBe(true);
  });

  it.each(["PENDING", "REJECTED"] as const)(
    "denies direct recording access through a %s application",
    async (status) => {
      const db = createDatabase({
        applicationAccess: { id: "application-1", status },
      });

      await expect(
        userCanAccessProgram(db, "user-1", "program-2024")
      ).resolves.toBe(false);
    }
  );

  it("allows direct recording access through an instructor or TA role", async () => {
    const db = createDatabase({ staffRoleAccess: { id: "role-1" } });

    await expect(userCanAccessProgram(db, "instructor-1", "program-2024")).resolves.toBe(true);
  });

  it("denies direct recording access when no application or staff role exists", async () => {
    const db = createDatabase({});

    await expect(userCanAccessProgram(db, "user-1", "program-2024")).resolves.toBe(false);
  });
});
