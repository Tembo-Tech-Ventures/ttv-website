import { z } from "zod";
import {
  Citation, ReactionKind, WebLink,
  type AuthorSummary, type Channel, type Message, type MessageList, type MessageListQuery,
  type ModerationState, type Reaction, type RoleBadge,
} from "@/lib/platform/contracts";
import { CursorExpiredError, decodeCursor, encodeCursor } from "./cursor";
import { embedAccessColumn, embedsForReader } from "./embeds";
import { ChannelError } from "./errors";

/**
 * Reading messages (README.md beside this file, "Reading messages"). Raw D1 SQL, because one
 * statement returns a whole page: each message with its author, display badges, reactions and
 * thread summary, plus the channel's change head for the next `since` checkpoint, all from one
 * consistent snapshot. Callers have already decided that the viewer can read `channel`
 * (findChannelById / findReadableChannel); this module only applies per-message visibility.
 */

/** Messages per page, matching the channel store's page size. */
export const PAGE_SIZE = 50;
/** Changes per `since` poll. A longer backlog continues on the next poll. */
export const SINCE_LIMIT = 100;
/** Thread participants listed on a root message. */
const PARTICIPANT_LIMIT = 10;

export { ChannelError } from "./errors";

/** Who is reading, and the channel they may read (with their capabilities in it). */
export interface ReadContext {
  db: D1Database;
  viewerId: string;
  channel: Pick<Channel, "id" | "kind" | "programId" | "capabilities">;
}

export interface MessageRow {
  id: string; channelId: string; parentId: string | null; seq: number; changeSeq: number;
  authorKind: "USER" | "TEMBO"; authorId: string | null; clientNonce: string | null; body: string;
  embeds: string; citations: string; moderationState: ModerationState; moderationReasons: string;
  editedAt: number | null; deletedAt: number | null; createdAt: number;
  authorName: string | null; authorImage: string | null; programName: string | null;
  globalRoles: string; programRoles: string; applications: string; reactions: string; thread: string | null;
  embedAccess: string | null;
  /** 0 or 1 on a HIDDEN message for its author or an admin; null otherwise. */
  reviewRequested: number | null;
}

/**
 * Every column a Message needs. Parameters: ?2 viewer id, and `program`, the SQL for the channel's
 * program (null outside cohort channels: ?3 for one channel's pages), so cohort roles only ever
 * describe this cohort. The thread summary counts replies everyone can see, so it is the same for
 * every reader. Embeds are checked again here, in the same statement (embeds.ts).
 */
export const messageColumns = (program: string) => `m.id, m.channelId, m.parentId, m.seq, m.changeSeq, m.authorKind, m.authorId, m.clientNonce,
  m.body, m.embeds, m.citations, m.moderationState, m.moderationReasons, m.editedAt, m.deletedAt, m.createdAt,
  u.name AS authorName, u.image AS authorImage,
  (SELECT name FROM program WHERE id = ${program}) AS programName,
  (SELECT json_group_array(r.name) FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId
    WHERE ur.userId = m.authorId AND r.name IN ('ADMIN', 'MENTOR', 'INSTITUTION')) AS globalRoles,
  (SELECT json_group_array(pr.name) FROM programRole pr WHERE pr.userId = m.authorId AND pr.programId = ${program}) AS programRoles,
  (SELECT json_group_array(pa.status) FROM programApplication pa WHERE pa.userId = m.authorId AND pa.programId = ${program}) AS applications,
  (SELECT json_group_array(json_array(x.kind, x.n, x.mine)) FROM (SELECT kind, COUNT(*) AS n, MAX(userId = ?2) AS mine
    FROM message_reaction WHERE messageId = m.id GROUP BY kind) x) AS reactions,
  CASE WHEN m.parentId IS NULL THEN (SELECT json_array(COUNT(*), MAX(t.createdAt), json_group_array(DISTINCT t.authorId))
    FROM channel_message t WHERE t.channelId = m.channelId AND t.parentId = m.id
      AND t.deletedAt IS NULL AND t.moderationState <> 'HIDDEN') END AS thread,
  CASE WHEN m.moderationState = 'HIDDEN' AND (m.authorId = ?2 OR EXISTS (SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId
      WHERE ur.userId = ?2 AND r.name = 'ADMIN'))
    THEN EXISTS (SELECT 1 FROM moderation_case c WHERE c.messageId = m.id AND c.state = 'PENDING' AND c.reviewRequestedAt IS NOT NULL)
  END AS reviewRequested,
  ${embedAccessColumn(program)}`;
