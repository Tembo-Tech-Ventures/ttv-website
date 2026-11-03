import { describe, expect, it } from "vitest";
import { chooseCohort, cohortSearchLabel, cohortWeek, type CohortMembership } from "./cohort-heading";

const day = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 8, 1);
const NOW = START + 9 * 7 * day + 2 * day;
const cohort = (overrides: Partial<CohortMembership> = {}): CohortMembership => ({
  programId: "cohort-05", name: "Cohort 05", curriculum: "Full-stack foundations",
  startDate: new Date(START), endDate: new Date(START + 12 * 7 * day), application: "APPROVED", ...overrides,
});

describe("cohortWeek", () => {
  it("says the week while the cohort runs, and nothing before, after or without dates", () => {
    expect(cohortWeek(new Date(START), new Date(START + 12 * 7 * day), NOW)).toBe("week 10 of 12");
    expect(cohortWeek(new Date(START), new Date(START + 12 * 7 * day), START)).toBe("week 1 of 12");
    expect(cohortWeek(new Date(START), new Date(START + 12 * 7 * day), START + 12 * 7 * day)).toBe("week 12 of 12");
    expect(cohortWeek(new Date(START), new Date(START + 12 * 7 * day), START - 1)).toBeNull();
    expect(cohortWeek(new Date(START), new Date(START + 12 * 7 * day), START + 12 * 7 * day + 1)).toBeNull();
    expect(cohortWeek(null, new Date(START), NOW)).toBeNull();
    expect(cohortWeek(new Date(START), null, NOW)).toBeNull();
  });
});

describe("chooseCohort (T07)", () => {
  it("names the person's cohort, what it covers and its week", () => {
    expect(chooseCohort([cohort()], NOW)).toEqual({
      id: "cohort-05", name: "Cohort 05", detail: "Full-stack foundations · week 10 of 12", application: "APPROVED",
    });
  });

  it("prefers the cohort running now, then the one that started last", () => {
    const ended = cohort({ programId: "cohort-04", name: "Cohort 04", startDate: new Date(START - 30 * 7 * day), endDate: new Date(START - 18 * 7 * day), application: "COMPLETED" });
    const next = cohort({ programId: "cohort-06", name: "Cohort 06", startDate: new Date(NOW + 30 * day), endDate: new Date(NOW + 120 * day) });
    expect(chooseCohort([ended, cohort(), next], NOW)?.id).toBe("cohort-05");
    expect(chooseCohort([ended, next], NOW)).toMatchObject({ id: "cohort-06", detail: "Full-stack foundations" });
  });

  it("keeps applying in place while an application waits (S2)", () => {
    expect(chooseCohort([cohort({ application: "COMPLETED" })], NOW, { applying: true })).toMatchObject({ id: "cohort-05", application: null });
  });

  it("keeps a role without an application, and the general name when there is no cohort", () => {
    expect(chooseCohort([cohort({ application: null, curriculum: null, endDate: null })], NOW)).toEqual({
      id: "cohort-05", name: "Cohort 05", detail: null, application: null,
    });
    expect(chooseCohort([], NOW)).toBeNull();
  });
});

describe("cohortSearchLabel", () => {
  const heading = chooseCohort([cohort()], NOW);
  const me = (cohortIds: string[]) => ({ capabilities: { cohortIds } }) as Parameters<typeof cohortSearchLabel>[0];
  it("names the cohort scope only when it covers just that cohort", () => {
    expect(cohortSearchLabel(me(["cohort-05"]), heading)).toBe("Cohort 05");
    expect(cohortSearchLabel(me(["cohort-04", "cohort-05"]), heading)).toBeNull();
    expect(cohortSearchLabel(me(["cohort-04"]), heading)).toBeNull();
    expect(cohortSearchLabel(me(["cohort-05"]), null)).toBeNull();
  });
});
