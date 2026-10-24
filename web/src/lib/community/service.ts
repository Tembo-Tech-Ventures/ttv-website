import { createId } from "@paralleldrive/cuid2";
import {
  CommunityError, profileInput, journeyInput, confirmationInput, searchInput, parseInput,
  type CommunityProfile, type CommunityJourney, type CommunityConfirmation,
} from "./model";

interface ProfileRow {
  userId: string; name: string; image: string | null; headline: string | null;
  bio: string | null; skills: string | null; opportunityGoals: string | null;
  version: number | null; updatedAt: number | null;
}
function profile(row: ProfileRow): CommunityProfile {
  let skills: string[] = [];
  try { const value: unknown = JSON.parse(row.skills ?? "[]"); if (Array.isArray(value)) skills = value.filter((s): s is string => typeof s === "string"); } catch { /* Older malformed rows have no skills. */ }
  return { userId: row.userId, name: row.name, image: row.image, headline: row.headline ?? "", bio: row.bio ?? "", skills,
    opportunityGoals: row.opportunityGoals ?? "", version: row.version ?? 0, updatedAt: row.updatedAt };
}
const PROFILE_SELECT = `SELECT u.id AS userId,u.name,u.image,p.headline,p.bio,p.skills,p.opportunityGoals,p.version,p.updatedAt
  FROM user u LEFT JOIN communityProfile p ON p.userId=u.id`;

