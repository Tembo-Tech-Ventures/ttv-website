import {
  memberEligibility,
  postedWorkEligibility,
  publicProfileEligibility,
  type DiscoveryCaller,
} from "@/lib/community/eligibility";
import { parseSkillsJson } from "@/lib/talent/profile";
import { safePublicProfileAvatarUrl } from "@/lib/avatar";
import { CommunityError } from "@/lib/community/model";

/** All dates crossing this read contract are Unix seconds, except occurredAt (YYYY-MM-DD). */
export interface WorkView {
  id: string;
  title: string;
  description: string;
  link: string | null;
  kind: "contribution" | "repo";
  repo: {
    fullName: string;
    description: string | null;
    language: string | null;
    topics: string[];
    stars: number;
    pushedAt: number | null;
    snapshotAt: number;
  } | null;
  occurredAt: string;
  revision: number;
  confirmations: Array<{
    id: string;
    mentorName: string;
    statement: string;
    method: string;
    revision: number;
    isCurrentRevision: boolean;
    createdAt: number;
  }>;
}

export interface MemberCard {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  headline: string;
  skills: string[];
  opportunityGoals: string;
  openToFreelance: boolean;
  openToRoles: boolean;
  postedWorkCount: number;
  confirmedWorkCount: number;
  completedCohorts: string[];
  onPublicSite: boolean;
}

export interface MemberProfileView extends MemberCard {
  bio: string;
  work: WorkView[];
  publicUrl: string | null;
  isOwn: boolean;
}

export interface MemberFilters {
  q?: string;
  skills?: string[];
  openTo?: "freelance" | "roles";
  cursor?: string;
}

export interface MemberPage {
  members: MemberCard[];
  nextCursor: string | null;
  total: number;
}

const PAGE_SIZE = 24;
interface CardRow {
  userId: string;
  handle: string;
  publicName: string | null;
  publicAvatarUrl: string | null;
  headline: string | null;
  bio: string | null;
  skills: string | null;
  opportunityGoals: string;
  openToFreelance: number;
  openToRoles: number;
  postedWorkCount: number;
  confirmedWorkCount: number;
  completedCohorts: string;
  onPublicSite: number;
}
const CARD_COLUMNS = `p.userId,p.handle,p.publicName,p.publicAvatarUrl,p.headline,p.bio,p.skills,p.opportunityGoals,
  p.openToFreelance,p.openToRoles,
  (SELECT count(*) FROM communityJourney w WHERE w.userId=p.userId AND ${postedWorkEligibility("w")}) AS postedWorkCount,
  (SELECT count(*) FROM communityJourney w WHERE w.userId=p.userId AND ${postedWorkEligibility("w")}
    AND EXISTS (SELECT 1 FROM communityConfirmation c WHERE c.journeyId=w.id AND c.journeyVersion=w.version)) AS confirmedWorkCount,
  (SELECT json_group_array(program.name) FROM programApplication a JOIN program ON program.id=a.programId
    WHERE a.userId=p.userId AND a.status='COMPLETED' AND a.completedAt IS NOT NULL) AS completedCohorts,
  ${publicProfileEligibility("p")} AS onPublicSite`;
