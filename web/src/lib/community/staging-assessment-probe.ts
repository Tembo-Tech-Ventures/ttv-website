import { verifySameRunTarget, type StagingFixtureIdentity } from "../staging-fixtures";
import { CommunityError } from "./model";

/** Only server-resolved fixture identity may select this stricter provider mode. */
export function stagingAssessmentProbe(db: D1Database, environment: string | undefined,
  actor: { id: string; fixture?: StagingFixtureIdentity | null }) {
  const fixture = actor.fixture;
  if (!fixture) {
    if (actor.id.startsWith("ttv-staging-fixture-")) throw new CommunityError("Verified staging fixture required.", 403);
    return undefined;
  }
  if (environment !== "staging" || fixture.userId !== actor.id) {
    throw new CommunityError("Synthetic assessment requires a staging institution fixture.", 403);
  }
  if (!fixture.assessmentProbe) return undefined;
  if (fixture.persona !== "institution") throw new CommunityError("Synthetic assessment requires a staging institution fixture.", 403);
  return {
    async claim() {
      // Recheck the live identity immediately before consuming its one-shot session.
      // Normal source authorization has already completed before provider.complete.
      await verifySameRunTarget({ db, envName: environment, actor: fixture, targetUserId: actor.id });
      const consumed = await db.prepare(`DELETE FROM "session" WHERE "userId"=?1
        AND "userAgent"=?4 AND "expiresAt">unixepoch() AND "createdAt"<=unixepoch() AND "id" IN (
        SELECT "sessionId" FROM "stagingFixtureIdentity"
        WHERE "userId"=?1 AND "runId"=?2 AND "sessionId"=?3 AND "persona"='institution' AND "expiresAt">unixepoch()
        AND "expiresAt"=?5 AND "expiresAt"<="session"."createdAt"+3600
        AND EXISTS (SELECT 1 FROM "user" u WHERE u.id=?1 AND u.email=?6)
        AND EXISTS (SELECT 1 FROM "UserRoles" ur JOIN "Roles" r ON r.id=ur.roleId
          WHERE ur.userId=?1 AND r.name='INSTITUTION')
      ) RETURNING "id"`).bind(actor.id, fixture.runId, `${actor.id}-assessment-session`,
        `ttv-agent:synthetic-staging:${fixture.runId}`, fixture.expiresAt, `${actor.id}@invalid.ttv`).first<{ id: string }>();
      if (!consumed) throw new CommunityError("Synthetic assessment attempt already consumed.", 403);
      // Deleting the source session also makes subsequent PAT requests fail the
      // existing live fixture-identity resolver. Never restore it after failures.
    },
  };
}
