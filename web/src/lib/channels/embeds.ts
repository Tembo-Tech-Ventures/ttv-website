import { memberEligibility, postedWorkEligibility } from "@/lib/community/eligibility";
import { memberWorkHref } from "@/lib/members/links";
import { cohortAudience, cohortAudienceSql, recordingAccessFor, transcriptReady, transcriptReadySql } from "@/lib/recordings/access";
import { meetingCard } from "@/lib/meetings/card-state";
import { proposalCard } from "@/lib/meetings/proposal-card";
import {
  CallProposalEmbed, ExternalLink, MeetingEmbed, MessageEmbed,
  type ChannelShareables, type EmbedRef, type MessageEmbedView, type ProjectConfirmation, type ProjectEmbed,
  type ProjectEmbedRef, type SessionClipEmbed, type ShareablesQuery,
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
 *   cohort channels (canShareSessionClip), from a complete recording with a transcript there that the
 *   recording access policy shows the whole cohort (lib/recordings/access.ts, cohortAudience).
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

/** The project's own evidence page, when it is an https link without credentials a reader can safely open. */
function evidenceLink(url: string | null): string | null {
  if (!url) return null;
  const link = ExternalLink.safeParse(url);
  return link.success && /^https:\/\//i.test(link.data) ? link.data : null;
}

/** Transcript segments as SQL returns them: [startTime, id, text]. */
type Segment = [number, string, string];
const isSegment = (value: unknown): value is Segment => Array.isArray(value) && typeof value[0] === "number"
  && typeof value[1] === "string" && typeof value[2] === "string";

/**
 * Nested JSON as it reaches us, also when a subquery has turned it into text: SQLite 3.54 (Node
 * 22.23.5's node:sqlite) no longer carries the JSON subtype out of a scalar subquery, so an object
 * a subquery builds arrives inside json_group_array as a string. Text that isn't JSON stays as it is.
 */
function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}