const MESSAGE_COLUMNS = messageColumns("?3");
const FROM_MESSAGES = `FROM channel_message m LEFT JOIN "user" u ON u.id = m.authorId`;
/** Hidden messages reach only their author and the channel's moderators. ?2 viewer, ?4 canModerate. */
const VISIBLE = `(m.moderationState <> 'HIDDEN' OR m.authorId = ?2 OR ?4)`;
/** The channel's change counter, read in the same statement as the page it checkpoints. */
const HEAD = `(SELECT coalesce(MAX(changeSeq), 0) AS head FROM channel_message WHERE channelId = ?1) h`;
/** The feed's own rows: roots, or one thread's replies (?5). A literal IS NULL keeps the index usable. */
const feed = (thread: string | null) => thread === null ? "m.parentId IS NULL" : "m.parentId = ?5";

const basics = (ctx: ReadContext) => [ctx.channel.id, ctx.viewerId, ctx.channel.programId, ctx.channel.capabilities.canModerate ? 1 : 0];

function jsonArray(text: string | null): unknown[] {
  if (!text) return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
const strings = (text: string | null) => new Set(jsonArray(text).filter((value): value is string => typeof value === "string"));
const NonBlank = z.string().refine((text) => text.trim().length > 0);
const parsedArray = <T>(schema: z.ZodType<T>, text: string): T[] =>
  jsonArray(text).flatMap((value) => { const result = schema.safeParse(value); return result.success ? [result.data] : []; });

export const TEMBO_AUTHOR: AuthorSummary = { id: null, name: "Tembo", avatarUrl: null, roleBadges: [{ kind: "AI", label: "AI", programId: null }] };
export const DELETED_AUTHOR: AuthorSummary = { id: null, name: "Deleted user", avatarUrl: null, roleBadges: [] };

/**
 * Display badges, never permissions: staff, mentor and institution roles everywhere; a cohort's
 * instructors, TAs, mentors, members and alumni only in that cohort's channels.
 */
function badges(row: MessageRow, programId: string | null): RoleBadge[] {
  const global = strings(row.globalRoles);
  const cohortRoles = strings(row.programRoles);
  const statuses = strings(row.applications);
  const cohort = row.programName?.trim() || "Cohort";
  const result: RoleBadge[] = [];
  if (global.has("ADMIN")) result.push({ kind: "STAFF", label: "Staff", programId: null });
  if (cohortRoles.has("INSTRUCTOR")) result.push({ kind: "INSTRUCTOR", label: "Instructor", programId });
  if (cohortRoles.has("TA")) result.push({ kind: "TA", label: "TA", programId });
  if (cohortRoles.has("MENTOR")) result.push({ kind: "MENTOR", label: "Mentor", programId });
  else if (global.has("MENTOR")) result.push({ kind: "MENTOR", label: "Mentor", programId: null });
  if (statuses.has("APPROVED") || statuses.has("AUDIT")) result.push({ kind: "COHORT", label: cohort, programId });
  else if (statuses.has("COMPLETED")) result.push({ kind: "ALUMNI", label: `Alumni · ${cohort}`, programId });
  if (global.has("INSTITUTION")) result.push({ kind: "INSTITUTION", label: "Institution partner", programId: null });
  return result;
}

function author(row: MessageRow, programId: string | null): AuthorSummary {
  if (row.authorKind === "TEMBO") return TEMBO_AUTHOR;
  if (row.authorId === null) return DELETED_AUTHOR;
  const avatar = WebLink.safeParse(row.authorImage);
  return { id: row.authorId, name: row.authorName?.trim() || "Member", avatarUrl: avatar.success ? avatar.data : null, roleBadges: badges(row, programId) };
}

function reactions(text: string): Reaction[] {
  const counts = new Map<string, Reaction>();
  for (const entry of jsonArray(text)) {
    if (!Array.isArray(entry)) continue;
    const kind = ReactionKind.safeParse(entry[0]);
    if (kind.success && typeof entry[1] === "number" && entry[1] > 0) {
      counts.set(kind.data, { kind: kind.data, count: entry[1], mine: entry[2] === 1 });
    }
  }
  return ReactionKind.options.flatMap((kind) => counts.get(kind) ?? []);
}

function threadSummary(text: string | null): Message["thread"] {
  const [count, lastReplyAt, participants] = jsonArray(text);
  return {
    replyCount: typeof count === "number" ? count : 0,
    participantIds: (Array.isArray(participants) ? participants : [])
      .filter((id): id is string => typeof id === "string").slice(0, PARTICIPANT_LIMIT),
    lastReplyAt: typeof lastReplyAt === "number" ? lastReplyAt : null,
  };
}

const isVisible = (row: MessageRow, ctx: ReadContext) =>
  row.moderationState !== "HIDDEN" || row.authorId === ctx.viewerId || ctx.channel.capabilities.canModerate;

/**
 * The wire Message for this viewer. Deleted messages keep their place with no content. Only the
 * author and the channel's moderators learn a message's moderation state, and only the author gets
 * the client nonce back (it reconciles their optimistic copy).
 */
export function toMessage(row: MessageRow, ctx: ReadContext): Message {
  const own = row.authorKind === "USER" && row.authorId !== null && row.authorId === ctx.viewerId;
  const deleted = row.deletedAt !== null;
  return {
    id: row.id, channelId: row.channelId, parentId: row.parentId,
    clientNonce: own ? row.clientNonce : null,
    authorKind: row.authorKind, author: author(row, ctx.channel.programId),
    body: deleted ? "" : row.body,
    embeds: deleted ? [] : embedsForReader(jsonArray(row.embeds), row.embedAccess),
    citations: deleted ? [] : parsedArray(Citation, row.citations),
    reactions: deleted ? [] : reactions(row.reactions),
    createdAt: row.createdAt, edited: !deleted && row.editedAt !== null, deleted,
    moderation: own || ctx.channel.capabilities.canModerate
      ? {
        state: row.moderationState, reasons: parsedArray(NonBlank, row.moderationReasons),
        ...row.reviewRequested === null ? {} : { reviewRequested: row.reviewRequested === 1 },
      }
      : null,
    thread: row.parentId === null ? threadSummary(row.thread) : { replyCount: 0, participantIds: [], lastReplyAt: null },
    temboScope: row.authorKind === "TEMBO" ? ctx.channel.kind : null,
  };
}

async function pageRows(ctx: ReadContext, sql: string, extra: unknown[]): Promise<{ head: number; rows: MessageRow[] }> {
  const { results } = await ctx.db.prepare(sql).bind(...basics(ctx), ...extra).all<{ head: number } & MessageRow>();
  // An empty page is still one row, the head with nulls from the LEFT JOIN.
  return { head: results[0]?.head ?? 0, rows: results.filter((row) => row.id !== null) };
}

/** The thread's root, if this viewer may open it. A reply, a hidden root or another channel's id is not a thread. */
async function assertThread(ctx: ReadContext, thread: string): Promise<void> {
  const parent = await ctx.db.prepare(`SELECT m.parentId, m.moderationState, m.authorId FROM channel_message m
    WHERE m.id = ?5 AND m.channelId = ?1 AND ${VISIBLE}`).bind(...basics(ctx), thread)
    .first<{ parentId: string | null }>();
  if (!parent || parent.parentId !== null) throw new ChannelError("not_found", "Thread not found.", 404);
}

/** Latest page, or the page `before` a position: newest first in SQL, oldest first on the wire. */
async function historyPage(ctx: ReadContext, thread: string | null, before: number | null): Promise<MessageList> {
  const { head, rows } = await pageRows(ctx, `SELECT h.head, p.* FROM ${HEAD} LEFT JOIN (
      SELECT ${MESSAGE_COLUMNS} ${FROM_MESSAGES}
      WHERE m.channelId = ?1 AND ${feed(thread)} ${before === null ? "" : "AND m.seq < ?6"} AND ${VISIBLE}
      ORDER BY m.seq DESC LIMIT ?7) p ON 1`, [thread, before, PAGE_SIZE + 1]);
  // A position past the counter belongs to a feed that was reset (a re-seeded preview database).
  if (before !== null && before > head + 1) throw new CursorExpiredError("This message cursor has expired.");
  const page = rows.toSorted((a, b) => b.seq - a.seq).slice(0, PAGE_SIZE).toReversed();
  const oldest = page[0];
  return {
    items: page.map((row) => toMessage(row, ctx)),
    beforeCursor: rows.length > PAGE_SIZE && oldest ? await encodeCursor(ctx.channel.id, thread, "before", oldest.seq) : null,
    sinceCursor: await encodeCursor(ctx.channel.id, thread, "since", head),
    thread, removedIds: [],
  };
}

/**
 * The changes after a checkpoint, in change order and contiguous: a capped delta checkpoints its
 * last change, an uncapped one the head read in the same statement. A change this viewer may not
 * see becomes a removal when the message existed at the checkpoint (seq <= checkpoint, since seq
 * and changeSeq share one counter), so they could have cached it, and is skipped otherwise.
 */
async function changesPage(ctx: ReadContext, thread: string | null, checkpoint: number): Promise<MessageList> {
  const { head, rows } = await pageRows(ctx, `SELECT h.head, p.* FROM ${HEAD} LEFT JOIN (
      SELECT ${MESSAGE_COLUMNS} ${FROM_MESSAGES}
      WHERE m.channelId = ?1 AND ${feed(thread)} AND m.changeSeq > ?6
      ORDER BY m.changeSeq LIMIT ?7) p ON 1`, [thread, checkpoint, SINCE_LIMIT + 1]);
  if (checkpoint > head) throw new CursorExpiredError("This message cursor has expired.");
  const changes = rows.toSorted((a, b) => a.changeSeq - b.changeSeq);
  const capped = changes.length > SINCE_LIMIT;
  const delta = changes.slice(0, SINCE_LIMIT);
  const visible = delta.filter((row) => isVisible(row, ctx));
  const removedIds = delta.filter((row) => !isVisible(row, ctx) && row.seq <= checkpoint).map((row) => row.id);
  // Older history for the messages this delta adds (the edits in it are already cached).
  const added = visible.filter((row) => row.seq > checkpoint).map((row) => row.seq);
  const next = capped ? delta.at(-1)?.changeSeq ?? checkpoint : head;
  return {
    items: visible.toSorted((a, b) => a.seq - b.seq).map((row) => toMessage(row, ctx)),
    beforeCursor: added.length > 0 ? await encodeCursor(ctx.channel.id, thread, "before", Math.min(...added)) : null,
    sinceCursor: await encodeCursor(ctx.channel.id, thread, "since", next),
    thread, removedIds,
  };
}

/**
 * GET /api/channels/:id/messages. No query: the latest page. `before`: the page before that cursor.
 * `since`: what changed after that checkpoint. `thread` switches every mode to one thread's replies.
 * Reading never moves the read marker. Throws ChannelError (404 thread) and the cursor errors.
 */
export async function listMessages(ctx: ReadContext, query: MessageListQuery): Promise<MessageList> {
  const thread = query.thread ?? null;
  if (thread !== null) await assertThread(ctx, thread);
  if (query.since !== undefined) return changesPage(ctx, thread, await decodeCursor(query.since, ctx.channel.id, thread, "since"));
  const before = query.before === undefined ? null : await decodeCursor(query.before, ctx.channel.id, thread, "before");
  return historyPage(ctx, thread, before);
}

/** One message as this viewer sees it, or null when it is missing, elsewhere, or hidden from them. */
export async function readMessage(ctx: ReadContext, messageId: string): Promise<Message | null> {
  const row = await ctx.db.prepare(`SELECT ${MESSAGE_COLUMNS} ${FROM_MESSAGES} WHERE m.id = ?5 AND m.channelId = ?1 AND ${VISIBLE}`)
    .bind(...basics(ctx), messageId).first<MessageRow>();
  return row ? toMessage(row, ctx) : null;
}
