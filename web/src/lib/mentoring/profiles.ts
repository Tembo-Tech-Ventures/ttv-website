import { ChannelError } from "@/lib/channels/errors";
import {
  MentorArea, MentorFormats, MentorRequestFormat,
  type MentorAvailability, type MentorDirectory, type MentorDirectoryItem, type MentorDirectoryQuery, type UpdateMentorAvailability,
} from "@/lib/platform/contracts";
import { capacityOf, monthStart, spotColumns } from "./capacity";
import { personColumns, personRow, personSummary } from "./people";

/**
 * Mentor availability and the directory (README.md beside this file). The MENTOR role comes from the
 * database on every read: a profile outlives a revoked role, and lists nobody without it.
 */

/** The most mentors the directory returns at once. */
export const DIRECTORY_LIMIT = 100;

/** Who is listed, in SQL over the profile alias `p`: the MENTOR role, not paused, a capacity above zero. */
export const LISTED = `p.paused = 0 AND p.monthlyCapacity > 0
  AND EXISTS (SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId WHERE ur.userId = p.userId AND r.name = 'MENTOR')`;

const notMentor = () => new ChannelError("forbidden", "Only mentors have availability.", 403);

/** Strings from a stored JSON array that still pass the contract; anything else is dropped. */
function storedList<T>(text: string, item: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }): T[] {
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      const parsed = item.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  } catch { return []; }
}

function storedFormats(text: string): MentorFormats {
  const formats = MentorFormats.safeParse([...new Set(storedList(text, MentorRequestFormat))]);
  return formats.success ? formats.data : [...MentorRequestFormat.options];
}

interface AvailabilityRow {
  isMentor: number; headline: string | null; bio: string | null; areas: string | null; formats: string | null;
  monthlyCapacity: number | null; paused: number | null; pendingCount: number; acceptedCount: number;
}

/**
 * The caller's own availability, and whether the directory lists them now. Before they first save:
 * an empty headline, no areas, every format, capacity 0, not listed. MENTOR role only (403). One read.
 */
export async function getAvailability(db: D1Database, userId: string, now: number): Promise<MentorAvailability> {
  const row = await db.prepare(`SELECT
      EXISTS (SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId WHERE ur.userId = ?1 AND r.name = 'MENTOR') AS isMentor,
      p.headline, p.bio, p.areas, p.formats, p.monthlyCapacity, p.paused, ${spotColumns("?1", "?2")}
    FROM (SELECT ?1 AS userId) caller LEFT JOIN mentor_profile p ON p.userId = caller.userId`)
    .bind(userId, monthStart(now)).first<AvailabilityRow>();
  if (!row?.isMentor) throw notMentor();
  return availabilityOf(row, now);
}

function availabilityOf(row: AvailabilityRow, now: number): MentorAvailability {
  const limit = row.monthlyCapacity ?? 0;
  const paused = row.paused === 1;
  return {
    headline: row.headline ?? "", bio: row.bio ?? "", areas: storedList(row.areas ?? "[]", MentorArea),
    formats: storedFormats(row.formats ?? "[]"), monthlyCapacity: limit, paused,
    listed: row.headline !== null && !paused && limit > 0,
    capacity: capacityOf({ limit, pending: row.pendingCount, accepted: row.acceptedCount }, now),
  };
}

/**
 * PUT /api/mentoring/availability: the caller saves their own availability, whole. MENTOR role only,
 * checked inside the write (403 when it wrote nothing). Lowering the capacity below the spots already
 * held refuses nobody already waiting: it only stops new requests. Areas are trimmed.
 */
export async function updateAvailability(
  db: D1Database, userId: string, input: UpdateMentorAvailability, now: number,
): Promise<MentorAvailability> {
  const written = await db.prepare(`INSERT INTO mentor_profile
      (userId, headline, bio, areas, formats, monthlyCapacity, paused, createdAt, updatedAt)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8
    WHERE EXISTS (SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId WHERE ur.userId = ?1 AND r.name = 'MENTOR')
    ON CONFLICT (userId) DO UPDATE SET headline = excluded.headline, bio = excluded.bio, areas = excluded.areas,
      formats = excluded.formats, monthlyCapacity = excluded.monthlyCapacity, paused = excluded.paused,
      updatedAt = max(excluded.updatedAt, mentor_profile.createdAt)
    RETURNING userId`)
    .bind(userId, input.headline.trim(), input.bio, JSON.stringify(input.areas.map((area) => area.trim())),
      JSON.stringify(input.formats), input.monthlyCapacity, input.paused ? 1 : 0, now)
    .all<{ userId: string }>();
  if (written.results.length !== 1) throw notMentor();
  return getAvailability(db, userId, now);
}

interface DirectoryRow extends Record<string, unknown> {
  userId: string; headline: string; bio: string; areas: string; formats: string; monthlyCapacity: number;
  pendingCount: number; acceptedCount: number;
}

/**
 * GET /api/mentors: listed mentors other than the caller, those with a spot open first, then by name,
 * at most DIRECTORY_LIMIT.
 * Full mentors stay, with when their next opening is. Only public mentor fields: the person (global
 * badges only), headline, areas, formats, bio and capacity. One statement, with every filter in it so
 * the limit never drops a match. `area` matches one of a mentor's areas ignoring ASCII case, as
 * SQLite's lower() folds it.
 */
export async function listMentors(db: D1Database, viewerId: string, query: MentorDirectoryQuery, now: number): Promise<MentorDirectory> {
  // The spot counts are read once per listed mentor (two index ranges), then filtered and ordered on.
  const { results } = await db.prepare(`WITH listed AS (
      SELECT p.userId, p.headline, p.bio, p.areas, p.formats, p.monthlyCapacity, ${spotColumns("p.userId", "?2")}
      FROM mentor_profile p
      WHERE ${LISTED} AND p.userId <> ?1
        AND (?3 IS NULL OR EXISTS (SELECT 1 FROM json_each(p.areas) a WHERE lower(trim(a.value)) = lower(trim(?3))))
        AND (?4 IS NULL OR EXISTS (SELECT 1 FROM json_each(p.formats) f WHERE f.value = ?4)))
    SELECT l.*, ${personColumns("u", "l.userId", "person")}
    FROM listed l JOIN "user" u ON u.id = l.userId
    WHERE ?6 = 0 OR l.pendingCount + l.acceptedCount < l.monthlyCapacity
    ORDER BY l.pendingCount + l.acceptedCount < l.monthlyCapacity DESC, u.name, l.userId LIMIT ?5`)
    .bind(viewerId, monthStart(now), query.area ?? null, query.format ?? null, DIRECTORY_LIMIT, query.available === true ? 1 : 0)
    .all<DirectoryRow>();
  const items = results.map((row): MentorDirectoryItem => ({
    person: personSummary(row.userId, personRow(row, "person")),
    headline: row.headline.trim(), areas: storedList(row.areas, MentorArea), formats: storedFormats(row.formats), bio: row.bio,
    capacity: capacityOf({ limit: row.monthlyCapacity, pending: row.pendingCount, accepted: row.acceptedCount }, now), paused: false,
  }));
  return { items };
}
