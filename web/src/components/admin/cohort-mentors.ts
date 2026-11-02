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
  /**
   * People on this cohort's own roster (any application to it), offered last and under their own
   * label (QA2-12): a mentor reads and moderates their classmates' messages, so it is never a slip.
   */
  rosterCandidates: CohortPerson[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en");

export function cohortMentorModel(
  roles: readonly CohortRoleRow[],
  people: readonly CohortPerson[],
  approvedMentorIds: ReadonlySet<string>,
  rosterIds: ReadonlySet<string> = new Set(),
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
  const outside = candidates.filter((person) => !rosterIds.has(person.id));
  return {
    mentors,
    approvedCandidates: outside.filter((person) => approvedMentorIds.has(person.id)),
    otherCandidates: outside.filter((person) => !approvedMentorIds.has(person.id)),
    rosterCandidates: candidates.filter((person) => rosterIds.has(person.id)),
  };
}

/** The cohort's teaching staff: instructors and TAs. Mentors have their own section. */
export function teachingRoles<Row extends { name: string }>(roles: readonly Row[]): Row[] {
  return roles.filter((role) => role.name !== "MENTOR");
}

export const MENTORS_OFF = "Cohort mentors arrive with channels, which are off for you.";

/**
 * Why a cohort role can't be added here, or null. A MENTOR row opens a cohort's channels, so it
 * can be added only while `channels` is on for this administrator; the form never offers it
 * otherwise, and a forged post is refused before anything is written.
 */
export function cohortRoleRefusal(role: string, mentorsEnabled: boolean): string | null {
  return role === "MENTOR" && !mentorsEnabled ? MENTORS_OFF : null;
}
