import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MENTORS_OFF, cohortMentorModel, cohortRoleRefusal, teachingRoles, type CohortRoleRow } from "./cohort-mentors";

const people = [
  { id: "u-otieno", name: "Otieno Ouma", email: "otieno@invalid.ttv" },
  { id: "u-david", name: "David Kamau", email: "david@invalid.ttv" },
  { id: "u-mercy", name: "Mercy Akinyi", email: "mercy@invalid.ttv" },
  { id: "u-faith", name: "Faith Njeri", email: "faith@invalid.ttv" },
];
const role = (id: string, userId: string, name: string, user = people.find((person) => person.id === userId) ?? null): CohortRoleRow =>
  ({ id, userId, name, user });

describe("cohortMentorModel", () => {
  const roles = [role("r1", "u-faith", "TA"), role("r2", "u-mercy", "MENTOR"), role("r3", "u-david", "MENTOR")];
  const model = cohortMentorModel(roles, people, new Set(["u-david", "u-otieno"]));

  it("lists the cohort's mentors by name, marking community mentors", () => {
    expect(model.mentors).toEqual([
      { roleId: "r3", userId: "u-david", name: "David Kamau", email: "david@invalid.ttv", approvedMentor: true },
      { roleId: "r2", userId: "u-mercy", name: "Mercy Akinyi", email: "mercy@invalid.ttv", approvedMentor: false },
    ]);
  });

  it("offers community mentors first, and never someone who already mentors the cohort", () => {
    expect(model.approvedCandidates.map(({ id }) => id)).toEqual(["u-otieno"]);
    expect(model.otherCandidates.map(({ id }) => id)).toEqual(["u-faith"]);
  });

  it("keeps the cohort's own students out of the other groups and offers them last, apart (QA2-12)", () => {
    const withRoster = cohortMentorModel(roles, people, new Set(["u-david", "u-otieno"]), new Set(["u-faith", "u-otieno", "u-mercy"]));
    expect(withRoster.approvedCandidates).toEqual([]);
    expect(withRoster.otherCandidates).toEqual([]);
    // Mercy already mentors the cohort, so she is not offered again.
    expect(withRoster.rosterCandidates.map(({ id }) => id)).toEqual(["u-faith", "u-otieno"]);
    expect(model.rosterCandidates).toEqual([]);
  });

  it("names a deleted or nameless account plainly", () => {
    const [mentor] = cohortMentorModel([role("r9", "gone", "MENTOR", null)], [], new Set()).mentors;
    expect(mentor).toMatchObject({ name: "Unknown user", email: null });
  });
});

describe("teachingRoles", () => {
  it("keeps instructors and TAs, not mentors", () => {
    expect(teachingRoles([{ name: "INSTRUCTOR" }, { name: "MENTOR" }, { name: "TA" }])).toEqual([{ name: "INSTRUCTOR" }, { name: "TA" }]);
  });
});

describe("cohortRoleRefusal", () => {
  it("refuses a MENTOR row while channels is off, and only then", () => {
    expect(cohortRoleRefusal("MENTOR", false)).toBe(MENTORS_OFF);
    expect(cohortRoleRefusal("MENTOR", true)).toBeNull();
    for (const teaching of ["INSTRUCTOR", "TA"]) {
      expect(cohortRoleRefusal(teaching, false)).toBeNull();
      expect(cohortRoleRefusal(teaching, true)).toBeNull();
    }
  });
});

describe("the admin cohort pages", () => {
  const page = (name: string) => readFileSync(new URL(`../../pages/admin/programs/${name}`, import.meta.url), "utf8");

  it("leave the cohort's roster out of the mentor picker's other groups (QA2-12)", () => {
    expect(page("[id].astro")).toContain("cohortMentorModel(prog.programRoles, people, new Set(mentorRows.map((row) => row.userId)), enrolledIds)");
  });

  it("write dates one way, day first with the month as a word, never the browser's locale (QA2-13)", () => {
    for (const name of ["index.astro", "[id].astro"]) expect(page(name)).not.toMatch(/toLocale(Date)?String\(/);
    expect(page("index.astro")).toContain("formatCalendarDate(date)");
    expect(page("[id].astro")).toContain("formatMomentDate(application.createdAt)");
  });
});
