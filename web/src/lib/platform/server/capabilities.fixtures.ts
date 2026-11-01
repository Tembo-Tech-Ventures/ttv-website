import type { ChannelAccess, ChannelAccessTarget, PlatformCapabilities } from "./capabilities";

/** Synthetic, adapter-independent cases. Future REST/MCP/Tembo tests can reuse these. */
export interface CapabilityCase {
  name: string;
  signedIn?: boolean;
  globalRoles?: string[];
  applications?: { programId: string | null; status: "PENDING" | "REJECTED" | "APPROVED" | "AUDIT" | "COMPLETED" }[];
  assignments?: { programId: string; name: "INSTRUCTOR" | "TA" | "MENTOR" }[];
  expected: PlatformCapabilities;
}

const member = { spaces: ["community", "profile"], cohortIds: [], mentorCohortIds: [], teachingCohortIds: [], isMentor: false, isInstitution: false, isAdmin: false } satisfies CapabilityCase["expected"];
const cohort = { ...member, spaces: ["cohort", "community", "profile"], cohortIds: ["cohort-a"] } satisfies CapabilityCase["expected"];

export const CAPABILITY_ROLE_MATRIX: CapabilityCase[] = [
  { name: "unauthenticated", signedIn: false, expected: { ...member, spaces: [] } },
  { name: "community member", expected: member },
  { name: "pending applicant", applications: [{ programId: "cohort-a", status: "PENDING" }], expected: { ...cohort, cohortIds: [] } },
  { name: "rejected applicant", applications: [{ programId: "cohort-a", status: "REJECTED" }], expected: { ...cohort, cohortIds: [] } },
  { name: "applicant without cohort", applications: [{ programId: null, status: "PENDING" }], expected: { ...cohort, cohortIds: [] } },
  ...(["APPROVED", "AUDIT", "COMPLETED"] as const).map((status) => ({ name: status.toLowerCase(), applications: [{ programId: "cohort-a", status }], expected: cohort })),
  ...(["INSTRUCTOR", "TA"] as const).map((name) => ({ name, assignments: [{ programId: "cohort-a", name }], expected: { ...cohort, teachingCohortIds: ["cohort-a"] } })),
  { name: "per-cohort mentor only", assignments: [{ programId: "cohort-a", name: "MENTOR" }], expected: { ...cohort, mentorCohortIds: ["cohort-a"] } },
  { name: "global mentor without assignment", globalRoles: ["MENTOR"], expected: { ...member, spaces: ["community", "mentoring", "profile"], isMentor: true } },
  { name: "institution", globalRoles: ["INSTITUTION"], expected: { ...member, spaces: ["community", "discover", "profile"], isInstitution: true } },
  { name: "admin", globalRoles: ["ADMIN"], expected: { ...member, spaces: ["cohort", "community", "discover", "admin", "profile"], cohortIds: [], isAdmin: true } },
  { name: "institution and cohort mentor", globalRoles: ["INSTITUTION"], assignments: [{ programId: "cohort-a", name: "MENTOR" }], expected: { ...cohort, spaces: ["cohort", "community", "discover", "profile"], mentorCohortIds: ["cohort-a"], isInstitution: true } },
  { name: "global mentor and approved student", globalRoles: ["MENTOR"], applications: [{ programId: "cohort-a", status: "APPROVED" }], expected: { ...cohort, spaces: ["cohort", "community", "mentoring", "profile"], isMentor: true } },
  { name: "multi-cohort roles deduplicated", applications: [{ programId: "cohort-a", status: "COMPLETED" }], assignments: [{ programId: "cohort-a", name: "TA" }, { programId: "cohort-a", name: "MENTOR" }, { programId: "cohort-b", name: "INSTRUCTOR" }], expected: { ...cohort, cohortIds: ["cohort-a", "cohort-b"], mentorCohortIds: ["cohort-a"], teachingCohortIds: ["cohort-a", "cohort-b"] } },
  { name: "all global roles and cohort mentor", globalRoles: ["INSTITUTION", "ADMIN", "MENTOR"], assignments: [{ programId: "cohort-a", name: "MENTOR" }], expected: { spaces: ["cohort", "community", "mentoring", "discover", "admin", "profile"], cohortIds: ["cohort-a"], mentorCohortIds: ["cohort-a"], teachingCohortIds: [], isMentor: true, isInstitution: true, isAdmin: true } },
  { name: "global staff labels do not grant cohort scope", globalRoles: ["INSTRUCTOR", "TA", "STAFF"], expected: member },
];