function card(row: CardRow): MemberCard {
  return {
    handle: row.handle,
    displayName: row.publicName ?? "TTV Member",
    avatarUrl: safePublicProfileAvatarUrl(row.publicAvatarUrl),
    headline: row.headline ?? "",
    skills: parseSkillsJson(row.skills),
    opportunityGoals: row.opportunityGoals,
    openToFreelance: Boolean(row.openToFreelance),
    openToRoles: Boolean(row.openToRoles),
    postedWorkCount: row.postedWorkCount,
    confirmedWorkCount: row.confirmedWorkCount,
    completedCohorts: parseSkillsJson(row.completedCohorts),
    onPublicSite: Boolean(row.onPublicSite),
  };
}
function requireCaller(caller: DiscoveryCaller) {
  if (!caller.id) throw new CommunityError("Sign in to continue.", 401);
}
function nairobiDay() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
interface Cursor {
  day: string;
  rank: number;
  handle: string;
}
function pageCursor(value: string | undefined): Cursor | null {
  try {
    const c = JSON.parse(atob(value ?? "")) as Cursor;
    const age = Date.parse(nairobiDay()) - Date.parse(c.day);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(c.day) ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > 7 * 86400000 ||
      !Number.isInteger(c.rank) ||
      c.rank < -2147483648 ||
      c.rank > 2147483647 ||
      !/^[a-z0-9-]{3,39}$/.test(c.handle)
    )
      return null;
    return c;
  } catch {
    return null;
  }
}
/** Daily fairSort order, pinned in the cursor; one batch, never a query per card. */
export async function listMembers(
  db: D1Database,
  caller: DiscoveryCaller,
  filters: MemberFilters = {},
): Promise<MemberPage> {
  requireCaller(caller);
  const q = (filters.q ?? "").trim().slice(0, 100);
  const skills = (filters.skills ?? [])
    .slice(0, 5)
    .map((s) => s.trim().slice(0, 40));
  const cursor = pageCursor(filters.cursor);
  const day = cursor?.day ?? nairobiDay();
  // Same signed 32-bit DJB2 and multiplication as fairSort, evaluated in SQLite before LIMIT.
  let factor = 5381;
  for (const char of day) factor = (factor * 33 + char.charCodeAt(0)) | 0;
  const rotation = `WITH RECURSIVE hashes(id,pos,h) AS (
    SELECT id,0,5381 FROM studentProfile UNION ALL
    SELECT id,pos+1,(h*33+unicode(substr(id,pos+1,1))) & 4294967295 FROM hashes WHERE pos<length(id)
  ), ranks AS (SELECT id,(((h*${factor | 1}) & 4294967295)+2147483648) % 4294967296-2147483648 AS rank
    FROM hashes WHERE pos=length(id))`;
  const where = `${memberEligibility("p.userId")} AND p.userId<>?
    AND instr(lower(coalesce(p.publicName,'')||' '||coalesce(p.headline,'')||' '||coalesce(p.bio,'')||' '||coalesce(p.skills,'')||' '||p.opportunityGoals),lower(?))>0
    AND NOT EXISTS (SELECT 1 FROM json_each(?) wanted WHERE NOT EXISTS (
      SELECT 1 FROM json_each(CASE WHEN json_valid(p.skills) THEN p.skills ELSE '[]' END) skill WHERE lower(skill.value)=lower(wanted.value)))
    ${filters.openTo === "freelance" ? "AND p.openToFreelance=1" : filters.openTo === "roles" ? "AND p.openToRoles=1" : ""}`;
  const values = [caller.id, q, JSON.stringify(skills)];
  const [page, count] = await db.batch([
    db
      .prepare(
        `${rotation} SELECT ${CARD_COLUMNS},r.rank FROM studentProfile p JOIN ranks r ON r.id=p.id
      WHERE ${where} AND (r.rank>? OR (r.rank=? AND p.handle>?)) ORDER BY r.rank,p.handle LIMIT ${PAGE_SIZE + 1}`,
      )
      .bind(
        ...values,
        cursor?.rank ?? -2147483649,
        cursor?.rank ?? -2147483649,
        cursor?.handle ?? "",
      ),
    db
      .prepare(`SELECT count(*) AS total FROM studentProfile p WHERE ${where}`)
      .bind(...values),
  ]);
  const rows = page.results as unknown as (CardRow & { rank: number })[];
  const members = rows.slice(0, PAGE_SIZE).map(card);
  const last = rows[PAGE_SIZE - 1];
  return {
    members,
    total: Number(
      (count.results[0] as { total?: number } | undefined)?.total ?? 0,
    ),
    nextCursor:
      rows.length > PAGE_SIZE
        ? btoa(JSON.stringify({ day, rank: last.rank, handle: last.handle }))
        : null,
  };
}
/** The caller's card in the shared view, for the separate You card. */
export async function readOwnMemberCard(
  db: D1Database,
  caller: DiscoveryCaller,
): Promise<MemberCard | null> {
  requireCaller(caller);
  const row = await db
    .prepare(
      `SELECT ${CARD_COLUMNS} FROM studentProfile p WHERE p.userId=? AND ${memberEligibility("p.userId")}`,
    )
    .bind(caller.id)
    .first<CardRow>();
  return row ? card(row) : null;
}
interface WorkRow {
  id: string;
  title: string;
  description: string;
  evidenceUrl: string | null;
  kind: "contribution" | "repo";
  repoFullName: string | null;
  repoDescription: string | null;
  language: string | null;
  topics: string | null;
  stars: number;
  pushedAt: number | null;
  snapshotAt: number | null;
  occurredAt: string;
  version: number;
  confirmations: string;
}
/** Read a single member and their work in one D1 batch. Unknown and inaccessible both return null. */
export async function readMember(
  db: D1Database,
  caller: DiscoveryCaller,
  handle: string,
): Promise<MemberProfileView | null> {
  requireCaller(caller);
  const visible = memberEligibility("p.userId");
  const [profiles, work] = await db.batch([
    db
      .prepare(
        `SELECT ${CARD_COLUMNS} FROM studentProfile p WHERE p.handle=? AND ${visible}`,
      )
      .bind(handle),
    db
      .prepare(
        `SELECT w.*,(SELECT json_group_array(json_object('id',c.id,'mentorName',mentor.name,
      'statement',c.statement,'method',c.method,'revision',c.journeyVersion,
      'isCurrentRevision',c.journeyVersion=w.version,'createdAt',c.createdAt))
      FROM communityConfirmation c JOIN user mentor ON mentor.id=c.mentorId WHERE c.journeyId=w.id) AS confirmations
      FROM communityJourney w JOIN studentProfile p ON p.userId=w.userId WHERE p.handle=? AND ${visible}
      AND ${postedWorkEligibility("w")}
      ORDER BY w.sortOrder,w.occurredAt DESC,w.id`,
      )
      .bind(handle),
  ]);
  const row = profiles.results[0] as unknown as CardRow | undefined;
  if (!row) return null;
  return {
    ...card(row),
    bio: row.bio ?? "",
    isOwn: row.userId === caller.id,
    publicUrl: row.onPublicSite ? `/talent/${row.handle}` : null,
    work: (work.results as unknown as WorkRow[]).map((w) => ({
      id: w.id,
      title: w.title,
      description: w.description,
      link: w.evidenceUrl,
      kind: w.kind,
      occurredAt: w.occurredAt,
      revision: w.version,
      repo:
        w.kind === "repo" && w.repoFullName && w.snapshotAt !== null
          ? {
              fullName: w.repoFullName,
              description: w.repoDescription,
              language: w.language,
              topics: parseSkillsJson(w.topics),
              stars: w.stars,
              pushedAt: w.pushedAt,
              snapshotAt: w.snapshotAt,
            }
          : null,
      confirmations: (
        JSON.parse(w.confirmations) as WorkView["confirmations"]
      ).map((c) => ({ ...c, isCurrentRevision: Boolean(c.isCurrentRevision) })),
    })),
  };
}