export function createCommunityService(db: D1Database, actorId: string) {
  if (!actorId) throw new CommunityError("Sign in to continue.", 401);
  async function access() {
    const { results } = await db.prepare(`SELECT r.name FROM "Roles" r JOIN "UserRoles" ur ON ur.roleId=r.id WHERE ur.userId=?`).bind(actorId).all<{ name: string }>();
    const roles = new Set(results.map((r) => r.name));
    return { isAdmin: roles.has("ADMIN"), isMentor: roles.has("MENTOR"), isInstitution: roles.has("INSTITUTION") };
  }
  async function requireInstitution() {
    const a = await access();
    if (!a.isInstitution && !a.isAdmin) throw new CommunityError("Approved institutional access is required.", 403);
  }
  async function requireProfileAccess(target: string) {
    if (target !== actorId) await requireInstitution();
  }
  async function getProfile(target: string): Promise<CommunityProfile> {
    await requireProfileAccess(target);
    const row = await db.prepare(`${PROFILE_SELECT} WHERE u.id=?`).bind(target).first<ProfileRow>();
    if (!row) throw new CommunityError("Profile not found.", 404);
    return profile(row);
  }
  async function listJourney(target = actorId): Promise<CommunityJourney[]> {
    await requireProfileAccess(target);
    const { results } = await db.prepare(`SELECT id,userId,title,description,evidenceUrl,occurredAt,visibility,version,createdAt,updatedAt FROM communityJourney
      WHERE userId=? AND (?=userId OR visibility='institution') ORDER BY occurredAt DESC,id DESC LIMIT 100`).bind(target, actorId).all<Omit<CommunityJourney, "confirmations">>();
    if (results.length === 0) return [];
    const { results: confirmations } = await db.prepare(`SELECT c.id,c.journeyId,c.mentorId,u.name AS mentorName,c.statement,c.method,c.journeyVersion,c.mentorRole,c.createdAt
      FROM communityConfirmation c JOIN communityJourney j ON j.id=c.journeyId JOIN user u ON u.id=c.mentorId
      WHERE j.userId=? AND (?=j.userId OR j.visibility='institution') ORDER BY c.createdAt DESC LIMIT 500`).bind(target, actorId).all<CommunityConfirmation>();
    return results.map((entry) => ({ ...entry, confirmations: confirmations.filter((c) => c.journeyId === entry.id) }));
  }
  return {
    access, getProfile, listJourney,
    getOwnProfile: () => getProfile(actorId),
    async updateOwnProfile(input: unknown) {
      const p = parseInput(profileInput, input);
      await db.prepare(`INSERT INTO communityProfile (userId,headline,bio,skills,opportunityGoals) VALUES (?,?,?,?,?)
        ON CONFLICT(userId) DO UPDATE SET headline=excluded.headline,bio=excluded.bio,skills=excluded.skills,
        opportunityGoals=excluded.opportunityGoals,version=communityProfile.version+1,updatedAt=unixepoch()`)
        .bind(actorId,p.headline,p.bio,JSON.stringify([...new Set(p.skills)]),p.opportunityGoals).run();
      return getProfile(actorId);
    },
    async searchProfiles(input: unknown) {
      await requireInstitution();
      const p = parseInput(searchInput, input);
      // instr treats wildcard characters literally; all values are bound.
      const query = (p.query ?? "").toLowerCase();
      const skills = [...new Set((p.skills ?? []).map(skill => skill.toLowerCase()))];
      const clauses = skills.map(() => `EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(p.skills) THEN p.skills ELSE '[]' END) skill WHERE lower(skill.value)=?)`);
      const skillFilter = clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "";
      const { results } = await db.prepare(`${PROFILE_SELECT}
        WHERE instr(lower(u.name || ' ' || coalesce(p.headline,'') || ' ' || coalesce(p.skills,'') || ' ' || coalesce(p.bio,'')),?)>0${skillFilter}
        ORDER BY u.name,u.id LIMIT ?`).bind(query,...skills,p.limit).all<ProfileRow>();
      return results.map(profile);
    },
    async listMentorship() {
      const a = await access();
      if (!a.isMentor && !a.isAdmin) throw new CommunityError("Mentor access is required.", 403);
      const { results } = await db.prepare(`SELECT j.id,j.userId,u.name AS memberName,j.title,j.description,j.evidenceUrl,j.occurredAt,j.visibility,j.version,j.createdAt,j.updatedAt
        FROM communityJourney j JOIN user u ON u.id=j.userId WHERE j.visibility='institution' AND j.userId<>? ORDER BY j.createdAt DESC,j.id DESC LIMIT 50`).bind(actorId).all<Omit<CommunityJourney, "confirmations"> & { memberName: string }>();
      const {results: confirmations} = await db.prepare(`SELECT c.id,c.journeyId,c.mentorId,u.name AS mentorName,c.statement,c.method,c.journeyVersion,c.mentorRole,c.createdAt
        FROM communityConfirmation c JOIN communityJourney j ON j.id=c.journeyId JOIN user u ON u.id=c.mentorId
        WHERE j.visibility='institution' AND j.userId<>? ORDER BY c.createdAt DESC LIMIT 500`).bind(actorId).all<CommunityConfirmation>();
      return results.map(entry => ({...entry,confirmations:confirmations.filter(c=>c.journeyId===entry.id)}));
    },
    async setAccess(input: unknown) {
      const a = await access();
      if (!a.isAdmin) throw new CommunityError("Admin access is required.", 403);
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new CommunityError("Send an access change.");
      const p = input as Record<string, unknown>;
      if (Object.keys(p).some(k => !["userId", "role", "granted"].includes(k)) || typeof p.userId !== "string" || !p.userId || !["INSTITUTION", "MENTOR"].includes(String(p.role)) || typeof p.granted !== "boolean") throw new CommunityError("Invalid access change.");
      const target = await db.prepare(`SELECT id FROM user WHERE id=?`).bind(p.userId).first();
      if (!target) throw new CommunityError("User not found.", 404);
      const role = await db.prepare(`SELECT id FROM "Roles" WHERE name=?`).bind(p.role).first<{id: string}>();
      if (!role) throw new CommunityError("Apply community migrations before changing access.", 409);
      if (p.granted) await db.prepare(`INSERT INTO "UserRoles" (id,userId,roleId) VALUES (?,?,?) ON CONFLICT(userId,roleId) DO NOTHING`).bind(createId(),p.userId,role.id).run();
      else await db.prepare(`DELETE FROM "UserRoles" WHERE userId=? AND roleId=?`).bind(p.userId,role.id).run();
      return { userId: p.userId, role: p.role, granted: p.granted };
    },
    async createJourney(input: unknown) {
      const p = parseInput(journeyInput, input);
      const id = createId();
      await db.prepare(`INSERT INTO communityJourney (id,userId,title,description,evidenceUrl,occurredAt,visibility) VALUES (?,?,?,?,?,?,?)`)
        .bind(id,actorId,p.title,p.description,p.evidenceUrl ?? null,p.occurredAt,p.visibility).run();
      const stored = await db.prepare(`SELECT createdAt FROM communityJourney WHERE id=?`).bind(id).first<{createdAt:number}>();
      return { id, ...p, userId: actorId, version: 1, createdAt: stored?.createdAt ?? null, confirmations: [] };
    },
    async updateJourney(id: string,input: unknown) {
      const p = parseInput(journeyInput,input);
      const result = await db.prepare(`UPDATE communityJourney SET title=?,description=?,evidenceUrl=?,occurredAt=?,visibility=?,version=version+1,updatedAt=unixepoch() WHERE id=? AND userId=?`)
        .bind(p.title,p.description,p.evidenceUrl ?? null,p.occurredAt,p.visibility,id,actorId).run();
      if (!result.meta.changes) throw new CommunityError("Contribution not found.",404);
      return {id,updated:true};
    },
    async setJourneyVisibility(id: string, input: unknown) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new CommunityError("Send a visibility change.");
      const p = input as Record<string, unknown>;
      if (Object.keys(p).length !== 1 || !["institution", "private"].includes(String(p.visibility))) throw new CommunityError("Choose institution or private visibility.");
      const result = await db.prepare(`UPDATE communityJourney SET visibility=?,version=version+1,updatedAt=unixepoch() WHERE id=? AND userId=?`)
        .bind(p.visibility,id,actorId).run();
      if (!result.meta.changes) throw new CommunityError("Contribution not found.",404);
      return {id,visibility:p.visibility};
    },
    async deleteJourney(id: string) {
      const result = await db.prepare(`DELETE FROM communityJourney WHERE id=? AND userId=?`).bind(id,actorId).run();
      if (!result.meta.changes) throw new CommunityError("Contribution not found.",404);
      return {deleted:true};
    },
    async confirmJourney(id: string, input: unknown) {
      const a = await access();
      if (!a.isMentor && !a.isAdmin) throw new CommunityError("Mentor access is required.", 403);
      const p = parseInput(confirmationInput, input);
      const entry = await db.prepare(`SELECT userId,version FROM communityJourney WHERE id=? AND visibility='institution'`).bind(id).first<{ userId: string; version: number }>();
      if (!entry) throw new CommunityError("Contribution not found.", 404);
      if (entry.version !== p.expectedRevision) throw new CommunityError("Contribution changed. Review the current revision before confirming.",409);
      if (entry.userId === actorId) throw new CommunityError("You cannot confirm your own contribution.", 403);
      const confirmationId = createId();
      // Repeat visibility/ownership predicates in the write to avoid a check/write race.
      const result = await db.prepare(`INSERT INTO communityConfirmation (id,journeyId,mentorId,statement,method,journeyVersion,mentorRole)
        SELECT ?,id,?,?,?,version,? FROM communityJourney WHERE id=? AND visibility='institution' AND userId<>? AND version=?`)
        .bind(confirmationId,actorId,p.statement,p.method,a.isMentor ? "MENTOR" : "ADMIN",id,actorId,entry.version).run();
      if (!result.meta.changes) throw new CommunityError("Contribution no longer available.", 409);
      return { id: confirmationId, journeyId: id, mentorId: actorId, ...p, journeyVersion: entry.version,mentorRole:a.isMentor ? "MENTOR" : "ADMIN" };
    },
  };
}
export type CommunityService = ReturnType<typeof createCommunityService>;
