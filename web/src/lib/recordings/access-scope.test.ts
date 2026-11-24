import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccessibleProgramIds, recordingAccessFor } from "./access";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { CAPABILITY_ROLE_MATRIX } from "@/lib/platform/server/capabilities.fixtures";
import { createCapabilityDatabase } from "@/lib/platform/server/capabilities.test-support";
import { DEMO_PREFIX } from "@/lib/staging-demo-policy";

const databases: ReturnType<typeof createCapabilityDatabase>["database"][] = [];
function setup(...args: Parameters<typeof createCapabilityDatabase>) {
  const fixture = createCapabilityDatabase(...args);
  databases.push(fixture.database);
  return fixture;
}
afterEach(() => { databases.splice(0).forEach((db) => db.close()); });

const cohortRecording = (programId: string | null) => ({ programId, accessScope: programId ? "COHORT" : "ADMIN_ONLY", deletedAt: null, hiddenAt: null });

/** The policy over capabilities read from the database, as every read path calls it. */
async function canRead(db: Parameters<typeof capabilitiesFor>[0], userId: string, programId: string | null) {
  return recordingAccessFor(await capabilitiesFor(db, { id: userId }), cohortRecording(programId), { userId });
}

describe("recording access through canonical capabilities", () => {
  it.each(CAPABILITY_ROLE_MATRIX)("$name: the cohorts listed and the recordings admitted agree", async (fixture) => {
    const { db, user } = setup(fixture);
    const userId = user?.id ?? "";
    await expect(getAccessibleProgramIds(db, userId)).resolves.toEqual(fixture.expected.cohortIds);
    for (const programId of ["cohort-a", "cohort-b", "missing-cohort"]) {
      await expect(canRead(db, userId, programId)).resolves.toBe(fixture.expected.isAdmin || fixture.expected.cohortIds.includes(programId));
    }
    // A recording with no cohort: admins only.
    await expect(canRead(db, userId, null)).resolves.toBe(fixture.expected.isAdmin);
  });

  it("does not turn a mentor invitation into access to another cohort, and a revoked one takes effect at once", async () => {
    const { db, database, user } = setup({ globalRoles: ["MENTOR"], assignments: [{ programId: "cohort-a", name: "MENTOR" }] });
    database.exec(`INSERT INTO programRole (id,userId,programId,name) VALUES ('other','synthetic-otieno','cohort-b','MENTOR')`);
    await expect(canRead(db, user!.id, "cohort-a")).resolves.toBe(true);
    await expect(canRead(db, user!.id, "cohort-b")).resolves.toBe(false);
    database.exec('DELETE FROM programRole WHERE id = \'assignment-0\'');
    await expect(canRead(db, user!.id, "cohort-a")).resolves.toBe(false);
  });

  it.each([{ globalRoles: [] }, { globalRoles: ["ADMIN"] }])("preserves demo isolation with $globalRoles", async ({ globalRoles }) => {
    const userId = DEMO_PREFIX + "member-cohort";
    const { db, database } = setup({ globalRoles, applications: [{ programId: "cohort-a", status: "APPROVED" }], assignments: [{ programId: "cohort-b", name: "MENTOR" }] }, userId);
    database.prepare('INSERT INTO program (id,name,description,curriculumId) VALUES (?,?,?,?)').run(DEMO_PREFIX + "program", "Synthetic demo cohort", "Test", "curriculum");
    database.prepare('INSERT INTO programRole (id,userId,programId,name) VALUES (?,?,?,?)').run("demo-role", userId, DEMO_PREFIX + "program", "MENTOR");
    await expect(getAccessibleProgramIds(db, userId)).resolves.toEqual([DEMO_PREFIX + "program"]);
    for (const programId of ["cohort-a", "cohort-b", null]) await expect(canRead(db, userId, programId)).resolves.toBe(false);
    await expect(canRead(db, userId, DEMO_PREFIX + "program")).resolves.toBe(true);
  });

  it("ignores applications without a program and unknown legacy assignment names", async () => {
    const { db, database, user } = setup({ legacySchema: true, applications: [{ programId: null, status: "APPROVED" }] });
    database.exec(`INSERT INTO programRole (id,userId,programId,name) VALUES ('unknown','synthetic-wanjiku','cohort-a','LEGACY')`);
    await expect(getAccessibleProgramIds(db, user!.id)).resolves.toEqual([]);
    await expect(canRead(db, user!.id, "cohort-a")).resolves.toBe(false);
  });

  it.each(["programApplication", "programRole", "userRole"] as const)("fails closed when %s lookup fails", async (table) => {
    const { db, user } = setup({ assignments: [{ programId: "cohort-a", name: "MENTOR" }] });
    vi.spyOn(db.query[table], "findMany").mockRejectedValue(new Error("D1 unavailable"));
    await expect(getAccessibleProgramIds(db, user!.id)).rejects.toThrow("D1 unavailable");
    await expect(canRead(db, user!.id, "cohort-a")).rejects.toThrow("D1 unavailable");
  });
});
