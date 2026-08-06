import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";

export async function hasCompletedCohort(
  db: Database,
  userId: string
): Promise<boolean> {
  const row = await db.query.programApplication.findFirst({
    where: eq(schema.programApplication.userId, userId),
    columns: { id: true, status: true },
  });
  if (!row) return false;

  const completed = await db.query.programApplication.findFirst({
    where: (pa, { and, eq: e }) =>
      and(e(pa.userId, userId), e(pa.status, "COMPLETED")),
    columns: { id: true },
  });
  return completed !== undefined;
}

export async function getCompletedCohorts(
  db: Database,
  userId: string
): Promise<
  Array<{
    application: typeof schema.programApplication.$inferSelect;
    program: typeof schema.program.$inferSelect | null;
  }>
> {
  const applications = await db.query.programApplication.findMany({
    where: (pa, { and, eq: e }) =>
      and(e(pa.userId, userId), e(pa.status, "COMPLETED")),
    with: { program: true },
  });
  return applications.map((app) => ({
    application: app,
    program: app.program ?? null,
  }));
}
