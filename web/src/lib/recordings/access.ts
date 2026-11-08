import type { Database } from "@/lib/db/schema";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { DEMO_PREFIX, isDemoUser } from "@/lib/staging-demo-policy";

export { COHORT_ACCESS_STATUSES } from "@/lib/platform/server/capabilities";

export async function getAccessibleProgramIds(db: Database, userId: string) {
  return (await capabilitiesFor(db, { id: userId })).cohortIds;
}

/** Whether a cohort's recordings are open to this person, given the cohorts their capabilities hold. */
export function programAccessible(cohortIds: readonly string[], userId: string, programId: string | null) {
  if (!programId || (isDemoUser(userId) && programId !== DEMO_PREFIX + "program")) return false;
  return cohortIds.includes(programId);
}

export async function userCanAccessProgram(
  db: Database,
  userId: string,
  programId: string | null,
) {
  // Refused before any read where even holding the cohort would not grant it.
  if (!programId || !programAccessible([programId], userId, programId)) return false;
  return programAccessible((await capabilitiesFor(db, { id: userId })).cohortIds, userId, programId);
}
