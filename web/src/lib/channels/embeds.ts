import {
  MessageEmbed,
  type ChannelShareables, type EmbedRef, type MessageEmbedView, type ProjectConfirmation, type ProjectEmbed,
  type SessionClipEmbed, type ShareablesQuery,
} from "@/lib/platform/contracts";
import { ChannelError } from "./errors";
import type { ReadContext } from "./messages";

/**
 * Work shared in messages (README.md beside this file, "Embeds"). A post sends references; the
 * server resolves them once, stores what the reader will see, and checks again on every read, so a
 * project made private or a recording moved out of the cohort becomes a neutral "unavailable" card.
 *
 * - A project is the poster's own published (not private) project at its current revision. Its
 *   owner sharing it is the consent for the channel's readers; nobody shares another person's work.
 * - A session clip is shared only where every reader can see the recording: that program's own
 *   cohort channels (canShareSessionClip), from a complete recording with a transcript there.
 * - Link previews are off in v1.
 */

/** A clip offered by the attach tools runs this long, or to the end of the session. */
export const CLIP_SECONDS = 60;
/** What a clip may run past the recording's stored duration, which is rounded. */
const END_TOLERANCE_SECONDS = 1;
const TITLE_LIMIT = 300;
const SUMMARY_LIMIT = 500;
const QUOTE_LIMIT = 280;
/**
 * Attach-tool list sizes; ChannelShareables caps them on the wire. searchedSessions bounds `q`: it
 * reads the transcripts of the cohort's newest complete sessions only, because a substring match
 * cannot use an index.
 */
export const SHAREABLE_LIMITS = Object.freeze({ projects: 50, recentSessions: 10, moments: 20, searchedSessions: 50 });

const PROJECT_REFUSED = "This project can't be shared here.";
const CLIP_REFUSED = "Session clips can only be shared in that cohort's own channels.";

/** At most `limit` characters, cut at a word where one is near, with an ellipsis when cut. */
function shorten(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Transcript segments as SQL returns them: [startTime, id, text]. */
type Segment = [number, string, string];
const isSegment = (value: unknown): value is Segment => Array.isArray(value) && typeof value[0] === "number"
  && typeof value[1] === "string" && typeof value[2] === "string";

/** json_group_array output, also when a subquery has turned nested JSON into text. */
function jsonList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/** What was said in a clip's window, in order: the quotation a clip card shows. */
function quotation(segments: unknown): string {
  const text = jsonList(segments).filter(isSegment)
    .toSorted((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])).map(([, , words]) => words).join(" ");
  return shorten(text, QUOTE_LIMIT);
}

/**
 * Segments overlapping a clip's window [start, start + duration). ?start and ?end are SQL
 * expressions for the window, `recording` the recording's id. Driven by the (recordingId,
 * startTime) index.
 */
const segmentsIn = (recording: string, start: string, end: string) => `(SELECT json_group_array(json_array(s.startTime, s.id, s.text))
  FROM transcript_segment s WHERE s.recordingId = ${recording} AND s.startTime < ${end} AND s.endTime > ${start})`;

/** Confirmations as SQL returns them: [mentorId, mentorName, journeyVersion]. */
type ConfirmationRow = [string, string | null, number];
const isConfirmation = (value: unknown): value is ConfirmationRow => Array.isArray(value) && typeof value[0] === "string"
  && (typeof value[1] === "string" || value[1] === null) && Number.isInteger(value[2]);

/**
 * Each mentor's latest confirmation at or before the shared revision, with the revision it
 * confirmed: newest first, then by name. A confirmation of a later revision is not about this one.
 */
function confirmations(rows: unknown): ProjectConfirmation[] {
  const latest = new Map<string, ProjectConfirmation>();
  for (const [mentorId, name, version] of jsonList(rows).filter(isConfirmation)) {
    const mentorName = name?.trim() || "Mentor";
    const known = latest.get(mentorId);
    if (!known || version > known.version) latest.set(mentorId, { mentorId, mentorName, version });
  }
  return [...latest.values()].toSorted((a, b) => b.version - a.version || a.mentorName.localeCompare(b.mentorName));
}

/** ?version is the shared revision, `journey` the journey's id column. */
const confirmationsOf = (journey: string, version: string) => `(SELECT json_group_array(json_array(c.mentorId, cu.name, c.journeyVersion))
  FROM communityConfirmation c JOIN "user" cu ON cu.id = c.mentorId WHERE c.journeyId = ${journey} AND c.journeyVersion <= ${version})`;

