import { CommunityError } from "@/lib/community/model";

/** Human decisions do not rewrite evidence or its revision, so confirmations remain attached. */
export async function reviewWork(
  db: D1Database,
  actorId: string,
  id: string,
  revision: number,
  decision: "keep" | "hide",
) {
  const admin = await db
    .prepare(
      `SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id=ur.roleId WHERE ur.userId=? AND r.name='ADMIN'`,
    )
    .bind(actorId)
    .first();
  if (!admin) throw new CommunityError("Admin access required.", 403);
  if (
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !["keep", "hide"].includes(decision)
  )
    throw new CommunityError("Choose a current work item and decision.");
  const result = await db
    .prepare(
      `UPDATE communityJourney SET moderationOutcome='pass',moderationReviewRequired=0,
    state=CASE WHEN ?='hide' THEN 'DRAFT' ELSE state END,moderationCheckedAt=unixepoch()
    WHERE id=? AND version=? AND moderationReviewRequired=1`,
    )
    .bind(decision, id, revision)
    .run();
  return result.meta.changes > 0;
}
