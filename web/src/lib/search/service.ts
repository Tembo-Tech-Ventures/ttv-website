import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import { SearchQuery, SearchResults, WebLink, type PersonSummary } from "@/lib/platform/contracts";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { DEMO_USER_IDS, isDemoUser } from "@/lib/staging-demo-policy";
import { discoverableMember } from "@/lib/community/eligibility";
import { resolvePublicProfileIdentity } from "@/lib/talent/public-identity";

export const SEARCH_RESULT_LIMIT = 10;

export class SearchScopeError extends Error {}

// Match the public talent page: publication alone does not confer eligibility.
const PUBLIC_PROFILE = `p.status='PUBLISHED' AND EXISTS (
  SELECT 1 FROM programApplication a WHERE a.userId=p.userId
  AND a.status='COMPLETED' AND a.completedAt IS NOT NULL)`;

interface PublicPersonRow {
  userId: string; handle: string; publicName: string | null; publicAvatarUrl: string | null;
}
function person(row: PublicPersonRow): PersonSummary {
  const identity = resolvePublicProfileIdentity(row);
  const avatar = WebLink.safeParse(identity.image);
  return { id: row.userId, name: identity.name.trim() || "TTV Builder",
    avatarUrl: avatar.success ? avatar.data : null, roleBadges: [] };
}

/**
 * One canonical access lookup per search, before retrieving any content.
 * No AI/Vectorize binding is accepted: v1 performs literal text search over
 * authorized sources, not the chat tool's global vector query. Limits apply
 * after matching, so a large cohort does not silently lose searchable content.
 */
export async function searchPlatform(d1: D1Database, userId: string, input: SearchQuery): Promise<SearchResults> {
  if (!userId) throw new SearchScopeError("Authentication required.");
  const query = SearchQuery.parse(input);
  const caps = await capabilitiesFor(drizzle(d1, { schema }), { id: userId });
  if (query.programId && !["all", "cohort", "sessionMoments"].includes(query.scope)) {
    throw new SearchScopeError("This scope does not accept a cohort.");
  }
  if (query.programId && !caps.cohortIds.includes(query.programId)) {
    throw new SearchScopeError("Cohort is not available.");
  }
  const results: SearchResults = { query, messages: [], people: [], projects: [], sessionMoments: [] };
  const term = query.q.trim();
  const demo = isDemoUser(userId);
  // Demo identities may never use their global roles to discover real records.
  const publicScope = demo ? ` AND p.userId IN (SELECT value FROM json_each(?))` : "";
  const publicValues = demo ? [JSON.stringify(DEMO_USER_IDS)] : [];
  const publicColumns = "p.userId,p.handle,p.publicName,p.publicAvatarUrl";
  const includePublic = !query.programId && ["all", "community"].includes(query.scope);
  // Institutions and admins see people through institutional discovery's one
  // eligibility rule; everyone else sees the public talent directory as is.
  const institutional = caps.isInstitution || caps.isAdmin;
  const discoverable = discoverableMember("p.userId", userId);
  const discoverableScope = institutional ? ` AND ${discoverable.clause}` : "";
  const discoverableValues = institutional ? discoverable.values : [];

  if (includePublic || query.scope === "people") {
    const { results: rows } = await d1.prepare(`SELECT ${publicColumns},substr(coalesce(p.bio,''),1,500) AS bio
      FROM studentProfile p WHERE ${PUBLIC_PROFILE}${publicScope}${discoverableScope}
      AND (instr(lower(coalesce(p.publicName,'') || ' ' || coalesce(p.headline,'') || ' ' || coalesce(p.bio,'')),lower(?))>0
        OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(p.skills) THEN p.skills ELSE '[]' END) skill
          WHERE skill.type='text' AND instr(lower(skill.value),lower(?))>0))
      ORDER BY p.userId LIMIT ${SEARCH_RESULT_LIMIT}`).bind(...publicValues, ...discoverableValues, term, term)
      .all<PublicPersonRow & { bio: string }>();
    results.people = rows.map(row => ({ person: person(row), bio: row.bio,
      href: `/talent/${encodeURIComponent(row.handle)}`, visibility: { kind: "PUBLIC", label: "Public profile" } }));
  }

  if (includePublic || query.scope === "projects") {
    // Institution-shared journeys are NOT community-public. Even privileged
    // callers receive no private journeys or unpublished profile identities.
    const { results: rows } = await d1.prepare(`
      SELECT ${publicColumns},j.id,j.version,substr(j.title,1,500) AS title,
        substr(j.description,1,500) AS summary
      FROM communityJourney j JOIN studentProfile p ON p.userId=j.userId
      WHERE ${PUBLIC_PROFILE}${publicScope} AND j.visibility='institution'
        AND (j.userId=? OR ${institutional ? discoverable.clause : "0"})
        AND NOT EXISTS (SELECT 1 FROM UserRoles ur JOIN Roles role ON role.id=ur.roleId
          WHERE ur.userId=j.userId AND role.name IN ('MENTOR','ADMIN'))
        AND instr(lower(j.title || ' ' || j.description),lower(?))>0
      ORDER BY j.id LIMIT ${SEARCH_RESULT_LIMIT}`).bind(...publicValues, userId, ...discoverableValues, term)
      .all<PublicPersonRow & { id: string; version: number; title: string; summary: string }>();
    results.projects = rows.map(row => ({ journeyId: row.id, version: row.version, title: row.title,
      summary: row.summary, owner: person(row),
      href: row.userId === userId ? "/dashboard/community" : `/dashboard/discover?profile=${encodeURIComponent(row.userId)}`,
      visibility: { kind: "PRIVATE", label: "Shared with approved institutions" } }));
  }

  if (["all", "cohort", "sessionMoments"].includes(query.scope) && caps.cohortIds.length > 0) {
    const programIds = query.programId ? [query.programId] : caps.cohortIds;
    // Drive the segment index from authorized recordings, never scan the
    // global segment table in random CUID order. No transcriptText prefilter:
    // that denormalized column may be absent/stale while segments are valid.
    const { results: rows } = await d1.prepare(`WITH authorized_recordings AS MATERIALIZED (
      SELECT id,programId,title FROM recording
      WHERE programId IN (SELECT value FROM json_each(?)) AND processingStatus='complete'
    ) SELECT r.id AS recordingId,r.programId,substr(r.title,1,500) AS title,s.startTime,
        substr(s.text,max(1,instr(lower(s.text),lower(?))-100),500) AS quote
      FROM authorized_recordings r CROSS JOIN transcript_segment s
      WHERE s.recordingId=r.id AND s.startTime>=0 AND instr(lower(s.text),lower(?))>0
      ORDER BY r.id,s.startTime,s.id LIMIT ${SEARCH_RESULT_LIMIT}`)
      .bind(JSON.stringify(programIds), term, term)
      .all<{ recordingId: string; programId: string; title: string; startTime: number; quote: string }>();
    results.sessionMoments = rows.map(row => ({ recordingId: row.recordingId, programId: row.programId,
      title: row.title, startSeconds: row.startTime, quote: row.quote,
      href: `/dashboard/sessions/${encodeURIComponent(row.recordingId)}?t=${Math.floor(row.startTime)}`,
      visibility: { kind: "COHORT", label: "Only you and your cohort" } }));
  }
  return SearchResults.parse(results);
}