/** One channel of each shape the access rules tell apart. Cohort A is the persona's own cohort. */
export const CHANNEL_TARGETS = {
  community: { kind: "COMMUNITY", programId: null, postingPolicy: "ALL", archivedAt: null },
  communityArchived: { kind: "COMMUNITY", programId: null, postingPolicy: "ALL", archivedAt: 1 },
  communityStaff: { kind: "COMMUNITY", programId: null, postingPolicy: "STAFF", archivedAt: null },
  cohortA: { kind: "COHORT", programId: "cohort-a", postingPolicy: "ALL", archivedAt: null },
  cohortAAnnouncements: { kind: "COHORT", programId: "cohort-a", postingPolicy: "STAFF", archivedAt: null },
  cohortAArchived: { kind: "COHORT", programId: "cohort-a", postingPolicy: "ALL", archivedAt: 1 },
  cohortB: { kind: "COHORT", programId: "cohort-b", postingPolicy: "ALL", archivedAt: null },
  cohortBAnnouncements: { kind: "COHORT", programId: "cohort-b", postingPolicy: "STAFF", archivedAt: null },
  directMember: { kind: "DIRECT", programId: null, postingPolicy: "ALL", archivedAt: null },
  directOther: { kind: "DIRECT", programId: null, postingPolicy: "ALL", archivedAt: null },
} as const satisfies Record<string, ChannelAccessTarget>;
export type ChannelTarget = keyof typeof CHANNEL_TARGETS;
/** The caller has an explicit channel_member row only for directMember. */
export const MEMBER_OF: ReadonlySet<ChannelTarget> = new Set(["directMember"]);

/** Access as letters: r read, p post, m moderate, c share a session clip. "" is no access at all. */
export type AccessLetters = "" | "r" | "rm" | "rp" | "rpm" | "rpc" | "rpmc";
export function accessFromLetters(letters: AccessLetters): ChannelAccess {
  return { canRead: letters.includes("r"), canPost: letters.includes("p"), canModerate: letters.includes("m"), canShareSessionClip: letters.includes("c") };
}

const none: Record<ChannelTarget, AccessLetters> = {
  community: "", communityArchived: "", communityStaff: "", cohortA: "", cohortAAnnouncements: "", cohortAArchived: "",
  cohortB: "", cohortBAnnouncements: "", directMember: "", directOther: "",
};
const memberChannels = { ...none, community: "rp", communityArchived: "r", communityStaff: "r", directMember: "rp" } satisfies typeof none;
const studentA = { ...memberChannels, cohortA: "rpc", cohortAAnnouncements: "r", cohortAArchived: "r" } satisfies typeof none;
const teachesA = { ...memberChannels, cohortA: "rpmc", cohortAAnnouncements: "rpmc", cohortAArchived: "rm" } satisfies typeof none;
const mentorsA = { ...memberChannels, cohortA: "rpmc", cohortAAnnouncements: "rm", cohortAArchived: "rm" } satisfies typeof none;
const communityModerator = { community: "rpm", communityArchived: "rm", communityStaff: "rm" } satisfies Partial<typeof none>;
const admin = {
  ...teachesA, community: "rpm", communityArchived: "rm", communityStaff: "rpm", cohortB: "rpmc", cohortBAnnouncements: "rpmc",
} satisfies typeof none;

/** Channel access for each CAPABILITY_ROLE_MATRIX case, by name. */
const CHANNELS_BY_CASE: Record<string, Record<ChannelTarget, AccessLetters>> = {
  unauthenticated: none,
  "community member": memberChannels,
  "pending applicant": memberChannels,
  "rejected applicant": memberChannels,
  "applicant without cohort": memberChannels,
  approved: studentA,
  audit: studentA,
  // An alumna: the cohort has ended and its channels stay open to her.
  completed: studentA,
  INSTRUCTOR: teachesA,
  TA: teachesA,
  "per-cohort mentor only": mentorsA,
  "global mentor without assignment": { ...memberChannels, ...communityModerator },
  institution: memberChannels,
  admin,
  "institution and cohort mentor": mentorsA,
  // A global mentor moderates community channels, not the cohort they study in.
  "global mentor and approved student": { ...studentA, ...communityModerator },
  "multi-cohort roles deduplicated": { ...teachesA, cohortB: "rpmc", cohortBAnnouncements: "rpmc" },
  "all global roles and cohort mentor": admin,
  "global staff labels do not grant cohort scope": memberChannels,
};

/**
 * Channel access for every CAPABILITY_ROLE_MATRIX case, plus a mentor of another cohort.
 * Owner decisions 2026-10-31: cohort channels stay open to alumni; mentors join per cohort;
 * community channels are open to every signed-in person, institutions included.
 */
export const CHANNEL_ACCESS_MATRIX: (Omit<CapabilityCase, "expected"> & { channels: Record<ChannelTarget, AccessLetters> })[] = [
  ...CAPABILITY_ROLE_MATRIX.map(({ expected: _expected, ...input }) => {
    const channels = CHANNELS_BY_CASE[input.name];
    if (!channels) throw new Error(`No channel access expectation for "${input.name}"`);
    return { ...input, channels };
  }),
  { name: "mentor of another cohort", assignments: [{ programId: "cohort-b", name: "MENTOR" }],
    channels: { ...memberChannels, cohortB: "rpmc", cohortBAnnouncements: "rm" } },
];