interface JourneyRow { id: string; version: number; title: string; description: string; confirmations?: unknown }

function projectEmbed(row: JourneyRow): ProjectEmbed {
  return {
    type: "project", journeyId: row.id, version: row.version,
    title: shorten(row.title, TITLE_LIMIT) || "Untitled project", summary: shorten(row.description, SUMMARY_LIMIT),
    // Projects carry no skills of their own; the owner's profile skills are not this project's.
    // No link until TTV has a project page every reader can open (coordinator E3): shared work never
    // links out of TTV (owner decision 6), so the evidence URL is not shared at all.
    skills: [], link: null, confirmations: confirmations(row.confirmations),
  };
}

/** The window of a clip that starts at `start`: CLIP_SECONDS, or up to the session's end. 0 when none is left. */
function clipLength(start: number, recordingSeconds: number | null): number {
  return recordingSeconds === null ? CLIP_SECONDS : Math.max(0, Math.min(CLIP_SECONDS, recordingSeconds - start));
}

function clipEmbed(recordingId: string, title: string, startSeconds: number, durationSeconds: number, segments: unknown): SessionClipEmbed | null {
  const quote = quotation(segments);
  if (!quote || durationSeconds <= 0) return null;
  return { type: "sessionClip", recordingId, title: shorten(title, TITLE_LIMIT) || "Session recording", startSeconds, durationSeconds, quote };
}

const sameRef = (a: EmbedRef, b: EmbedRef) => a.type === "project" && b.type === "project"
  ? a.journeyId === b.journeyId && a.version === b.version
  : a.type === "sessionClip" && b.type === "sessionClip" && a.recordingId === b.recordingId
    && a.startSeconds === b.startSeconds && a.durationSeconds === b.durationSeconds;

/** The reference a stored embed was resolved from, for comparing a repeated post with the original. */
export function refOf(embed: MessageEmbed): EmbedRef {
  return embed.type === "project"
    ? { type: "project", journeyId: embed.journeyId, version: embed.version }
    : { type: "sessionClip", recordingId: embed.recordingId, startSeconds: embed.startSeconds, durationSeconds: embed.durationSeconds };
}

/** Whether two lists name the same work in the same order. */
export const sameRefs = (a: readonly EmbedRef[], b: readonly EmbedRef[]) =>
  a.length === b.length && a.every((ref, i) => sameRef(ref, b[i]!));

interface ResolvedRow {
  position: number;
  ownerId: string | null; visibility: string | null; currentVersion: number | null;
  journeyTitle: string | null; description: string | null;
  programId: string | null; processingStatus: string | null; recordingTitle: string | null;
  recordingSeconds: number | null; segments: unknown;
}

function resolveProject(ctx: ReadContext, ref: Extract<EmbedRef, { type: "project" }>, row: ResolvedRow): MessageEmbed {
  // A missing project and another person's give the same answer, so neither is confirmed to exist.
  if (row.ownerId !== ctx.viewerId) throw new ChannelError("validation", PROJECT_REFUSED, 400);
  if (row.visibility !== "institution") {
    throw new ChannelError("validation", "This project is a private draft. Publish it before you share it.", 400);
  }
  if (row.currentVersion !== ref.version) {
    throw new ChannelError("conflict", "This project has changed since you picked it. Pick it again to share the latest revision.", 409);
  }
  return projectEmbed({
    id: ref.journeyId, version: ref.version, title: row.journeyTitle ?? "", description: row.description ?? "", confirmations: [],
  });
}

function resolveClip(ctx: ReadContext, ref: Extract<EmbedRef, { type: "sessionClip" }>, row: ResolvedRow): MessageEmbed {
  // A missing recording and another cohort's give the same answer.
  if (row.programId === null || row.programId !== ctx.channel.programId) throw new ChannelError("validation", CLIP_REFUSED, 400);
  if (row.processingStatus !== "complete") throw new ChannelError("validation", "This session isn't ready to share yet.", 400);
  if (row.recordingSeconds !== null && ref.startSeconds + ref.durationSeconds > row.recordingSeconds + END_TOLERANCE_SECONDS) {
    throw new ChannelError("validation", "That clip runs past the end of the session.", 400);
  }
  const clip = clipEmbed(ref.recordingId, row.recordingTitle ?? "", ref.startSeconds, ref.durationSeconds, row.segments);
  if (!clip) throw new ChannelError("validation", "There's no transcript at that moment of the session to quote.", 400);
  return clip;
}

