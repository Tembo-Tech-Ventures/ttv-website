import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";

export interface CompletionState {
  status: string;
  completedAt: Date | null;
}

export function isValidCompletion(
  completion: CompletionState | null | undefined
): completion is CompletionState & { status: "COMPLETED"; completedAt: Date } {
  return (
    completion?.status === "COMPLETED" &&
    completion.completedAt instanceof Date
  );
}

export async function hasCompletedCohort(
  db: Database,
  userId: string
): Promise<boolean> {
  const completed = await db.query.programApplication.findFirst({
    where: (pa, { and, eq: e, isNotNull }) =>
      and(
        e(pa.userId, userId),
        e(pa.status, "COMPLETED"),
        isNotNull(pa.completedAt)
      ),
    columns: { status: true, completedAt: true },
  });
  return isValidCompletion(completed);
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
    where: (pa, { and, eq: e, isNotNull }) =>
      and(
        e(pa.userId, userId),
        e(pa.status, "COMPLETED"),
        isNotNull(pa.completedAt)
      ),
    with: { program: true },
  });
  return applications
    .filter(isValidCompletion)
    .map((app) => ({
      application: app,
      program: app.program ?? null,
    }));
}
