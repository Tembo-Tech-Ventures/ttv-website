import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import {
  SPACE_ORDER, type Capabilities, type ChannelCapabilities, type ChannelKind, type PostingPolicy, type SpaceId,
} from "../contracts";
import { DEMO_PREFIX, isDemoUser } from "@/lib/staging-demo-policy";

export const COHORT_ACCESS_STATUSES = ["APPROVED", "AUDIT", "COMPLETED"] as const;
const cohortStatuses: ReadonlySet<string> = new Set(COHORT_ACCESS_STATUSES);
const cohortRoles: ReadonlySet<string> = new Set(["INSTRUCTOR", "TA", "MENTOR"]);
const teachingRoles: ReadonlySet<string> = new Set(["INSTRUCTOR", "TA"]);

/** Authenticated identity only: roles and memberships always come from the DB. */
export type CapabilityUser = { id: string } | null | undefined;
/**
 * teachingCohortIds (INSTRUCTOR/TA assignments) is server-only: it decides channel posting and
 * moderation, and is not part of the serialized Capabilities in Me.
 */
export type PlatformCapabilities = Capabilities & { spaces: SpaceId[]; teachingCohortIds: string[] };

/**
 * Canonical platform scope. cohortIds are readable cohorts, not applications.
 * An applicant can enter the cohort space without receiving private content.
 * Admin authority is explicit in isAdmin; cohortIds never invent memberships.
 * Channel-specific membership/posting rules belong to the channel adapter.
 * No cross-request cache: revoked assignments must take effect immediately.
 */
export async function capabilitiesFor(
  db: Database,
  user: CapabilityUser,
): Promise<PlatformCapabilities> {
  if (!user?.id) {
    return { spaces: [], cohortIds: [], mentorCohortIds: [], teachingCohortIds: [], isMentor: false, isInstitution: false, isAdmin: false };
  }

  const demoProgramId = isDemoUser(user.id) ? DEMO_PREFIX + "program" : undefined;
  const [globalRoles, applications, assignments] = await Promise.all([
    db.query.userRole.findMany({
      where: eq(schema.userRole.userId, user.id),
      columns: { id: true },
      with: { role: { columns: { name: true } } },
    }),
    db.query.programApplication.findMany({
      where: and(
        eq(schema.programApplication.userId, user.id),
        demoProgramId ? eq(schema.programApplication.programId, demoProgramId) : undefined,
      ),
      columns: { programId: true, status: true },
    }),
    db.query.programRole.findMany({
      where: and(
        eq(schema.programRole.userId, user.id),
        demoProgramId ? eq(schema.programRole.programId, demoProgramId) : undefined,
      ),
      columns: { programId: true, name: true },
    }),
  ]);

  const roles = new Set(globalRoles.map(({ role }) => role.name));
  const isAdmin = roles.has("ADMIN");
  // A cohort invitation does not confer the global community mentor role.
  const isMentor = roles.has("MENTOR");
  const isInstitution = roles.has("INSTITUTION");
  const assigned = (names: ReadonlySet<string>) => [...new Set(assignments
    .filter(({ name }) => names.has(name))
    .map(({ programId }) => programId))].toSorted();
  const mentorCohortIds = assigned(new Set(["MENTOR"]));
  const teachingCohortIds = assigned(teachingRoles);
  const cohortIds = [...new Set([
    ...applications.flatMap(({ programId, status }) => programId && cohortStatuses.has(status) ? [programId] : []),
    ...assigned(cohortRoles),
  ])].toSorted();

  const available: Record<SpaceId, boolean> = {
    cohort: isAdmin || applications.length > 0 || cohortIds.length > 0,
    community: true,
    mentoring: isMentor,
    discover: isInstitution || isAdmin,
    admin: isAdmin,
    profile: true,
  };
  return {
    spaces: SPACE_ORDER.filter((space) => available[space]),
    cohortIds, mentorCohortIds, teachingCohortIds, isMentor, isInstitution, isAdmin,
  };
}

/** The channel facts access depends on. Slugs, names and topics never grant anything. */
export interface ChannelAccessTarget {
  kind: ChannelKind;
  programId: string | null;
  postingPolicy: PostingPolicy;
  archivedAt: number | null;
}
export type ChannelAccess = ChannelCapabilities & { canRead: boolean };

const NO_CHANNEL_ACCESS: ChannelAccess = Object.freeze({ canRead: false, canPost: false, canModerate: false, canShareSessionClip: false });

/**
 * Channel read, post and moderation rules over capabilitiesFor's result (plan §0, §3; README in
 * src/lib/channels). Every channel surface (pages, REST, search, Tembo) decides through this one
 * function. Pass isMember only for an explicit channel_member row of this caller.
 *
 * - COMMUNITY: every signed-in person reads and posts, institutions included. Admins and global
 *   mentors moderate.
 * - COHORT: that program's members (APPROVED, AUDIT, COMPLETED: alumni keep posting after the
 *   cohort ends), its instructors, TAs and invited mentors, and admins. Its instructors, TAs and
 *   mentors moderate, as do admins.
 * - DIRECT: explicit members only, admins included; nobody moderates in place (Phase 4).
 * - postingPolicy STAFF: only admins, and the program's instructors and TAs on a cohort channel.
 * - Archived channels stay readable and take no new posts.
 * - A session clip is shared only where every reader can see the recording: a cohort channel the
 *   caller may post in.
 */
export function channelAccessFor(
  capabilities: PlatformCapabilities,
  channel: ChannelAccessTarget,
  { isMember = false }: { isMember?: boolean } = {},
): ChannelAccess {
  // The community space is every signed-in person's, so its absence means signed out.
  if (!capabilities.spaces.includes("community")) return NO_CHANNEL_ACCESS;
  const { reads, moderates, staff } = channelRoles(capabilities, channel, isMember);
  if (!reads) return NO_CHANNEL_ACCESS;
  const canPost = channel.archivedAt === null && (channel.postingPolicy === "ALL" || staff);
  return { canRead: true, canPost, canModerate: moderates, canShareSessionClip: channel.kind === "COHORT" && canPost };
}

/** Who reads and moderates each kind of channel, and who counts as its staff for STAFF posting. */
function channelRoles(capabilities: PlatformCapabilities, channel: ChannelAccessTarget, isMember: boolean) {
  const { isAdmin } = capabilities;
  switch (channel.kind) {
    case "COMMUNITY":
      return { reads: true, moderates: isAdmin || capabilities.isMentor, staff: isAdmin };
    case "DIRECT":
      return { reads: isMember, moderates: false, staff: isAdmin };
    case "COHORT": {
      const program = channel.programId;
      if (program === null) return { reads: false, moderates: false, staff: false };
      const teaches = capabilities.teachingCohortIds.includes(program);
      return {
        reads: isAdmin || capabilities.cohortIds.includes(program),
        moderates: isAdmin || teaches || capabilities.mentorCohortIds.includes(program),
        staff: isAdmin || teaches,
      };
    }
  }
}
