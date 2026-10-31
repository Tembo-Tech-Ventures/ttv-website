import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { SPACE_ORDER, type Capabilities, type SpaceId } from "../contracts";
import { DEMO_PREFIX, isDemoUser } from "@/lib/staging-demo-policy";

export const COHORT_ACCESS_STATUSES = ["APPROVED", "AUDIT", "COMPLETED"] as const;
const cohortStatuses: ReadonlySet<string> = new Set(COHORT_ACCESS_STATUSES);
const cohortRoles: ReadonlySet<string> = new Set(["INSTRUCTOR", "TA", "MENTOR"]);

/** Authenticated identity only: roles and memberships always come from the DB. */
export type CapabilityUser = { id: string } | null | undefined;
export type PlatformCapabilities = Capabilities & { spaces: SpaceId[] };

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
    return { spaces: [], cohortIds: [], mentorCohortIds: [], isMentor: false, isInstitution: false, isAdmin: false };
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
  const mentorCohortIds = [...new Set(assignments
    .filter(({ name }) => name === "MENTOR")
    .map(({ programId }) => programId))].toSorted();
  const cohortIds = [...new Set([
    ...applications.flatMap(({ programId, status }) => programId && cohortStatuses.has(status) ? [programId] : []),
    ...assignments.filter(({ name }) => cohortRoles.has(name)).map(({ programId }) => programId),
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
    cohortIds, mentorCohortIds, isMentor, isInstitution, isAdmin,
  };
}
