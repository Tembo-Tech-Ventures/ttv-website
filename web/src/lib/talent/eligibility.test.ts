import { describe, expect, it, vi } from "vitest";
import { hasCompletedCohort, getCompletedCohorts } from "./eligibility";

function createMockDb(findFirstResults: unknown[], findManyResult: unknown[] = []) {
  let callCount = 0;
  return {
    query: {
      programApplication: {
        findFirst: vi.fn().mockImplementation(() => {
          return Promise.resolve(findFirstResults[callCount++]);
        }),
        findMany: vi.fn().mockResolvedValue(findManyResult),
      },
    },
  } as unknown as Parameters<typeof hasCompletedCohort>[0];
}

describe("hasCompletedCohort", () => {
  it("returns false when user has no applications", async () => {
    const db = createMockDb([undefined]);
    expect(await hasCompletedCohort(db, "user-1")).toBe(false);
  });

  it("returns false when user has applications but none completed", async () => {
    const db = createMockDb([{ id: "app-1", status: "PENDING" }, undefined]);
    expect(await hasCompletedCohort(db, "user-1")).toBe(false);
  });

  it("returns true when user has a completed application", async () => {
    const db = createMockDb([
      { id: "app-1", status: "COMPLETED" },
      { id: "app-1" },
    ]);
    expect(await hasCompletedCohort(db, "user-1")).toBe(true);
  });
});

describe("getCompletedCohorts", () => {
  it("returns empty array when no completed applications", async () => {
    const db = createMockDb([], []);
    expect(await getCompletedCohorts(db, "user-1")).toEqual([]);
  });

  it("returns applications with programs", async () => {
    const mockApps = [
      {
        id: "app-1",
        status: "COMPLETED",
        program: { id: "prog-1", name: "Cohort 01" },
      },
    ];
    const db = createMockDb([], mockApps);
    const result = await getCompletedCohorts(db, "user-1");
    expect(result).toHaveLength(1);
    expect(result[0].application.id).toBe("app-1");
    expect(result[0].program?.name).toBe("Cohort 01");
  });

  it("returns null program when application has no program", async () => {
    const mockApps = [
      { id: "app-2", status: "COMPLETED", program: undefined },
    ];
    const db = createMockDb([], mockApps);
    const result = await getCompletedCohorts(db, "user-1");
    expect(result[0].program).toBeNull();
  });
});
