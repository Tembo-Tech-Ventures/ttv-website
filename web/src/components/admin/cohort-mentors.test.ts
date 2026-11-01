import { describe, expect, it } from "vitest";
import { cohortMentorModel, teachingRoles, type CohortRoleRow } from "./cohort-mentors";

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
