import { describe, expect, it } from "vitest";
import type { ChannelAccessTarget, PlatformCapabilities } from "@/lib/platform/server/capabilities";
import { meetingAccessFor, type MeetingAccess } from "./access";
import type { MeetingPurpose } from "./rules";

/** Each role as capabilitiesFor returns it, for cohorts A and B. */
const nobody: PlatformCapabilities = { spaces: [], cohortIds: [], mentorCohortIds: [], teachingCohortIds: [], isMentor: false, isInstitution: false, isAdmin: false };
const signedIn: PlatformCapabilities = { ...nobody, spaces: ["community", "profile"] };
const inCohort = (programId: string): PlatformCapabilities => ({ ...signedIn, spaces: ["cohort", "community", "profile"], cohortIds: [programId] });
const ROLES = {
  "signed out": nobody,
  "community member": signedIn,
  "pending applicant": { ...signedIn, spaces: ["cohort", "community", "profile"] },
  "cohort A member (or alumna)": inCohort("cohort-a"),
  "cohort B member": inCohort("cohort-b"),
  "cohort A instructor or TA": { ...inCohort("cohort-a"), teachingCohortIds: ["cohort-a"] },
  "cohort A invited mentor": { ...inCohort("cohort-a"), mentorCohortIds: ["cohort-a"] },
  "global mentor": { ...signedIn, spaces: ["community", "mentoring", "profile"], isMentor: true },
  "institution": { ...signedIn, spaces: ["community", "discover", "profile"], isInstitution: true },
  "admin": { ...signedIn, spaces: ["cohort", "community", "mentoring", "discover", "admin", "profile"], isAdmin: true },
} satisfies Record<string, PlatformCapabilities>;
type Role = keyof typeof ROLES;

const cohortA: ChannelAccessTarget = { kind: "COHORT", programId: "cohort-a", postingPolicy: "ALL", archivedAt: null };
const community: ChannelAccessTarget = { kind: "COMMUNITY", programId: null, postingPolicy: "ALL", archivedAt: null };
const direct: ChannelAccessTarget = { kind: "DIRECT", programId: null, postingPolicy: "ALL", archivedAt: null };
const archived = (channel: ChannelAccessTarget) => ({ ...channel, archivedAt: 1 });

/** What a role gets: nothing, the call's details only, a seat, or hosting it. */
type Level = "none" | "see" | "join" | "host";
const level = ({ canSee, canJoin, canHost }: MeetingAccess): Level => canHost ? "host" : canJoin ? "join" : canSee ? "see" : "none";
const everyone = (value: Level) => Object.fromEntries(Object.keys(ROLES).map((role) => [role, value])) as Record<Role, Level>;

const session: Record<Role, Level> = {
  ...everyone("none"),
  "cohort A member (or alumna)": "join", "cohort A invited mentor": "join", "cohort A instructor or TA": "host", "admin": "host",
};
const event: Record<Role, Level> = { ...everyone("join"), "signed out": "none", "global mentor": "host", "admin": "host" };
const onlyWatch = (levels: Record<Role, Level>) =>
  Object.fromEntries(Object.entries(levels).map(([role, value]) => [role, value === "none" ? "none" : "see"])) as Record<Role, Level>;
const conversationMember: Record<Role, Level> = { ...everyone("host"), "signed out": "none" };

/** Every context a call can be in, and what each role gets there. */
const MATRIX: [string, MeetingPurpose, ChannelAccessTarget, boolean, Record<Role, Level>][] = [
  ["cohort A session", "SESSION", cohortA, false, session],
  ["cohort A session, channel archived", "SESSION", archived(cohortA), false, onlyWatch(session)],
  ["community event", "EVENT", community, false, event],
  ["community event, channel archived", "EVENT", archived(community), false, onlyWatch(event)],
  ...(["CALL", "CHECKIN"] as const).flatMap((purpose): typeof MATRIX => [
    [`${purpose} in a conversation, as one of its two members`, purpose, direct, true, conversationMember],
    [`${purpose} in a conversation the caller is not in`, purpose, direct, false, everyone("none")],
  ]),
  // A call in the wrong kind of channel admits nobody, whatever the channel would give.
  ["session in a community channel", "SESSION", community, false, everyone("none")],
  ["session in a conversation", "SESSION", direct, true, everyone("none")],
  ["event in a cohort channel", "EVENT", cohortA, false, everyone("none")],
  ["event in a conversation", "EVENT", direct, true, everyone("none")],
  ["call in a cohort channel", "CALL", cohortA, false, everyone("none")],
  ["check-in in a community channel", "CHECKIN", community, false, everyone("none")],
];

describe("meetingAccessFor", () => {
  it.each(MATRIX)("%s", (_, purpose, channel, isMember, expected) => {
    const actual = Object.fromEntries(Object.entries(ROLES).map(([role, capabilities]) =>
      [role, level(meetingAccessFor(capabilities, channel, purpose, { isMember }))]));
    expect(actual).toEqual(expected);
  });

  it("gives a global role nothing on its own: admins outside a conversation, mentors outside a cohort, institutions anywhere private", () => {
    for (const purpose of ["CALL", "CHECKIN"] as const) {
      expect(meetingAccessFor(ROLES.admin, direct, purpose)).toEqual({ canSee: false, canJoin: false, canHost: false });
    }
    expect(level(meetingAccessFor(ROLES["global mentor"], cohortA, "SESSION"))).toBe("none");
    expect(level(meetingAccessFor(ROLES.institution, cohortA, "SESSION"))).toBe("none");
    // Hosting a cohort's sessions is teaching it: an invited mentor moderates the channel but does not host.
    expect(level(meetingAccessFor(ROLES["cohort A invited mentor"], cohortA, "SESSION"))).toBe("join");
  });

  it("never hosts without a seat to take", () => {
    for (const [, purpose, channel, isMember] of MATRIX) {
      for (const capabilities of Object.values(ROLES)) {
        const access = meetingAccessFor(capabilities, channel, purpose, { isMember });
        expect(!access.canHost || access.canJoin).toBe(true);
        expect(!access.canJoin || access.canSee).toBe(true);
      }
    }
  });
});