/** json_group_array output, also when a subquery has turned nested JSON into text. */
function jsonList(value: unknown): unknown[] {
  const parsed = jsonValue(value);
  return Array.isArray(parsed) ? parsed : [];
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
export const confirmationsOf = (journey: string, version: string) => `(SELECT json_group_array(json_array(c.mentorId, cu.name, c.journeyVersion))
  FROM communityConfirmation c JOIN "user" cu ON cu.id = c.mentorId WHERE c.journeyId = ${journey} AND c.journeyVersion <= ${version})`;

interface JourneyRow { id: string; version: number; title: string; description: string; evidenceUrl: string | null; confirmations?: unknown }

function projectEmbed(row: JourneyRow): ProjectEmbed {
  return {
    type: "project", journeyId: row.id, version: row.version,
    title: shorten(row.title, TITLE_LIMIT) || "Untitled project", summary: shorten(row.description, SUMMARY_LIMIT),
    // Projects carry no skills of their own; the owner's profile skills are not this project's.
    skills: [], link: evidenceLink(row.evidenceUrl), confirmations: confirmations(row.confirmations),
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
  ownerId: string | null; posted: number | null; state?: string;
  moderationOutcome?: string;
  moderatorHidden?: number;
  currentVersion: number | null;
  journeyTitle: string | null; description: string | null; evidenceUrl: string | null;
  recordingId: string | null; programId: string | null; accessScope: string | null;
  recordingDeletedAt: number | null; recordingHiddenAt: number | null;
  processingStatus: string | null; recordingTitle: string | null;
  recordingSeconds: number | null; segments: unknown;
}

type ProjectRow = Pick<ResolvedRow, "ownerId" | "posted" | "state"
  | "moderationOutcome"
  | "moderatorHidden"
  | "currentVersion" | "journeyTitle" | "description" | "evidenceUrl">;

function resolveProject(ownerId: string, ref: ProjectEmbedRef, row: ProjectRow): ProjectEmbed {
  // A missing project and another person's give the same answer, so neither is confirmed to exist.
  if (row.ownerId !== ownerId) throw new ChannelError("validation", PROJECT_REFUSED, 400);
  if (!row.posted) {
    const reason = row.moderatorHidden
      ? "A moderator took this work down."
      : row.moderationOutcome === "hold"
        ? "This work is held for a human review."
        : row.state === "DRAFT"
          ? "This project is a private draft. Publish it before you share it."
          : "This work cannot be shared while its profile is unavailable.";
    throw new ChannelError("validation", reason, 400);
  }
  if (row.currentVersion !== ref.version) {
    throw new ChannelError("conflict", "This project has changed since you picked it. Pick it again to share the latest revision.", 409);
  }
  return projectEmbed({
    id: ref.journeyId, version: ref.version, title: row.journeyTitle ?? "", description: row.description ?? "",
    evidenceUrl: row.evidenceUrl, confirmations: [],
  });
}

function resolveClip(ctx: ReadContext, ref: Extract<EmbedRef, { type: "sessionClip" }>, row: ResolvedRow): MessageEmbed {
  // A missing recording and one not every reader of this cohort channel may see give the same answer.
  const program = ctx.channel.programId;
  if (row.recordingId === null || row.accessScope === null || program === null || !recordingAccessFor(cohortAudience(program), {
    programId: row.programId, accessScope: row.accessScope, deletedAt: row.recordingDeletedAt, hiddenAt: row.recordingHiddenAt,
  }, { userId: null })) throw new ChannelError("validation", CLIP_REFUSED, 400);
  if (row.processingStatus === null || !transcriptReady({ processingStatus: row.processingStatus })) throw new ChannelError("validation", "This session isn't ready to share yet.", 400);
  if (row.recordingSeconds !== null && ref.startSeconds + ref.durationSeconds > row.recordingSeconds + END_TOLERANCE_SECONDS) {
    throw new ChannelError("validation", "That clip runs past the end of the session.", 400);
  }
  const clip = clipEmbed(ref.recordingId, row.recordingTitle ?? "", ref.startSeconds, ref.durationSeconds, row.segments);
  if (!clip) throw new ChannelError("validation", "There's no transcript at that moment of the session to quote.", 400);
  return clip;
}

/**
 * The text the moderation screen sees for a post: its body, then the title, summary and link of each
 * project it shares, which every reader sees too and nothing else screens (projects are not
 * moderated where they are written), so contact details and invite links there are flagged like
 * those in the body. Clip quotations are the session's own words, not the poster's.
 */
export function screeningText(body: string, embeds: readonly MessageEmbed[]): string {
  return [body, ...embeds.flatMap((embed) => embed.type === "project" ? [embed.title, embed.summary, embed.link ?? ""] : [])]
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
      j.userId AS ownerId, ${postedWorkEligibility("j", true)} AS posted, j.state,j.moderationOutcome,j.moderatorHidden, j.version AS currentVersion, j.title AS journeyTitle, j.description, j.evidenceUrl,
      r.id AS recordingId, r.programId, r.accessScope, r.deletedAt AS recordingDeletedAt, r.hiddenAt AS recordingHiddenAt,
      r.processingStatus, r.title AS recordingTitle, r.durationSeconds AS recordingSeconds,
      CASE WHEN r.id IS NULL THEN NULL ELSE ${segmentsIn("r.id", ref("startSeconds"), `${ref("startSeconds")} + ${ref("durationSeconds")}`)} END AS segments
    FROM json_each(?1) e
    LEFT JOIN communityJourney j ON ${ref("type")} = 'project' AND j.id = ${ref("journeyId")}
    LEFT JOIN recording r ON ${ref("type")} = 'sessionClip' AND r.id = ${ref("recordingId")}
    ORDER BY e.key`).bind(JSON.stringify(refs)).all<ResolvedRow>();
  return refs.map((item, i) => {
    const row = results.find((result) => result.position === i);
    if (!row) throw new Error("An embed reference resolved to no row.");
    return item.type === "project" ? resolveProject(ctx.viewerId, item, row) : resolveClip(ctx, item, row);
  });
}

/**
 * Work its owner attaches outside a channel (a mentor request, src/lib/mentoring): the same checks
 * and refusals as sharing it in a post, in one read. Readers check it again (embedAccessColumn's
 * rule: still the owner's, still published).
 */
export async function resolveOwnProject(db: D1Database, ownerId: string, ref: ProjectEmbedRef): Promise<ProjectEmbed> {
  const row = await db.prepare(`SELECT userId AS ownerId, ${postedWorkEligibility("j", true)} AS posted, j.state,j.moderationOutcome,j.moderatorHidden, version AS currentVersion, title AS journeyTitle, description, evidenceUrl
    FROM communityJourney j WHERE id = ?1`).bind(ref.journeyId).first<ProjectRow>();
  return resolveProject(ownerId, ref, row ?? { ownerId: null, posted: null, currentVersion: null, journeyTitle: null, description: null, evidenceUrl: null });
}

/**
 * A call's card as its channel reads it (lib/meetings/cards.ts), for embedAccessColumn: the call, in the
 * message's own channel, with how its recording stands. The recording is read as the channel's whole
 * audience (cohortAudienceSql: the cohort's own, neither deleted nor hidden), as clips are, so a hidden
 * recording leaves every reader's card at once; `linked` says one exists at all, so a hidden one is
 * never called "not recorded". Only the call's own card message (`meeting.messageId`) shows it, so a
 * second card a race posted shows nothing. `meeting` is the call's id and `program` the channel's
 * program, as SQL.
 */
const meetingCardColumn = (meeting: string, program: string) => `(SELECT json_object('purpose', mt.purpose, 'title', mt.title, 'state', mt.state,
      'scheduledStartAt', mt.scheduledStartAt, 'bookedMinutes', mt.bookedMinutes, 'openedAt', mt.openedAt, 'endedAt', mt.endedAt,
      'capture', (SELECT mr.state FROM meeting_recording mr WHERE mr.meetingId = mt.id),
      'linked', EXISTS (SELECT 1 FROM recording lr WHERE lr.meetingId = mt.id),
      'recording', (SELECT json_array(r.id, r.r2VideoKey IS NOT NULL, ${transcriptReadySql("r")}, r.processingStatus = 'failed') FROM recording r
        WHERE r.meetingId = mt.id AND ${cohortAudienceSql("r", program)} ORDER BY coalesce(r.recordedAt, r.createdAt) DESC, r.id LIMIT 1))
    FROM meeting mt WHERE mt.id = ${meeting} AND mt.channelId = m.channelId AND mt.messageId = m.id)`;

/**
 * A suggested call's card as its conversation reads it (lib/meetings/proposals.ts, proposal-card.ts):
 * the suggestion, in the message's own channel and only on its own card message, with the call it
 * booked or would move. A check-in's work is named only while it is still posted. "countered" is a
 * declined suggestion the other person answered with times of their own, in the same write: their
 * suggestion was made at the very moment this one was declined (proposals.ts suggestCall).
 * `proposal` is the suggestion's id as SQL.
 */
const proposalCardColumn = (proposal: string) => `(SELECT json_object('purpose', cp.purpose, 'state', cp.state,
      'proposedBy', cp.proposedBy, 'times', json(cp.times), 'bookedMinutes', cp.bookedMinutes, 'askToRecord', cp.askToRecord,
      'countered', cp.state = 'DECLINED' AND EXISTS (SELECT 1 FROM call_proposal n WHERE n.channelId = cp.channelId
        AND n.createdAt = cp.decidedAt AND n.proposedBy <> cp.proposedBy),
      'work', (SELECT json_array(j.title, cp.journeyVersion) FROM communityJourney j
        WHERE j.id = cp.journeyId AND ${postedWorkEligibility("j", true)}),
      'call', (SELECT json_array(mt.id, mt.state, mt.scheduledStartAt) FROM meeting mt WHERE mt.id = cp.meetingId AND mt.channelId = cp.channelId))
    FROM call_proposal cp WHERE cp.id = ${proposal} AND cp.channelId = m.channelId AND cp.messageId = m.id)`;

/**
 * Per stored embed, whether this reader may still see it, in one correlated column of the page's
 * own statement: a JSON array with null where the work is gone, and otherwise, for a project, its
 * confirmations at or before the shared revision. ?3 is the channel's program. A project must still
 * exist, belong to the message's author and be published; a recording must still be complete, and one
 * every reader of this cohort channel may see (the recording access policy's cohort audience: the
 * cohort's own, neither deleted nor hidden), so the channel decides for all of them. Deleted messages carry no embeds and cost nothing here. A project's
 * author handle comes only while the Members directory lists them: staff-shared work has no member page.
 */
export const embedAccessColumn = (program: string) => `(SELECT json_group_array(CASE json_extract(e.value, '$.type')
    WHEN 'project' THEN (SELECT json_object('confirmations', json(${confirmationsOf("j.id", "json_extract(e.value, '$.version')")}),
        'handle', (SELECT p.handle FROM studentProfile p WHERE p.userId = j.userId AND ${memberEligibility("p.userId")})) FROM communityJourney j
      WHERE j.id = json_extract(e.value, '$.journeyId') AND j.userId = m.authorId AND ${postedWorkEligibility("j", true)})
    WHEN 'sessionClip' THEN (SELECT json_array() FROM recording r
      WHERE r.id = json_extract(e.value, '$.recordingId') AND ${cohortAudienceSql("r", program)} AND ${transcriptReadySql("r")})
    WHEN 'meeting' THEN ${meetingCardColumn("json_extract(e.value, '$.meetingId')", program)}
    WHEN 'callProposal' THEN ${proposalCardColumn("json_extract(e.value, '$.proposalId')")}
  END) FROM json_each(CASE WHEN m.deletedAt IS NULL AND json_valid(m.embeds) THEN m.embeds ELSE '[]' END) e) AS embedAccess`;

/**
 * A project's access check: its confirmations, and its owner's handle where the check carries one
 * (embedAccessColumn's object, which a newer SQLite hands over as text). A bare list of
 * confirmations (a mentor request's) has no handle.
 */
function projectAccess(stored: unknown): { rows: unknown; handle: string | null } {
  const check = jsonValue(stored);
  if (check && typeof check === "object" && !Array.isArray(check) && "confirmations" in check) {
    const { confirmations: rows, handle } = check as { confirmations: unknown; handle?: unknown };
    return { rows, handle: typeof handle === "string" && handle ? handle : null };
  }
  return { rows: check, handle: null };
}

/**
 * The embeds as this reader sees them: stored work they may still see (a project with its current
 * confirmations, and the way to it on its owner's member page), a call's card as the call stands now,
 * and a neutral "unavailable" card in place of anything they no longer may. Malformed stored entries,
 * and a card whose call is gone or in another channel, are dropped.
 */
export function embedsForReader(stored: unknown[], access: string | null): MessageEmbedView[] {
  const checks = jsonList(access);
  return stored.flatMap((value, i): MessageEmbedView[] => {
    const card = MeetingEmbed.safeParse(value);
    if (card.success) {
      const view = meetingCard(card.data.meetingId, jsonValue(checks[i]));
      return view ? [view] : [];
    }
    const proposal = CallProposalEmbed.safeParse(value);
    if (proposal.success) {
      const view = proposalCard(proposal.data.proposalId, jsonValue(checks[i]));
      return view ? [view] : [];
    }
    const embed = MessageEmbed.safeParse(value);
    if (!embed.success) return [];
    const check = checks[i];
    if (check === null || check === undefined) return [{ type: "unavailable", was: embed.data.type }];
    if (embed.data.type !== "project") return [embed.data];
    const { rows, handle } = projectAccess(check);
    return [{
      ...embed.data, confirmations: confirmations(rows),
      ...(handle ? { memberHref: memberWorkHref({ handle }, embed.data.journeyId) } : {}),
    }];
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

function shareableProjects(ctx: ReadContext): Promise<ProjectEmbed[]> {
  return listOwnProjects(ctx.db, ctx.viewerId);
}

/**
 * The person's own published projects at their current revision, most recently changed first, at
 * most SHAREABLE_LIMITS.projects: what they can attach anywhere, a channel or a mentor request
 * (resolveOwnProject checks the pick again). One statement.
 */
export async function listOwnProjects(db: D1Database, userId: string): Promise<ProjectEmbed[]> {
  const { results } = await db.prepare(`SELECT j.id, j.version, j.title, j.description, j.evidenceUrl,
      ${confirmationsOf("j.id", "j.version")} AS confirmations
    FROM communityJourney j WHERE j.userId = ?1 AND ${postedWorkEligibility("j", true)}
    ORDER BY j.updatedAt DESC, j.id LIMIT ?2`).bind(userId, SHAREABLE_LIMITS.projects).all<JourneyRow>();
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
    ? `${recordings("r")}, 0 AS startSeconds FROM recording r WHERE ${cohortAudienceSql("r", "?1")} AND ${transcriptReadySql("r")}
          AND EXISTS (SELECT 1 FROM transcript_segment s WHERE s.recordingId = r.id AND s.startTime < ${CLIP_SECONDS})
        ORDER BY newest DESC, r.id LIMIT ?2`
    // Case-insensitive substring, as in platform search; instr has no wildcards to escape. Only the
    // newest sessions' transcripts are read (?4).
    : `${recordings("recent")}, CAST(s.startTime AS INTEGER) AS startSeconds
        FROM (SELECT * FROM recording r WHERE ${cohortAudienceSql("r", "?1")} AND ${transcriptReadySql("r")}
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
