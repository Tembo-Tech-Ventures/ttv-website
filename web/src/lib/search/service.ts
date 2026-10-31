import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import { SearchQuery, SearchResults, WebLink, type PersonSummary } from "@/lib/platform/contracts";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { DEMO_USER_IDS, isDemoUser } from "@/lib/staging-demo-policy";
import { resolvePublicProfileIdentity } from "@/lib/talent/public-identity";

export const SEARCH_RESULT_LIMIT = 10;
export const SEARCH_CANDIDATE_LIMIT = 500;
const TEXT_LIMIT = 4000;

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
 * bounded authorized source windows, not the chat tool's global vector query.
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
  const term = query.q.trim().toLowerCase();
  const demo = isDemoUser(userId);
  // Demo identities may never use their global roles to discover real records.
  const publicScope = demo ? ` AND p.userId IN (SELECT value FROM json_each(?))` : "";
  const publicValues = demo ? [JSON.stringify(DEMO_USER_IDS)] : [];
  const publicColumns = "p.userId,p.handle,p.publicName,p.publicAvatarUrl";
  const includePublic = !query.programId && ["all", "community"].includes(query.scope);

  if (includePublic || query.scope === "people") {
    const { results: rows } = await d1.prepare(`WITH candidates AS MATERIALIZED (
      SELECT ${publicColumns},substr(coalesce(p.bio,''),1,${TEXT_LIMIT}) AS bio,
        substr(coalesce(p.headline,''),1,${TEXT_LIMIT}) AS headline,
        substr(coalesce(p.skills,''),1,${TEXT_LIMIT}) AS skills
      FROM studentProfile p WHERE ${PUBLIC_PROFILE}${publicScope}
      ORDER BY p.userId LIMIT ${SEARCH_CANDIDATE_LIMIT}
    ) SELECT userId,handle,publicName,publicAvatarUrl,substr(bio,1,500) AS bio FROM candidates
      WHERE instr(lower(coalesce(publicName,'TTV Builder') || ' ' || headline || ' ' || bio || ' ' || skills),?)>0
      ORDER BY userId LIMIT ${SEARCH_RESULT_LIMIT}`).bind(...publicValues, term)
      .all<PublicPersonRow & { bio: string }>();
    results.people = rows.map(row => ({ person: person(row), bio: row.bio,
      href: `/talent/${encodeURIComponent(row.handle)}`, visibility: { kind: "PUBLIC", label: "Public profile" } }));
  }

  if (includePublic || query.scope === "projects") {
    // Institution-shared journeys are NOT community-public. Even privileged
    // callers receive no private journeys or unpublished profile identities.
    const { results: rows } = await d1.prepare(`WITH candidates AS MATERIALIZED (
      SELECT ${publicColumns},j.id,j.version,substr(j.title,1,500) AS title,
        substr(j.description,1,${TEXT_LIMIT}) AS description
      FROM communityJourney j JOIN studentProfile p ON p.userId=j.userId
      WHERE ${PUBLIC_PROFILE}${publicScope} AND j.visibility='institution'
        AND (j.userId=? OR ?=1)
      ORDER BY j.id LIMIT ${SEARCH_CANDIDATE_LIMIT}
    ) SELECT userId,handle,publicName,publicAvatarUrl,id,version,title,substr(description,1,500) AS summary
      FROM candidates WHERE instr(lower(title || ' ' || description),?)>0
      ORDER BY id LIMIT ${SEARCH_RESULT_LIMIT}`).bind(...publicValues, userId, Number(caps.isInstitution || caps.isAdmin), term)
      .all<PublicPersonRow & { id: string; version: number; title: string; summary: string }>();
    results.projects = rows.map(row => ({ journeyId: row.id, version: row.version, title: row.title,
      summary: row.summary, owner: person(row),
      href: row.userId === userId ? "/dashboard/community" : `/dashboard/discover?profile=${encodeURIComponent(row.userId)}`,
      visibility: { kind: "PRIVATE", label: "Shared with approved institutions" } }));
  }

  if (["all", "cohort", "sessionMoments"].includes(query.scope) && caps.cohortIds.length > 0) {
    const programIds = query.programId ? [query.programId] : caps.cohortIds;
    const { results: rows } = await d1.prepare(`WITH candidates AS MATERIALIZED (
      SELECT s.id,r.id AS recordingId,r.programId,substr(r.title,1,500) AS title,s.startTime,
        substr(s.text,1,${TEXT_LIMIT}) AS text
      FROM transcript_segment s JOIN recording r ON r.id=s.recordingId
      WHERE r.programId IN (SELECT value FROM json_each(?)) AND r.processingStatus='complete'
        AND s.startTime>=0 AND length(trim(s.text))>0
      ORDER BY s.id LIMIT ${SEARCH_CANDIDATE_LIMIT}
    ) SELECT recordingId,programId,title,startTime,
        substr(text,max(1,instr(lower(text),?)-100),500) AS quote
      FROM candidates WHERE instr(lower(text),?)>0
      ORDER BY recordingId,startTime,id LIMIT ${SEARCH_RESULT_LIMIT}`)
      .bind(JSON.stringify(programIds), term, term)
      .all<{ recordingId: string; programId: string; title: string; startTime: number; quote: string }>();
    results.sessionMoments = rows.map(row => ({ recordingId: row.recordingId, programId: row.programId,
      title: row.title, startSeconds: row.startTime, quote: row.quote,
      href: `/dashboard/sessions/${encodeURIComponent(row.recordingId)}?t=${Math.floor(row.startTime)}`,
      visibility: { kind: "COHORT", label: "Only you and your cohort" } }));
  }
  return SearchResults.parse(results);
}
