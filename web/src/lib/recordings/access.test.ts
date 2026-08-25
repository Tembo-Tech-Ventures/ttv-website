import { describe, expect, it, vi } from "vitest";
import { getAccessibleProgramIds, userCanAccessProgram } from "./access";
import type { Database } from "@/lib/db/schema";

function createDatabase({
  applications = [],
  staffRoles = [],
  applicationAccess = null,
  staffRoleAccess = null,
}: {
  applications?: Array<{ programId: string | null }>;
  staffRoles?: Array<{ programId: string }>;
  applicationAccess?: unknown;
  staffRoleAccess?: unknown;
}) {
  return {
    query: {
      programApplication: {
        findMany: vi.fn().mockResolvedValue(applications),
        findFirst: vi.fn().mockResolvedValue(applicationAccess),
      },
      programRole: {
        findMany: vi.fn().mockResolvedValue(staffRoles),
        findFirst: vi.fn().mockResolvedValue(staffRoleAccess),
      },
    },
  } as unknown as Database;
}

describe("recording access", () => {
  it("returns programs from approved or completed applications", async () => {
    const db = createDatabase({
      applications: [{ programId: "program-2024" }, { programId: null }],
    });

    await expect(getAccessibleProgramIds(db, "user-1")).resolves.toEqual(["program-2024"]);
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

  it("allows direct recording access through an approved application", async () => {
    const db = createDatabase({ applicationAccess: { id: "application-1" } });

    await expect(userCanAccessProgram(db, "user-1", "program-2024")).resolves.toBe(true);
  });

  it("allows direct recording access through an instructor or TA role", async () => {
    const db = createDatabase({ staffRoleAccess: { id: "role-1" } });

    await expect(userCanAccessProgram(db, "instructor-1", "program-2024")).resolves.toBe(true);
  });

  it("denies direct recording access when no application or staff role exists", async () => {
    const db = createDatabase({});

    await expect(userCanAccessProgram(db, "user-1", "program-2024")).resolves.toBe(false);
  });
});
