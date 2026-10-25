import { DEMO_PREFIX, isDemoUser } from "@/lib/staging-demo-policy";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";

type ProgramApplicationStatus =
  typeof schema.programApplication.$inferSelect.status;

export const COHORT_ACCESS_STATUSES = [
  "APPROVED",
  "AUDIT",
  "COMPLETED",
] as const satisfies readonly ProgramApplicationStatus[];

export async function getAccessibleProgramIds(db: Database, userId: string) {
  const applications: Array<{ programId: string | null }> =
    await db.query.programApplication.findMany({
      where: and(
        eq(schema.programApplication.userId, userId),
        isDemoUser(userId) ? eq(schema.programApplication.programId, DEMO_PREFIX + "program") : undefined,
        inArray(schema.programApplication.status, [...COHORT_ACCESS_STATUSES])
      ),
    });

  const staffRoles: Array<{ programId: string }> = await db.query.programRole.findMany({
    where: and(
      eq(schema.programRole.userId, userId),
      isDemoUser(userId) ? eq(schema.programRole.programId, DEMO_PREFIX + "program") : undefined,
      inArray(schema.programRole.name, ["INSTRUCTOR", "TA"])
    ),
  });

  return Array.from(
    new Set([
      ...applications
        .map((application) => application.programId)
        .filter((programId): programId is string => Boolean(programId)),
      ...staffRoles.map((role) => role.programId),
    ])
  );
}

export async function userCanAccessProgram(
  db: Database,
  userId: string,
  programId: string | null
) {
  if (!programId || (isDemoUser(userId) && programId !== DEMO_PREFIX + "program")) return false;

  const application = await db.query.programApplication.findFirst({
    where: and(
      eq(schema.programApplication.userId, userId),
        isDemoUser(userId) ? eq(schema.programApplication.programId, DEMO_PREFIX + "program") : undefined,
      eq(schema.programApplication.programId, programId),
      inArray(schema.programApplication.status, [...COHORT_ACCESS_STATUSES])
    ),
  });

  if (application) return true;

  const staffRole = await db.query.programRole.findFirst({
    where: and(
      eq(schema.programRole.userId, userId),
      isDemoUser(userId) ? eq(schema.programRole.programId, DEMO_PREFIX + "program") : undefined,
      eq(schema.programRole.programId, programId),
      inArray(schema.programRole.name, ["INSTRUCTOR", "TA"])
    ),
  });

  return Boolean(staffRole);
}
