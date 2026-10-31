import type { Database } from "@/lib/db/schema";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { DEMO_PREFIX, isDemoUser } from "@/lib/staging-demo-policy";

export { COHORT_ACCESS_STATUSES } from "@/lib/platform/server/capabilities";

export async function getAccessibleProgramIds(db: Database, userId: string) {
  return (await capabilitiesFor(db, { id: userId })).cohortIds;
}

export async function userCanAccessProgram(
  db: Database,
  userId: string,
  programId: string | null,
) {
  if (!programId || (isDemoUser(userId) && programId !== DEMO_PREFIX + "program")) return false;
  return (await capabilitiesFor(db, { id: userId })).cohortIds.includes(programId);
}
