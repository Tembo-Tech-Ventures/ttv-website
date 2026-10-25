import { retainedProbeMarker, RETAINED_READ_PROBE_CUTOFF, verifySameRunTarget, type StagingFixtureIdentity } from "../staging-fixtures";
import { isDemoUser } from "../staging-demo-policy";
import { CommunityError } from "./model";

export function authorizeRetainedProbe(method: string, path: string, scopes: readonly string[] | null, body: unknown) {
  if (!scopes?.includes("community:read") || !scopes.includes("institution:read")) throw new CommunityError("Read-scoped PAT required.",403);
  if (method === "GET" && (["access","profiles"].includes(path) || (path.split("/").length === 2 && path.startsWith("profiles/") && isDemoUser(path.slice(9))))) return;
  if (method === "POST" && path === "chat" && body && typeof body === "object" && !Array.isArray(body) && !Object.hasOwn(body,"rubric")) return;
  throw new CommunityError("Read-only synthetic probe endpoint required.",403);
}
/** CAS consumes failures/timeouts too. Keep the source session live for this request's tools. */
export async function claimRetainedChat(db: D1Database, environment: string | undefined, fixture: StagingFixtureIdentity) {
  if (!fixture.retainedReadProbe || fixture.persona !== "institution") throw new CommunityError("Institution probe required.",403);
  await verifySameRunTarget({db,envName:environment,actor:fixture,targetUserId:fixture.userId});
  const consumed = await db.prepare(`UPDATE "session" SET userAgent=?1 WHERE id=?2 AND userId=?3 AND userAgent=?4
    AND createdAt<=unixepoch() AND expiresAt>unixepoch() AND expiresAt<=createdAt+900 AND expiresAt<=?5
    AND EXISTS (SELECT 1 FROM stagingFixtureIdentity f JOIN "user" u ON u.id=f.userId
      WHERE f.userId=?3 AND f.sessionId=?2 AND f.runId=?6 AND f.persona='institution'
      AND f.expiresAt=?7 AND f.expiresAt>unixepoch() AND f.expiresAt="session".expiresAt
      AND u.email=?8 AND EXISTS (SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id=ur.roleId WHERE ur.userId=u.id AND r.name='INSTITUTION'))
    RETURNING id`).bind(retainedProbeMarker(fixture.runId,true),`${fixture.userId}-retained-read-probe-session`,fixture.userId,
      retainedProbeMarker(fixture.runId),RETAINED_READ_PROBE_CUTOFF,fixture.runId,fixture.expiresAt,`${fixture.userId}@invalid.ttv`).first();
  if (!consumed) throw new CommunityError("Synthetic chat attempt already consumed.",403);
}
