import type { Capabilities, SpaceId } from "../contracts";

/** Synthetic, adapter-independent cases. Future REST/MCP/Tembo tests can reuse these. */
export interface CapabilityCase {
  name: string;
  signedIn?: boolean;
  globalRoles?: string[];
  applications?: { programId: string | null; status: "PENDING" | "REJECTED" | "APPROVED" | "AUDIT" | "COMPLETED" }[];
  assignments?: { programId: string; name: "INSTRUCTOR" | "TA" | "MENTOR" }[];
  expected: Capabilities & { spaces: SpaceId[] };
}

const member = { spaces: ["community", "profile"], cohortIds: [], mentorCohortIds: [], isMentor: false, isInstitution: false, isAdmin: false } satisfies CapabilityCase["expected"];
const cohort = { ...member, spaces: ["cohort", "community", "profile"], cohortIds: ["cohort-a"] } satisfies CapabilityCase["expected"];

export const CAPABILITY_ROLE_MATRIX: CapabilityCase[] = [
  { name: "unauthenticated", signedIn: false, expected: { ...member, spaces: [] } },
  { name: "community member", expected: member },
  { name: "pending applicant", applications: [{ programId: "cohort-a", status: "PENDING" }], expected: { ...cohort, cohortIds: [] } },
  { name: "rejected applicant", applications: [{ programId: "cohort-a", status: "REJECTED" }], expected: { ...cohort, cohortIds: [] } },
  { name: "applicant without cohort", applications: [{ programId: null, status: "PENDING" }], expected: { ...cohort, cohortIds: [] } },
  ...(["APPROVED", "AUDIT", "COMPLETED"] as const).map((status) => ({ name: status.toLowerCase(), applications: [{ programId: "cohort-a", status }], expected: cohort })),
  ...(["INSTRUCTOR", "TA"] as const).map((name) => ({ name, assignments: [{ programId: "cohort-a", name }], expected: cohort })),
  { name: "per-cohort mentor only", assignments: [{ programId: "cohort-a", name: "MENTOR" }], expected: { ...cohort, mentorCohortIds: ["cohort-a"] } },
  { name: "global mentor without assignment", globalRoles: ["MENTOR"], expected: { ...member, spaces: ["community", "mentoring", "profile"], isMentor: true } },
  { name: "institution", globalRoles: ["INSTITUTION"], expected: { ...member, spaces: ["community", "discover", "profile"], isInstitution: true } },
  { name: "admin", globalRoles: ["ADMIN"], expected: { ...member, spaces: ["cohort", "community", "discover", "admin", "profile"], cohortIds: [], isAdmin: true } },
  { name: "institution and cohort mentor", globalRoles: ["INSTITUTION"], assignments: [{ programId: "cohort-a", name: "MENTOR" }], expected: { ...cohort, spaces: ["cohort", "community", "discover", "profile"], mentorCohortIds: ["cohort-a"], isInstitution: true } },
  { name: "global mentor and approved student", globalRoles: ["MENTOR"], applications: [{ programId: "cohort-a", status: "APPROVED" }], expected: { ...cohort, spaces: ["cohort", "community", "mentoring", "profile"], isMentor: true } },
  { name: "multi-cohort roles deduplicated", applications: [{ programId: "cohort-a", status: "COMPLETED" }], assignments: [{ programId: "cohort-a", name: "TA" }, { programId: "cohort-a", name: "MENTOR" }, { programId: "cohort-b", name: "INSTRUCTOR" }], expected: { ...cohort, cohortIds: ["cohort-a", "cohort-b"], mentorCohortIds: ["cohort-a"] } },
  { name: "all global roles and cohort mentor", globalRoles: ["INSTITUTION", "ADMIN", "MENTOR"], assignments: [{ programId: "cohort-a", name: "MENTOR" }], expected: { spaces: ["cohort", "community", "mentoring", "discover", "admin", "profile"], cohortIds: ["cohort-a"], mentorCohortIds: ["cohort-a"], isMentor: true, isInstitution: true, isAdmin: true } },
  { name: "global staff labels do not grant cohort scope", globalRoles: ["INSTRUCTOR", "TA", "STAFF"], expected: member },
];