/**
 * The text the moderation screen sees for a post: its body, then the title and summary of each
 * project it shares, which every reader sees too and nothing else screens (projects are not
 * moderated where they are written). Clip quotations are the session's own words, not the poster's.
 */
export function screeningText(body: string, embeds: readonly MessageEmbed[]): string {
  return [body, ...embeds.flatMap((embed) => embed.type === "project" ? [embed.title, embed.summary] : [])]
    .filter((text) => text !== "").join("\n\n");
}

/**
 * Resolves a post's references into the embeds stored with it, in one statement (none without
 * embeds). Refusals, in order: the same work twice (400); a clip outside that program's own cohort
 * channels (400, before reading anything); then each reference in turn: a project that is missing or
 * someone else's (400, one answer for both), a private draft (400), a revision that is not the
 * current one (409); a recording that is missing or another cohort's (400, one answer), not
 * complete, a clip past its end or with no transcript to quote (400).
 */
export async function resolveEmbeds(ctx: ReadContext, refs: readonly EmbedRef[]): Promise<MessageEmbed[]> {
  if (refs.length === 0) return [];
  if (refs.some((ref, i) => refs.findIndex((other) => sameRef(ref, other)) !== i)) {
    throw new ChannelError("validation", "Each item can be attached once.", 400);
  }
  if (refs.some((ref) => ref.type === "sessionClip") && !ctx.channel.capabilities.canShareSessionClip) {
    throw new ChannelError("validation", CLIP_REFUSED, 400);
  }
  const ref = (path: string) => `json_extract(e.value, '$.${path}')`;
  const { results } = await ctx.db.prepare(`SELECT e.key AS position,
      j.userId AS ownerId, j.visibility, j.version AS currentVersion, j.title AS journeyTitle, j.description,
      r.programId, r.processingStatus, r.title AS recordingTitle, r.durationSeconds AS recordingSeconds,
      CASE WHEN r.id IS NULL THEN NULL ELSE ${segmentsIn("r.id", ref("startSeconds"), `${ref("startSeconds")} + ${ref("durationSeconds")}`)} END AS segments
    FROM json_each(?1) e
    LEFT JOIN communityJourney j ON ${ref("type")} = 'project' AND j.id = ${ref("journeyId")}
    LEFT JOIN recording r ON ${ref("type")} = 'sessionClip' AND r.id = ${ref("recordingId")}
    ORDER BY e.key`).bind(JSON.stringify(refs)).all<ResolvedRow>();
  return refs.map((item, i) => {
    const row = results.find((result) => result.position === i);
    if (!row) throw new Error("An embed reference resolved to no row.");
    return item.type === "project" ? resolveProject(ctx, item, row) : resolveClip(ctx, item, row);
  });
}

/**
 * Per stored embed, whether this reader may still see it, in one correlated column of the page's
 * own statement: a JSON array with null where the work is gone, and otherwise, for a project, its
 * confirmations at or before the shared revision. ?3 is the channel's program. A project must still
 * exist, belong to the message's author and be published; a recording must still be complete and in
 * this channel's cohort. Every reader of a cohort channel can see that cohort's recordings, so the
 * channel decides for all of them. Deleted messages carry no embeds and cost nothing here.
 */
export const EMBED_ACCESS_COLUMN = `(SELECT json_group_array(CASE json_extract(e.value, '$.type')
    WHEN 'project' THEN (SELECT ${confirmationsOf("j.id", "json_extract(e.value, '$.version')")} FROM communityJourney j
      WHERE j.id = json_extract(e.value, '$.journeyId') AND j.userId = m.authorId AND j.visibility = 'institution')
    WHEN 'sessionClip' THEN (SELECT json_array() FROM recording r
      WHERE r.id = json_extract(e.value, '$.recordingId') AND r.programId = ?3 AND r.processingStatus = 'complete')
  END) FROM json_each(CASE WHEN m.deletedAt IS NULL AND json_valid(m.embeds) THEN m.embeds ELSE '[]' END) e) AS embedAccess`;

/**
 * The embeds as this reader sees them: stored work they may still see (a project with its current
 * confirmations), and a neutral "unavailable" card in place of anything they no longer may.
 * Malformed stored entries are dropped.
 */
export function embedsForReader(stored: unknown[], access: string | null): MessageEmbedView[] {
  const checks = jsonList(access);
  return stored.flatMap((value, i): MessageEmbedView[] => {
    const embed = MessageEmbed.safeParse(value);
    if (!embed.success) return [];
    const check = checks[i];
    if (check === null || check === undefined) return [{ type: "unavailable", kind: embed.data.type }];
    return [embed.data.type === "project" ? { ...embed.data, confirmations: confirmations(check) } : embed.data];
  });
}

