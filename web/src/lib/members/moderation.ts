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
      `UPDATE communityJourney SET moderationOutcome=CASE WHEN ?='hide' THEN 'hold' ELSE 'pass' END,moderationReviewRequired=0,
    state=CASE WHEN ?='hide' THEN 'DRAFT' WHEN moderatorHidden=1 THEN 'POSTED' ELSE state END,moderatorHidden=(?='hide'),moderationCheckedAt=unixepoch()
    WHERE id=? AND version=? AND (moderationReviewRequired=1 OR moderatorHidden=1)`,
    )
    .bind(decision, decision, decision, id, revision)
    .run();
  return result.meta.changes > 0;
}

/** Includes human-hidden work so only an admin can reverse that decision. */
export async function listWorkReviews(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT w.id,w.title,w.description,w.blurb,w.topics,w.version,w.moderationOutcome,
    coalesce(p.publicName,u.name) AS authorName FROM communityJourney w JOIN user u ON u.id=w.userId
    LEFT JOIN studentProfile p ON p.userId=w.userId
    WHERE w.moderationReviewRequired=1 OR w.moderatorHidden=1 ORDER BY w.updatedAt,w.id LIMIT 50`,
    )
    .all<{
      id: string;
      title: string;
      description: string;
      blurb: string | null;
      topics: string | null;
      version: number;
      moderationOutcome: string | null;
      authorName: string;
    }>();
  return results;
}
