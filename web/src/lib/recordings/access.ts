import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";

export async function getAccessibleProgramIds(db: Database, userId: string) {
  const applications: Array<{ programId: string | null }> =
    await db.query.programApplication.findMany({
      where: and(
        eq(schema.programApplication.userId, userId),
        inArray(schema.programApplication.status, ["APPROVED", "COMPLETED"])
      ),
    });

  const staffRoles: Array<{ programId: string }> = await db.query.programRole.findMany({
    where: and(
      eq(schema.programRole.userId, userId),
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
  if (!programId) return false;

  const application = await db.query.programApplication.findFirst({
    where: and(
      eq(schema.programApplication.userId, userId),
      eq(schema.programApplication.programId, programId),
      inArray(schema.programApplication.status, ["APPROVED", "COMPLETED"])
    ),
  });

  if (application) return true;

  const staffRole = await db.query.programRole.findFirst({
    where: and(
      eq(schema.programRole.userId, userId),
      eq(schema.programRole.programId, programId),
      inArray(schema.programRole.name, ["INSTRUCTOR", "TA"])
    ),
  });

  return Boolean(staffRole);
}