/**
 * What the caller can attach in this channel (the composer's attach tools). Nothing where they cannot
 * post. Projects: their own published projects at the current revision, most recently changed first.
 * Clips, only where canShareSessionClip: a CLIP_SECONDS clip from the start of each of the newest
 * complete recordings with a transcript there, or with `q`, from each transcript moment that mentions
 * it. Every item posts as offered while nothing changes. One statement for projects, one for clips.
 */
export async function listShareables(ctx: ReadContext, query: ShareablesQuery = {}): Promise<ChannelShareables> {
  if (!ctx.channel.capabilities.canPost) return { projects: [], clips: [] };
  const [projects, clips] = await Promise.all([shareableProjects(ctx), shareableClips(ctx, query.q)]);
  return { projects, clips };
}

async function shareableProjects(ctx: ReadContext): Promise<ProjectEmbed[]> {
  const { results } = await ctx.db.prepare(`SELECT j.id, j.version, j.title, j.description,
      ${confirmationsOf("j.id", "j.version")} AS confirmations
    FROM communityJourney j WHERE j.userId = ?1 AND j.visibility = 'institution'
    ORDER BY j.updatedAt DESC, j.id LIMIT ?2`).bind(ctx.viewerId, SHAREABLE_LIMITS.projects).all<JourneyRow>();
  return results.map(projectEmbed);
}

interface MomentRow { recordingId: string; title: string; recordingSeconds: number | null; startSeconds: number; segments: unknown }

async function shareableClips(ctx: ReadContext, q: string | undefined): Promise<SessionClipEmbed[]> {
  const programId = ctx.channel.programId;
  if (!ctx.channel.capabilities.canShareSessionClip || programId === null) return [];
  // The window is [start, start + CLIP_SECONDS), cut at the session's end, as clipLength computes it.
  const end = `min(m.startSeconds + ${CLIP_SECONDS}, coalesce(m.recordingSeconds, m.startSeconds + ${CLIP_SECONDS}))`;
  const recordings = (r: string) => `SELECT ${r}.id AS recordingId, ${r}.title, ${r}.durationSeconds AS recordingSeconds,
    coalesce(${r}.recordedAt, ${r}.createdAt) AS newest`;
  const moments = q === undefined
    ? `${recordings("r")}, 0 AS startSeconds FROM recording r WHERE r.programId = ?1 AND r.processingStatus = 'complete'
          AND EXISTS (SELECT 1 FROM transcript_segment s WHERE s.recordingId = r.id AND s.startTime < ${CLIP_SECONDS})
        ORDER BY newest DESC, r.id LIMIT ?2`
    // Case-insensitive substring, as in platform search; instr has no wildcards to escape. Only the
    // newest sessions' transcripts are read (?4).
    : `${recordings("recent")}, CAST(s.startTime AS INTEGER) AS startSeconds
        FROM (SELECT * FROM recording WHERE programId = ?1 AND processingStatus = 'complete'
          ORDER BY coalesce(recordedAt, createdAt) DESC, id LIMIT ?4) recent
        JOIN transcript_segment s ON s.recordingId = recent.id
        WHERE s.startTime >= 0 AND instr(lower(s.text), lower(?3)) > 0
          AND (recent.durationSeconds IS NULL OR s.startTime < recent.durationSeconds)
        ORDER BY newest DESC, recent.id, s.startTime, s.id LIMIT ?2`;
  const { results } = await ctx.db.prepare(`WITH m AS (${moments})
    SELECT m.recordingId, m.title, m.recordingSeconds, m.startSeconds, ${segmentsIn("m.recordingId", "m.startSeconds", end)} AS segments
    FROM m ORDER BY m.newest DESC, m.recordingId, m.startSeconds`)
    .bind(programId, ...q === undefined ? [SHAREABLE_LIMITS.recentSessions] : [SHAREABLE_LIMITS.moments, q, SHAREABLE_LIMITS.searchedSessions])
    .all<MomentRow>();
  const seen = new Set<string>();
  return results.flatMap((row) => {
    // Several matches in one window make the same clip; offer it once.
    const key = `${row.recordingId}:${row.startSeconds}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const clip = clipEmbed(row.recordingId, row.title, row.startSeconds, clipLength(row.startSeconds, row.recordingSeconds), row.segments);
    return clip ? [clip] : [];
  });
}
