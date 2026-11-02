/*
 * Who mentors a cohort, and who could (U-2.4). A cohort mentor is a programRole MENTOR row: it
 * opens that cohort's recordings and channels to them, and lets them hide messages there for an
 * administrator to review (capabilitiesFor, channelAccessFor). It does not grant the community-wide
 * mentor role, which comes from an approved access request.
 */

export interface CohortRoleRow {
  id: string;
  userId: string;
  name: string;
  user: { name: string; email: string } | null;
}

export interface CohortPerson { id: string; name: string; email: string }

export interface CohortMentor { roleId: string; userId: string; name: string; email: string | null; approvedMentor: boolean }

export interface CohortMentorModel {
  mentors: CohortMentor[];
  /** People with community-wide mentor access, offered first. */
  approvedCandidates: CohortPerson[];
  otherCandidates: CohortPerson[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en");

export function cohortMentorModel(
  roles: readonly CohortRoleRow[],
  people: readonly CohortPerson[],
  approvedMentorIds: ReadonlySet<string>,
): CohortMentorModel {
  const mentors = roles
    .filter((role) => role.name === "MENTOR")
    .map((role) => ({
      roleId: role.id,
      userId: role.userId,
      name: role.user?.name.trim() || "Unknown user",
      email: role.user?.email ?? null,
      approvedMentor: approvedMentorIds.has(role.userId),
    }))
    .toSorted(byName);
  const taken = new Set(mentors.map((mentor) => mentor.userId));
  const candidates = people.filter((person) => !taken.has(person.id)).toSorted(byName);
  return {
    mentors,
    approvedCandidates: candidates.filter((person) => approvedMentorIds.has(person.id)),
    otherCandidates: candidates.filter((person) => !approvedMentorIds.has(person.id)),
  };
}

/** The cohort's teaching staff: instructors and TAs. Mentors have their own section. */
export function teachingRoles<Row extends { name: string }>(roles: readonly Row[]): Row[] {
  return roles.filter((role) => role.name !== "MENTOR");
}
