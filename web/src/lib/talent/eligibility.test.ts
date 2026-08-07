import { describe, expect, it, vi } from "vitest";
import {
  getCompletedCohorts,
  hasCompletedCohort,
  isValidCompletion,
} from "./eligibility";

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

const COMPLETED_AT = new Date("2026-04-12T00:00:00.000Z");

describe("isValidCompletion", () => {
  it("requires COMPLETED status and a non-null completion date", () => {
    expect(
      isValidCompletion({ status: "COMPLETED", completedAt: COMPLETED_AT })
    ).toBe(true);
    expect(
      isValidCompletion({ status: "COMPLETED", completedAt: null })
    ).toBe(false);
    expect(
      isValidCompletion({ status: "APPROVED", completedAt: COMPLETED_AT })
    ).toBe(false);
    expect(isValidCompletion(undefined)).toBe(false);
  });
});

describe("hasCompletedCohort", () => {
  it("returns false when user has no applications", async () => {
    const db = createMockDb([undefined]);
    expect(await hasCompletedCohort(db, "user-1")).toBe(false);
  });

  it("returns true when user has a valid completed application", async () => {
    const db = createMockDb([
      { status: "COMPLETED", completedAt: COMPLETED_AT },
    ]);
    expect(await hasCompletedCohort(db, "user-1")).toBe(true);
  });

  it("returns false for a legacy COMPLETED row without a date", async () => {
    const db = createMockDb([{ status: "COMPLETED", completedAt: null }]);
    expect(await hasCompletedCohort(db, "user-1")).toBe(false);
  });

  it("returns false for a dated non-COMPLETED row", async () => {
    const db = createMockDb([
      { status: "APPROVED", completedAt: COMPLETED_AT },
    ]);
    expect(await hasCompletedCohort(db, "user-1")).toBe(false);
  });

  it("issues a single query", async () => {
    const db = createMockDb([
      { status: "COMPLETED", completedAt: COMPLETED_AT },
    ]);
    await hasCompletedCohort(db, "user-1");
    expect(
      (
        db as unknown as {
          query: {
            programApplication: {
              findFirst: ReturnType<typeof vi.fn>;
            };
          };
        }
      ).query.programApplication.findFirst
    ).toHaveBeenCalledTimes(1);
  });
});

describe("getCompletedCohorts", () => {
  it("returns empty array when no completed applications", async () => {
    const db = createMockDb([], []);
    expect(await getCompletedCohorts(db, "user-1")).toEqual([]);
  });

  it("returns valid applications with programs", async () => {
    const mockApps = [
      {
        id: "app-1",
        status: "COMPLETED",
        completedAt: COMPLETED_AT,
        program: { id: "prog-1", name: "Cohort 01" },
      },
    ];
    const db = createMockDb([], mockApps);
    const result = await getCompletedCohorts(db, "user-1");
    expect(result).toHaveLength(1);
    expect(result[0].application.id).toBe("app-1");
    expect(result[0].program?.name).toBe("Cohort 01");
  });

  it("filters legacy and inconsistent rows defensively", async () => {
    const mockApps = [
      {
        id: "valid",
        status: "COMPLETED",
        completedAt: COMPLETED_AT,
        program: undefined,
      },
      {
        id: "missing-date",
        status: "COMPLETED",
        completedAt: null,
        program: undefined,
      },
      {
        id: "wrong-status",
        status: "APPROVED",
        completedAt: COMPLETED_AT,
        program: undefined,
      },
    ];
    const db = createMockDb([], mockApps);
    const result = await getCompletedCohorts(db, "user-1");
    expect(result.map(({ application }) => application.id)).toEqual(["valid"]);
  });

  it("returns null program when application has no program", async () => {
    const mockApps = [
      {
        id: "app-2",
        status: "COMPLETED",
        completedAt: COMPLETED_AT,
        program: undefined,
      },
    ];
    const db = createMockDb([], mockApps);
    const result = await getCompletedCohorts(db, "user-1");
    expect(result[0].program).toBeNull();
  });
});
