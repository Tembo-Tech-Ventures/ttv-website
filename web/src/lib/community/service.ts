import { saveMemberText, checkPostedWork, type MemberModerationEnv } from "@/lib/members/writes";
import { WORTH_ANOTHER_LOOK_LIMIT } from "@/lib/platform/contracts";
import { DEMO_PREFIX, DEMO_USER_IDS, isDemoUser } from "@/lib/staging-demo-policy";
import { verifySameRunTarget, verifyRetainedProbeTarget, retainedProbeScope, StagingFixtureAccessError, type StagingFixtureIdentity } from "@/lib/staging-fixtures";
import { createId } from "@paralleldrive/cuid2";
import { workConfirmedAttention } from "@/lib/attention/producers";
import { grantCommunityRole, revokeCommunityRole } from "@/lib/onboarding/decisions";
import { AccessRole } from "@/lib/platform/contracts";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { requestScopeActive } from "@/lib/platform/server/request-scope";
import { discoverableMember, postedWorkEligibility } from "./eligibility";
import {
  CommunityError, profileInput, journeyInput, journeyUpdateInput, journeyStatusInput, confirmationInput, setAsideInput, searchInput, parseInput,
  type CommunityProfile, type CommunityJourney, type CommunityConfirmation,
} from "./model";

interface ProfileRow {
  userId: string; name: string; image: string | null; headline: string | null;
  bio: string | null; skills: string | null; opportunityGoals: string | null;
  moderationHold?:number;
  version: number | null; updatedAt: number | null;
}
function profile(row: ProfileRow): CommunityProfile {
  let skills: string[] = [];
  try { const value: unknown = JSON.parse(row.skills ?? "[]"); if (Array.isArray(value)) skills = value.filter((s): s is string => typeof s === "string"); } catch { /* Older malformed rows have no skills. */ }
  return { moderationHold:Boolean(row.moderationHold), userId: row.userId, name: row.name, image: row.image, headline: row.headline ?? "", bio: row.bio ?? "", skills,
    opportunityGoals: row.opportunityGoals ?? "", version: row.version ?? 0, updatedAt: row.updatedAt };
}
/** How many shared contributions the Confirm page lists, newest first. */
const MENTORSHIP_WINDOW = 50;
const PROFILE_SELECT = `SELECT u.id AS userId,coalesce(p.publicName,u.name) AS name,p.publicAvatarUrl AS image,p.headline,p.bio,p.skills,p.opportunityGoals,p.contentVersion AS version,p.updatedAt,coalesce(p.moderationOutcome='hold',0) AS moderationHold
  FROM user u LEFT JOIN studentProfile p ON p.userId=u.id`;

export function createCommunityService(db: D1Database, actorId: string, fixture?: StagingFixtureIdentity | null, environment?: string, flagsOverride?: string, moderationEnv?: MemberModerationEnv) {
  if (!actorId) throw new CommunityError("Sign in to continue.", 401);
  if (!fixture && actorId.startsWith("ttv-staging-fixture-")) throw new CommunityError("Verified staging fixture context required.",403);
  if (fixture && fixture.userId !== actorId) throw new CommunityError("Synthetic staging identity mismatch.",403);
  const demo = actorId.startsWith(DEMO_PREFIX);
  if (demo && (environment !== "staging" || !isDemoUser(actorId))) throw new CommunityError("Verified demo identity required.",403);
  async function requireFixtureTarget(targetUserId: string) {
    if (demo && !isDemoUser(targetUserId)) throw new CommunityError("Demo records only.",403);
    if (!fixture) return;
    try { await (fixture.retainedReadProbe ? verifyRetainedProbeTarget : verifySameRunTarget)({db,envName:environment,actor:fixture,targetUserId}); }
    catch (error) {
      if (error instanceof StagingFixtureAccessError) throw new CommunityError(error.message,403);
      throw error;
    }
  }
  // The column expression is an internal constant, never request input.
  function fixtureScope(column: string) {
    if (fixture?.retainedReadProbe) return retainedProbeScope(column);
    if (demo) return { clause: ` AND ${column} IN (SELECT value FROM json_each(?))`, values: [JSON.stringify(DEMO_USER_IDS)] };
    return fixture ? {
      clause:` AND EXISTS (SELECT 1 FROM stagingFixtureIdentity fixture_identity WHERE fixture_identity.userId=${column} AND fixture_identity.runId=? AND fixture_identity.expiresAt>unixepoch())`,
      values:[fixture.runId],
    } : {clause:"",values:[]};
  }
  function requireWritable() { if (fixture?.retainedReadProbe) throw new CommunityError("Read-only synthetic probe.",403); }
  async function access() {
    await requireFixtureTarget(actorId);
    // A read-only request takes the roles from the capabilities its helpers share (request-scope.ts);
    // any other reads them itself, so a handler that changes roles reads them back.
    if (requestScopeActive()) {
      const { isAdmin, isMentor, isInstitution } = await capabilitiesFor(drizzle(db, { schema }), { id: actorId });
      return { isAdmin, isMentor, isInstitution };
    }
    const { results } = await db.prepare(`SELECT r.name FROM "Roles" r JOIN "UserRoles" ur ON ur.roleId=r.id WHERE ur.userId=?`).bind(actorId).all<{ name: string }>();
    const roles = new Set(results.map((r) => r.name));
    return { isAdmin: roles.has("ADMIN"), isMentor: roles.has("MENTOR"), isInstitution: roles.has("INSTITUTION") };
  }
  async function requireInstitution() {
    const a = await access();
    if (!a.isInstitution && !a.isAdmin) throw new CommunityError("Approved institutional access is required.", 403);
    return { id: actorId, isAdmin: a.isAdmin };
  }
  // Someone outside discovery reads exactly like someone who does not exist.
  async function requireProfileAccess(target: string) {
    await requireFixtureTarget(target);
    if (target === actorId) return;
    // The institution's eligibility read starts beside the role check rather than after it. It decides
    // nothing on its own: a caller without institutional access is refused whatever it finds, and staff
    // keep their reach, so for an admin its answer is unused.
    const eligible = discoverableMember("u.id", { id: actorId, isAdmin: false });
    const [caller, row] = await Promise.all([
      access(),
      db.prepare(`SELECT 1 AS found FROM user u WHERE u.id=? AND ${eligible.clause}`).bind(target, ...eligible.values).first(),
    ]);
    // Staff keep their reach: an admin may open any account, as before.
    if (caller.isAdmin) return;
    if (!row) throw new CommunityError("Profile not found.", 404);
  }
  // Profiles and journeys are read beside their access check rather than after it, and nothing is returned
  // unless the check passes: a refused check rejects the whole read and its rows are discarded. The reads
  // never reject on their own account, so a missing person is said only after the check passes: a refused
  // caller learns nothing, not even whether the account exists.
  function readProfileRow(target: string) {
    return db.prepare(`${PROFILE_SELECT} WHERE u.id=?`).bind(target).first<ProfileRow>();
  }
  function profileOrMissing(row: ProfileRow | null): CommunityProfile {
    if (!row) throw new CommunityError("Profile not found.", 404);
    return profile(row);
  }
  async function readJourney(target: string): Promise<CommunityJourney[]> {
    const mentorScope = fixtureScope("c.mentorId");
    // The confirmations are read beside the entries rather than after them: one round trip, not two.
    const [{ results }, { results: confirmations }] = await Promise.all([
      db.prepare(`SELECT id,userId,title,description,evidenceUrl,occurredAt,lower(state) AS status,coalesce(moderationOutcome='hold',0) AS moderationHold,version,createdAt,updatedAt FROM communityJourney j
        WHERE userId=? AND (?=userId OR ${postedWorkEligibility("j")}) ORDER BY occurredAt DESC,id DESC LIMIT 100`).bind(target, actorId).all<Omit<CommunityJourney, "confirmations">>(),
      db.prepare(`SELECT c.id,c.journeyId,c.mentorId,u.name AS mentorName,c.statement,c.method,c.journeyVersion,c.mentorRole,c.createdAt
        FROM communityConfirmation c JOIN communityJourney j ON j.id=c.journeyId JOIN user u ON u.id=c.mentorId
        WHERE j.userId=? AND (?=j.userId OR ${postedWorkEligibility("j")})${mentorScope.clause} ORDER BY c.createdAt DESC LIMIT 500`).bind(target, actorId,...mentorScope.values).all<CommunityConfirmation>(),
    ]);
    return results.map((entry) => ({ ...entry, moderationHold:Boolean(entry.moderationHold), confirmations: confirmations.filter((c) => c.journeyId === entry.id) }));
  }
  async function getProfile(target: string): Promise<CommunityProfile> {
    const [, row] = await Promise.all([requireProfileAccess(target), readProfileRow(target)]);
    return profileOrMissing(row);
  }
  async function listJourney(target = actorId): Promise<CommunityJourney[]> {
    const [, entries] = await Promise.all([requireProfileAccess(target), readJourney(target)]);
    return entries;
  }
  /** A profile with its journey, as GET profiles/:id answers: one access check for both. */
  async function getProfileWithJourney(target: string): Promise<{ profile: CommunityProfile; entries: CommunityJourney[] }> {
    const [, row, entries] = await Promise.all([requireProfileAccess(target), readProfileRow(target), readJourney(target)]);
    return { profile: profileOrMissing(row), entries };
  }
  /**
   * The Confirm page's rows: the 50 newest contributions shared beyond their
   * author, never the mentor's own. One query for the list and its count, so
   * they cannot drift apart. `columns` is an internal constant, never input.
   * Set-asides are read for this mentor and the current revision only: they
   * are private to the mentor and nothing else reads them.
   */
  async function mentorshipRows<Row extends { userId: string }>(columns: string) {
    await requireMentorReview();
    const window = confirmWindow();
    const { results } = await db.prepare(`SELECT ${columns},
        EXISTS (SELECT 1 FROM communityConfirmation ownReview WHERE ownReview.journeyId=j.id AND ownReview.mentorId=? AND ownReview.journeyVersion=j.version) AS reviewedByCurrentMentor,
        EXISTS (SELECT 1 FROM communitySetAside ownSetAside WHERE ownSetAside.mentorId=? AND ownSetAside.journeyId=j.id AND ownSetAside.journeyVersion=j.version) AS setAsideByCurrentMentor
      FROM communityJourney j JOIN user u ON u.id=j.userId WHERE j.id IN (${window.sql}) ORDER BY j.createdAt DESC,j.id DESC`)
      .bind(actorId,actorId,...window.values).all<Row & { reviewedByCurrentMentor: number; setAsideByCurrentMentor: number }>();
    await Promise.all(results.map(row=>requireFixtureTarget(row.userId)));
    return results.map(row => ({...row,reviewedByCurrentMentor:Boolean(row.reviewedByCurrentMentor),setAsideByCurrentMentor:Boolean(row.setAsideByCurrentMentor)}));
  }
  /**
   * The Confirm page's window, as SQL: the ids of the MENTORSHIP_WINDOW newest contributions shared
   * beyond their author, never the mentor's own, with the values it binds. Everything that sends a
   * mentor to the Confirm page reads through it, so nothing points at work the page cannot show.
   */
  function confirmWindow() {
    const scope = fixtureScope("w.userId");
    return {
      sql: `SELECT w.id FROM communityJourney w WHERE ${postedWorkEligibility("w")} AND w.userId<>?${scope.clause}
        ORDER BY w.createdAt DESC,w.id DESC LIMIT ${MENTORSHIP_WINDOW}`,
      values: [actorId, ...scope.values],
    };
  }
  async function requireMentorReview() {
    const a = await access();
    if (!a.isMentor && !a.isAdmin) throw new CommunityError("Mentor access is required.", 403);
    return a;
  }
  return {
    access, getProfile, listJourney, getProfileWithJourney,
    getOwnProfile: () => getProfile(actorId),
    async updateOwnProfile(input: unknown) {
      requireWritable();
      await requireFixtureTarget(actorId);
      const p = parseInput(profileInput, input);
      await saveMemberText(db, actorId, p, moderationEnv);
      return getProfile(actorId);
    },
    async searchProfiles(input: unknown) {
      const caller = { id: actorId, ...(await access()) };
      const p = parseInput(searchInput, input);
      // instr treats wildcard characters literally; all values are bound.
      const query = (p.query ?? "").toLowerCase();
      const skills = [...new Set((p.skills ?? []).map(skill => skill.toLowerCase()))];
      const clauses = skills.map(() => `EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(p.skills) THEN p.skills ELSE '[]' END) skill WHERE lower(skill.value)=?)`);
      const skillFilter = clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "";
      const scope = fixtureScope("u.id");
      const eligible = discoverableMember("u.id", caller);
      const { results } = await db.prepare(`${PROFILE_SELECT}
        WHERE ${eligible.clause}
          AND instr(lower(u.name || ' ' || coalesce(p.headline,'') || ' ' || coalesce(p.skills,'') || ' ' || coalesce(p.bio,'')),?)>0${skillFilter}${scope.clause}
        ORDER BY u.name,u.id LIMIT ?`).bind(...eligible.values,query,...skills,...scope.values,p.limit).all<ProfileRow>();
      await Promise.all(results.map(row=>requireFixtureTarget(row.userId)));
      return results.map(profile);
    },
    async discoveryEvidence() {
      const caller = await requireInstitution();
      const scope = fixtureScope("u.id");
      const eligible = discoverableMember("u.id", caller);
      const { results } = await db.prepare(`${PROFILE_SELECT}
        WHERE ${eligible.clause}${scope.clause}
        ORDER BY u.id LIMIT 501`).bind(...eligible.values,...scope.values).all<ProfileRow>();
      if (results.length > 500) throw new CommunityError("Discovery capacity reached. Please try again later.",503);
      const ids = JSON.stringify(results.map(row => row.userId));
      const { results: entries } = await db.prepare(`SELECT id,userId,title,description,evidenceUrl,occurredAt,lower(state) AS status,coalesce(moderationOutcome='hold',0) AS moderationHold,version,createdAt,updatedAt
        FROM communityJourney j WHERE ${postedWorkEligibility("j")} AND userId IN (SELECT value FROM json_each(?)) ORDER BY id LIMIT 2001`).bind(ids).all<Omit<CommunityJourney,"confirmations">>();
      const mentor = fixtureScope("c.mentorId");
      const { results: confirmations } = await db.prepare(`SELECT c.id,c.journeyId,c.mentorId,u.name AS mentorName,c.statement,c.method,c.journeyVersion,c.mentorRole,c.createdAt
        FROM communityConfirmation c JOIN communityJourney j ON j.id=c.journeyId JOIN user u ON u.id=c.mentorId
        WHERE ${postedWorkEligibility("j")} AND c.journeyVersion=j.version AND j.userId IN (SELECT value FROM json_each(?))${mentor.clause} ORDER BY c.id LIMIT 4001`).bind(ids,...mentor.values).all<CommunityConfirmation>();
      if (entries.length > 2000 || confirmations.length > 4000) throw new CommunityError("Discovery evidence capacity reached.",503);
      return results.map(row => ({profile:profile(row),entries:entries.filter(e=>e.userId===row.userId).map(e=>({...e,confirmations:confirmations.filter(c=>c.journeyId===e.id)}))}));
    },
    /**
     * "Worth another look" (B-4.2; src/lib/mentoring/README.md): shared contributions this mentor
     * confirmed at an earlier revision that have a newer one, so the confirmation no longer covers the
     * current one. Only work the Confirm page shows (confirmWindow: someone else's shared work, the
     * synthetic-identity scopes), since that is where the item sends them, after the page's role
     * check; minus what the mentor has already confirmed or set aside at the current revision. Newest
     * change first, at most WORTH_ANOTHER_LOOK_LIMIT. One read after the roles.
     */
    async listWorthAnotherLook() {
      await requireMentorReview();
      const window = confirmWindow();
      const { results } = await db.prepare(`SELECT j.id AS journeyId,j.userId,u.name AS memberName,u.image AS memberImage,j.title,
          j.version AS currentVersion,MAX(c.journeyVersion) AS confirmedVersion
        FROM communityConfirmation c JOIN communityJourney j ON j.id=c.journeyId JOIN user u ON u.id=j.userId
        WHERE c.mentorId=? AND j.id IN (${window.sql})
          AND NOT EXISTS (SELECT 1 FROM communitySetAside s WHERE s.mentorId=? AND s.journeyId=j.id AND s.journeyVersion=j.version)
        GROUP BY j.id HAVING MAX(c.journeyVersion)<j.version
        ORDER BY j.updatedAt DESC,j.id DESC LIMIT ${WORTH_ANOTHER_LOOK_LIMIT}`)
        .bind(actorId,...window.values,actorId)
        .all<{ journeyId: string; userId: string; memberName: string | null; memberImage: string | null; title: string; currentVersion: number; confirmedVersion: number }>();
      await Promise.all(results.map(row=>requireFixtureTarget(row.userId)));
      return results;
    },
    async listMentorship() {
      const scope = fixtureScope("j.userId");
      const mentorScope = fixtureScope("c.mentorId");
      // The confirmations don't depend on the rows, so they are read beside them (one round trip, not two).
      // They are returned only with the rows, so a caller the rows' mentor check refuses learns nothing.
      const [results, {results: confirmations}] = await Promise.all([
        mentorshipRows<Omit<CommunityJourney, "confirmations"> & { memberName: string }>(
          "j.id,j.userId,u.name AS memberName,j.title,j.description,j.evidenceUrl,j.occurredAt,lower(j.state) AS status,j.version,j.createdAt,j.updatedAt"),
        db.prepare(`SELECT c.id,c.journeyId,c.mentorId,u.name AS mentorName,c.statement,c.method,c.journeyVersion,c.mentorRole,c.createdAt
          FROM communityConfirmation c JOIN communityJourney j ON j.id=c.journeyId JOIN user u ON u.id=c.mentorId
          WHERE ${postedWorkEligibility("j")} AND j.userId<>?${scope.clause}${mentorScope.clause} ORDER BY c.createdAt DESC LIMIT 500`).bind(actorId,...scope.values,...mentorScope.values).all<CommunityConfirmation>(),
      ]);
      return results.map(entry => ({...entry,confirmations:confirmations.filter(c=>c.journeyId===entry.id)}));
    },
    /**
     * How many of the contributions listMentorship returns still have no
     * confirmation from this mentor for their current revision, and are not
     * set aside by them for it: the same rows,
     * read through the same checks, so the number matches the review forms the
     * Confirm page shows. When that window is full and none of it waits,
     * older work beyond it might, so the answer is null (not known) rather
     * than a "nothing waiting" zero. It is derived, not an attention item;
     * see src/lib/mentoring/README.md.
     */
    async countAwaitingConfirmation(): Promise<number | null> {
      const results = await mentorshipRows<{ userId: string }>("j.userId");
      const waiting = results.filter((entry) => !entry.reviewedByCurrentMentor && !entry.setAsideByCurrentMentor).length;
      return waiting === 0 && results.length === MENTORSHIP_WINDOW ? null : waiting;
    },
    async setAccess(input: unknown) {
      requireWritable();
      if (demo) throw new CommunityError("Demo access cannot manage roles.",403);
      const a = await access();
      if (!a.isAdmin) throw new CommunityError("Admin access is required.", 403);
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new CommunityError("Send an access change.");
      const p = input as Record<string, unknown>;
      if (Object.keys(p).some(k => !["userId", "role", "granted"].includes(k)) || typeof p.userId !== "string" || !p.userId || !["INSTITUTION", "MENTOR"].includes(String(p.role)) || typeof p.granted !== "boolean") throw new CommunityError("Invalid access change.");
      if (fixture && fixture.persona !== "admin") throw new CommunityError("Synthetic admin persona required.",403);
      await requireFixtureTarget(p.userId);
      const target = await db.prepare(`SELECT id FROM user WHERE id=?`).bind(p.userId).first();
      if (!target) throw new CommunityError("User not found.", 404);
      const role = await db.prepare(`SELECT id FROM "Roles" WHERE name=?`).bind(p.role).first<{id: string}>();
      if (!role) throw new CommunityError("Apply community migrations before changing access.", 409);
      const accessRole = AccessRole.parse(p.role);
      if (p.granted) await grantCommunityRole({ db, env: { DEPLOYMENT_ENVIRONMENT: environment, PLATFORM_FLAGS_OVERRIDE: flagsOverride } },
        { userId: p.userId, role: accessRole, actorId });
      else await revokeCommunityRole(db, p.userId, accessRole);
      return { userId: p.userId, role: p.role, granted: p.granted };
    },
    async createJourney(input: unknown) {
      requireWritable();
      await requireFixtureTarget(actorId);
      const p = parseInput(journeyInput, input);
      const saved = await db.prepare("SELECT id FROM studentProfile WHERE userId=?").bind(actorId).first();
      if (!saved) await saveMemberText(db,actorId,{headline:"",bio:"",skills:[],opportunityGoals:""},moderationEnv);
      const id = createId();
      await db.prepare(`INSERT INTO communityJourney (id,userId,title,description,evidenceUrl,occurredAt,visibility,state) VALUES (?,?,?,?,?,?,'institution',?)`)
        .bind(id,actorId,p.title,p.description,p.evidenceUrl ?? null,p.occurredAt,p.status === "draft" ? "DRAFT" : "POSTED").run();
      await checkPostedWork(db,id,moderationEnv);
      const stored = await db.prepare(`SELECT createdAt,moderationOutcome FROM communityJourney WHERE id=?`).bind(id).first<{createdAt:number;moderationOutcome:string|null}>();
      return { id, ...p, moderationHold:stored?.moderationOutcome==="hold", userId: actorId, version: 1, createdAt: stored?.createdAt ?? null, confirmations: [] };
    },
    async updateJourney(id: string,input: unknown) {
      requireWritable();
      await requireFixtureTarget(actorId);
      const p = parseInput(journeyUpdateInput,input);
      const result = await db.prepare(`UPDATE communityJourney SET title=?,description=?,evidenceUrl=?,occurredAt=?,visibility='institution',state=?,moderationOutcome=NULL,moderationReviewRequired=0,version=version+1,updatedAt=unixepoch() WHERE id=? AND userId=? AND (? IS NULL OR version=?)`)
        .bind(p.title,p.description,p.evidenceUrl ?? null,p.occurredAt,p.status === "draft" ? "DRAFT" : "POSTED",id,actorId,p.expectedRevision??null,p.expectedRevision??null).run();
      if (!result.meta.changes) throw new CommunityError(p.expectedRevision ? "Contribution changed or is no longer available. Reload before editing." : "Contribution not found.",p.expectedRevision?409:404);
      await checkPostedWork(db,id,moderationEnv);
      return {id,updated:true};
    },
    async setJourneyStatus(id: string, input: unknown) {
      requireWritable();
      await requireFixtureTarget(actorId);
      const p = parseInput(journeyStatusInput,input);
      const result = await db.prepare(`UPDATE communityJourney SET visibility='institution',state=?,moderationOutcome=NULL,moderationReviewRequired=0,version=version+1,updatedAt=unixepoch() WHERE id=? AND userId=?`)
        .bind(p.status === "draft" ? "DRAFT" : "POSTED",id,actorId).run();
      if (!result.meta.changes) throw new CommunityError("Contribution not found.",404);
      await checkPostedWork(db,id,moderationEnv);
      return {id,status:p.status};
    },
    async deleteJourney(id: string) {
      requireWritable();
      await requireFixtureTarget(actorId);
      const result = await db.prepare(`DELETE FROM communityJourney WHERE id=? AND userId=?`).bind(id,actorId).run();
      if (!result.meta.changes) throw new CommunityError("Contribution not found.",404);
      return {deleted:true};
    },
    async confirmJourney(id: string, input: unknown) {
      requireWritable();
      const a = await requireMentorReview();
      const p = parseInput(confirmationInput, input);
      const scope = fixtureScope("j.userId");
      const entry = await db.prepare(`SELECT j.userId,j.version FROM communityJourney j WHERE j.id=? AND ${postedWorkEligibility("j")}${scope.clause}`).bind(id,...scope.values).first<{ userId: string; version: number }>();
      if (!entry) throw new CommunityError("Contribution not found.", 404);
      await requireFixtureTarget(entry.userId);
      if (entry.version !== p.expectedRevision) throw new CommunityError("Contribution changed. Review the current revision before confirming.",409);
      if (entry.userId === actorId) throw new CommunityError("You cannot confirm your own contribution.", 403);
      const confirmationId = createId();
      // Repeat visibility/ownership predicates in the write to avoid a check/write race.
      const writeScope = fixtureScope("userId");
      const result = await db.prepare(`INSERT INTO communityConfirmation (id,journeyId,mentorId,statement,method,journeyVersion,mentorRole)
        SELECT ?,id,?,?,?,version,? FROM communityJourney WHERE id=? AND ${postedWorkEligibility("communityJourney")} AND userId<>? AND version=?${writeScope.clause} AND NOT EXISTS (SELECT 1 FROM communityConfirmation c WHERE c.journeyId=communityJourney.id AND c.mentorId=? AND c.journeyVersion=communityJourney.version)`)
        .bind(confirmationId,actorId,p.statement,p.method,a.isMentor ? "MENTOR" : "ADMIN",id,actorId,entry.version,...writeScope.values,actorId).run();
      if (!result.meta.changes) throw new CommunityError("Contribution no longer available.", 409);
      await workConfirmedAttention({ db, env: { DEPLOYMENT_ENVIRONMENT: environment, PLATFORM_FLAGS_OVERRIDE: flagsOverride } }, confirmationId);
      return { id: confirmationId, journeyId: id, mentorId: actorId, ...p, journeyVersion: entry.version,mentorRole:a.isMentor ? "MENTOR" : "ADMIN" };
    },
    /**
     * "I can't confirm this": takes the revision the mentor saw out of their
     * own waiting list, under the same checks as confirming it. Nothing else
     * reads it, so the member, other mentors and institutions see no change.
     * Setting the same revision aside again is a no-op.
     */
    async setAsideJourney(id: string, input: unknown) {
      requireWritable();
      await requireMentorReview();
      const p = parseInput(setAsideInput, input);
      const scope = fixtureScope("j.userId");
      const entry = await db.prepare(`SELECT j.userId,j.version,EXISTS (SELECT 1 FROM communityConfirmation c WHERE c.journeyId=j.id AND c.mentorId=? AND c.journeyVersion=j.version) AS confirmed
        FROM communityJourney j WHERE j.id=? AND ${postedWorkEligibility("j")}${scope.clause}`).bind(actorId,id,...scope.values).first<{ userId: string; version: number; confirmed: number }>();
      if (!entry) throw new CommunityError("Contribution not found.", 404);
      await requireFixtureTarget(entry.userId);
      if (entry.userId === actorId) throw new CommunityError("Your own contributions never wait for your confirmation.", 403);
      if (entry.version !== p.expectedRevision) throw new CommunityError("Contribution changed. Review the current revision first.",409);
      if (entry.confirmed) throw new CommunityError("You've already confirmed this revision.",409);
      // Repeat the predicates in the write so a concurrent edit or retraction cannot be set aside.
      const writeScope = fixtureScope("userId");
      await db.prepare(`INSERT INTO communitySetAside (mentorId,journeyId,journeyVersion)
        SELECT ?,id,version FROM communityJourney WHERE id=? AND ${postedWorkEligibility("communityJourney")} AND userId<>? AND version=?${writeScope.clause}
        ON CONFLICT DO NOTHING`).bind(actorId,id,actorId,entry.version,...writeScope.values).run();
      const stored = await db.prepare(`SELECT 1 AS found FROM communitySetAside WHERE mentorId=? AND journeyId=? AND journeyVersion=?`).bind(actorId,id,entry.version).first();
      if (!stored) throw new CommunityError("Contribution no longer available.", 409);
      return { journeyId: id, journeyVersion: entry.version, setAside: true as const };
    },
    /** Undo: the contribution waits for this mentor again. Only their own set-asides are touched. */
    async undoSetAside(id: string) {
      requireWritable();
      await requireMentorReview();
      await db.prepare(`DELETE FROM communitySetAside WHERE mentorId=? AND journeyId=?`).bind(actorId,id).run();
      return { journeyId: id, setAside: false as const };
    },
  };
}
export type CommunityService = ReturnType<typeof createCommunityService>;
