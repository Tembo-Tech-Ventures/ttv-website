import { createId } from "@paralleldrive/cuid2";
import {
  MessageEmbed, type Channel, type EditMessage, type Message, type MessageEmbed as StoredEmbed, type MessageReactions,
  type PostMessage, type ReactToMessage,
} from "@/lib/platform/contracts";
import { CONDUCT_VERSION } from "./conduct";
import { refOf, resolveEmbeds, sameRefs, screeningText } from "./embeds";
import { ChannelError } from "./errors";
import { readMessage, type ReadContext } from "./messages";
import { FINDING_REASONS, REPEAT } from "./moderation/detectors";
import { mergedReasons } from "./moderation/reasons";
import { screenMessage, type MessageScreen, type MessageScreening } from "./moderation/screen";

/**
 * Writing messages, reactions and read markers (README.md beside this file, "Writing"). Each
 * condition that decides a post (a free nonce, the code of conduct, the rate limits, an open
 * thread) is checked inside the INSERT, so concurrent requests cannot both pass a check one of them
 * should fail. Callers have already resolved the channel and the caller's access through
 * channelAccessFor, and own the flag, authentication and same-origin checks.
 */

/**
 * Posting limits per person: a burst in one channel, and a rolling day across every channel. A post
 * counts for exactly windowMs, so retryAfterMs is when the oldest one in the window stops counting.
 */
export const POST_LIMITS = Object.freeze({
  channel: Object.freeze({ count: 10, windowMs: 60_000 }),
  day: Object.freeze({ count: 300, windowMs: 24 * 60 * 60_000 }),
});

/**
 * Edits and reaction changes are cheap to repeat but each one moves the message for every poller
 * (and each edit is screened again), so they are limited too: edits per person per channel,
 * reaction changes per person across channels. Logged in channel_action (migration 0031).
 */
export const ACTION_LIMITS = Object.freeze({
  EDIT: Object.freeze({ count: 10, windowMs: 60_000, perChannel: true }),
  REACT: Object.freeze({ count: 30, windowMs: 60_000, perChannel: false }),
});
type ActionKind = keyof typeof ACTION_LIMITS;

export interface WriteContext extends ReadContext {
  channel: ReadContext["channel"] & Pick<Channel, "archivedAt">;
  now?: number;
  screen?: MessageScreen;
  /** The code of conduct version a post needs; tests raise it to show a new version asks again. */
  conductVersion?: number;
}

/** What a message route needs to know about the message before it changes anything. */
export interface MessageTarget {
  id: string; channelId: string; parentId: string | null; authorKind: "USER" | "TEMBO"; authorId: string | null;
  body: string; moderationState: "VISIBLE" | "FLAGGED" | "HIDDEN"; deletedAt: number | null;
  /** The stored embeds, as JSON (moderation allowlists the text they were screened with). */
  embeds: string;
}

/** Moves a message to the channel's next changeSeq, so `since` polls carry the change. ?1 is the channel. */
const touch = (id: string) => `UPDATE channel_message
  SET changeSeq = (SELECT MAX(changeSeq) + 1 FROM channel_message WHERE channelId = ?1) WHERE id = ${id} AND channelId = ?1`;
const FLAG_EVENT = "INSERT INTO moderation_event (id, messageId, action, source, actorId, fromState, toState, reasons, createdAt)";

const conductRequired = () =>
  new ChannelError("conduct_required", "Agree to how we talk to each other before you post.", 403);
/** The code of conduct version posting and editing need. */
const conductVersion = (ctx: WriteContext) => ctx.conductVersion ?? CONDUCT_VERSION;
const cannotPost = () => new ChannelError("forbidden", "You can read this channel but not post in it.", 403);

async function loaded(ctx: ReadContext, id: string): Promise<Message> {
  const message = await readMessage(ctx, id);
  if (!message) throw new ChannelError("not_found", "Message not found.", 404);
  return message;
}

/** The pre-insert hook's findings, with their reasons trimmed and blank ones dropped. */
async function screen(ctx: WriteContext, body: string, parentId: string | null, operation: "post" | "edit"): Promise<MessageScreening> {
  const { findings, textKey } = await (ctx.screen ?? screenMessage)({
    channel: { id: ctx.channel.id, kind: ctx.channel.kind, programId: ctx.channel.programId },
    authorId: ctx.viewerId, body, parentId, operation,
  });
  return {
    textKey,
    findings: findings.map((finding) => ({ ...finding, reason: finding.reason.trim() })).filter((finding) => finding.reason !== ""),
  };
}

/**
 * The reasons a screened text is flagged for, as one SQL value (a JSON array): each finding's reason
 * (findings is a JSON parameter), unless an admin allowlisted the finding's key or the whole text
 * (textKey), plus any `extra` reasons (a SELECT of one column). Evaluated inside the write, so the
 * allowlist an admin just changed is the one that counts.
 */
const screenedReasons = (findings: string, textKey: string, extra = "") => `(SELECT json_group_array(reason) FROM (
    SELECT DISTINCT json_extract(f.value, '$.reason') AS reason FROM json_each(${findings}) f
    WHERE NOT EXISTS (SELECT 1 FROM moderation_allowlist a
      WHERE a.key IN (${textKey}, coalesce(json_extract(f.value, '$.key'), ${textKey})))
    ${extra}))`;

interface NonceRow {
  id: string; channelId: string; parentId: string | null; body: string; embeds: string; editedAt: number | null; deletedAt: number | null;
}

/** The references a stored message's embeds were resolved from; null when they cannot be read back. */
function storedRefs(text: string) {
  try {
    const embeds = MessageEmbed.array().safeParse(JSON.parse(text));
    return embeds.success ? embeds.data.map(refOf) : null;
  } catch { return null; }
}

/**
 * The message this author already sent with this nonce, when the request repeats it: same channel,
 * same thread, the same body and the same attached work (or a message the author has since edited
 * or deleted). Different content under a used nonce is a 409. null when the nonce is unused.
 */
async function previousPost(ctx: WriteContext, input: PostMessage): Promise<{ message: Message; created: false } | null> {
  const row = await ctx.db.prepare(`SELECT id, channelId, parentId, body, embeds, editedAt, deletedAt
    FROM channel_message WHERE authorId = ?1 AND clientNonce = ?2`).bind(ctx.viewerId, input.clientNonce).first<NonceRow>();
  if (!row) return null;
  const refs = storedRefs(row.embeds);
  const repeat = row.channelId === ctx.channel.id && row.parentId === input.parentId
    && ((row.body === input.body && refs !== null && sameRefs(refs, input.embeds)) || row.editedAt !== null || row.deletedAt !== null);
  if (!repeat) throw new ChannelError("conflict", "This message was already sent with different content.", 409);
  return { message: await loaded(ctx, row.id), created: false };
}

const usage = (text: string): [count: number, oldest: number | null] => {
  const [count, oldest] = JSON.parse(text) as [number, number | null];
  return [count, oldest];
};

/**
 * Why a post was not written, from one read of the INSERT's own conditions, in the order a person
 * can act on them: the code of conduct, then the rate limits (with how long to wait), then the thread.
 */
async function refusal(ctx: WriteContext, input: PostMessage, now: number): Promise<ChannelError> {
  const { channel: burst, day } = POST_LIMITS;
  const why = await ctx.db.prepare(`SELECT
      (SELECT version FROM channel_conduct WHERE userId = ?2) AS conductVersion,
      (SELECT json_array(COUNT(*), MIN(createdAt)) FROM channel_message WHERE authorId = ?2 AND createdAt > ?3) AS day,
      (SELECT json_array(COUNT(*), MIN(createdAt)) FROM channel_message
        WHERE authorId = ?2 AND createdAt > ?4 AND channelId = ?1) AS burst,
      (SELECT json_array(parentId IS NULL, deletedAt IS NOT NULL OR moderationState = 'HIDDEN',
          moderationState <> 'HIDDEN' OR authorId = ?2 OR ?6)
        FROM channel_message WHERE id = ?5 AND channelId = ?1) AS parent`)
    .bind(ctx.channel.id, ctx.viewerId, now - day.windowMs, now - burst.windowMs, input.parentId,
      ctx.channel.capabilities.canModerate ? 1 : 0)
    .first<{ conductVersion: number | null; day: string; burst: string; parent: string | null }>();
  if (!why) throw new Error("Could not read the posting conditions.");
  if ((why.conductVersion ?? 0) < conductVersion(ctx)) return conductRequired();
  for (const [[count, oldest], limit] of [[usage(why.burst), burst], [usage(why.day), day]] as const) {
    if (count >= limit.count) {
      return new ChannelError("rate_limited", "You're posting quickly. Try again in a moment.", 429,
        Math.max(1, (oldest ?? now) + limit.windowMs - now));
    }
  }
  if (input.parentId !== null) {
    const [isRoot, closed, seen] = why.parent === null ? [0, 0, 0] : JSON.parse(why.parent) as [number, number, number];
    if (!isRoot || !seen) return new ChannelError("not_found", "Thread not found.", 404);
    if (closed) return new ChannelError("conflict", "This thread is closed.", 409);
  }
  throw new Error("A message insert wrote nothing, for no known reason.");
}

/**
 * POST /api/channels/:id/messages. Returns the new message (created: true), or the one this nonce
 * already made (created: false) when the request repeats an earlier post: a retry gets its message
 * back even if it could no longer post. Refusals: a nonce used for different content (409); no
 * posting right (403); the code of conduct not agreed at its current version (403
 * conduct_required); a rate limit (429 with retryAfterMs); a thread that is not an open root of
 * this channel the caller can see (404), or a deleted or hidden one (409); attached work that cannot
 * be shared here (resolveEmbeds: 400, or 409 for a stale project revision).
 */
export async function postMessage(ctx: WriteContext, input: PostMessage): Promise<{ message: Message; created: boolean }> {
  if (!ctx.channel.capabilities.canPost) {
    const previous = await previousPost(ctx, input);
    if (previous) return previous;
    throw cannotPost();
  }
  let embeds: StoredEmbed[];
  try {
    embeds = await resolveEmbeds(ctx, input.embeds);
  } catch (error) {
    // A retry gets its message back even when the work it shared has changed since.
    const previous = error instanceof ChannelError ? await previousPost(ctx, input) : null;
    if (previous) return previous;
    throw error;
  }

  const now = ctx.now ?? Date.now();
  // Shared projects are screened with the body: readers see their text too.
  const { findings, textKey } = await screen(ctx, screeningText(input.body, embeds), input.parentId, "post");
  const id = createId();
  const { channel: burst, day } = POST_LIMITS;
  // The same text in other channels within the hour: ?2 author, ?5 body, ?7 its key, ?15–?18 REPEAT.
  const repeat = `UNION SELECT ?15 WHERE length(?5) >= ?16 AND NOT EXISTS (SELECT 1 FROM moderation_allowlist WHERE key = ?7)
    AND (SELECT COUNT(DISTINCT channelId) FROM channel_message WHERE authorId = ?2 AND createdAt > ?17 AND channelId <> ?1
      AND body = ?5 AND deletedAt IS NULL) >= ?18`;
  const statements = [ctx.db.prepare(`INSERT INTO channel_message
      (id, channelId, parentId, seq, changeSeq, authorKind, authorId, clientNonce, body, embeds, moderationState, moderationReasons, createdAt)
    SELECT ?9, ?1, ?4, n.next, n.next, 'USER', ?2, ?3, ?5, ?19,
      CASE WHEN json_array_length(r.reasons) > 0 THEN 'FLAGGED' ELSE 'VISIBLE' END, r.reasons, max(?8, n.lastAt)
    FROM (SELECT coalesce(MAX(changeSeq), 0) + 1 AS next,
      coalesce((SELECT createdAt FROM channel_message WHERE channelId = ?1 ORDER BY seq DESC LIMIT 1), 0) AS lastAt
      FROM channel_message WHERE channelId = ?1) n,
      (SELECT ${screenedReasons("?6", "?7", repeat)} AS reasons) r
    WHERE EXISTS (SELECT 1 FROM channel_conduct WHERE userId = ?2 AND version >= ?10)
      AND (SELECT COUNT(*) FROM channel_message WHERE authorId = ?2 AND createdAt > ?11) < ?12
      AND (SELECT COUNT(*) FROM channel_message WHERE authorId = ?2 AND createdAt > ?13 AND channelId = ?1) < ?14
      AND (?4 IS NULL OR EXISTS (SELECT 1 FROM channel_message p WHERE p.id = ?4 AND p.channelId = ?1
        AND p.parentId IS NULL AND p.deletedAt IS NULL AND p.moderationState <> 'HIDDEN'))
    ON CONFLICT (authorId, clientNonce) DO NOTHING`).bind(
    ctx.channel.id, ctx.viewerId, input.clientNonce, input.parentId, input.body, JSON.stringify(findings), textKey, now, id,
    conductVersion(ctx), now - day.windowMs, day.count, now - burst.windowMs, burst.count,
    FINDING_REASONS.repeat, REPEAT.minLength, now - REPEAT.windowMs, REPEAT.channels - 1, JSON.stringify(embeds),
  )];
  // The statements after the INSERT act only if it wrote the new id.
  const written = "EXISTS (SELECT 1 FROM channel_message WHERE id = ?3)";
  // A reply changes its root's thread summary, so the root changes too.
  if (input.parentId !== null) {
    statements.push(ctx.db.prepare(`${touch("?2")} AND ${written}`).bind(ctx.channel.id, input.parentId, id));
  }
  // The flag's audit event, when the post could be flagged: a finding, or a text long enough to count
  // as a repeat. It reads the reasons the INSERT stored.
  if (findings.length > 0 || [...input.body].length >= REPEAT.minLength) {
    statements.push(ctx.db.prepare(`${FLAG_EVENT} SELECT ?2, id, 'FLAG', 'DETECTOR', NULL, 'VISIBLE', 'FLAGGED', moderationReasons, createdAt
      FROM channel_message WHERE id = ?1 AND moderationState = 'FLAGGED'`).bind(id, createId()));
  }
  const [inserted] = await ctx.db.batch(statements);
  if (inserted?.meta.changes === 1) return { message: await loaded(ctx, id), created: true };

  // Nothing was written: a repeat of an earlier post, or a refusal.
  const previous = await previousPost(ctx, input);
  if (previous) return previous;
  throw await refusal(ctx, input, now);
}

/**
 * The statement that opens an edit or reaction batch: log this action under `id` if the person's
 * window has room. Later statements act only when that row exists (`logged(id)`), so the limit and
 * the write are decided together; its `changes` says which. A trigger prunes rows older than an hour.
 */
function logAction(ctx: WriteContext, kind: ActionKind, id: string, now: number): D1PreparedStatement {
  const { count, windowMs, perChannel } = ACTION_LIMITS[kind];
  // An edit also needs the current code of conduct (?8); a refused edit logs nothing.
  const conduct = kind === "EDIT" ? "AND EXISTS (SELECT 1 FROM channel_conduct WHERE userId = ?1 AND version >= ?8)" : "";
  return ctx.db.prepare(`INSERT INTO channel_action (id, userId, channelId, kind, at) SELECT ?4, ?1, ?3, ?2, ?5
    WHERE (SELECT COUNT(*) FROM channel_action WHERE userId = ?1 AND kind = ?2 AND at > ?6 ${perChannel ? "AND channelId = ?3" : ""}) < ?7
      ${conduct}`)
    .bind(ctx.viewerId, kind, ctx.channel.id, id, now, now - windowMs, count, ...kind === "EDIT" ? [conductVersion(ctx)] : []);
}
const logged = (param: string) => `EXISTS (SELECT 1 FROM channel_action WHERE id = ${param})`;

/**
 * Why an action was not logged, from one read: an edit without the current code of conduct
 * (conduct_required), otherwise the limit (429, with when the oldest action in its window expires).
 */
async function actionRefusal(ctx: WriteContext, kind: ActionKind, now: number): Promise<ChannelError> {
  const { windowMs, perChannel } = ACTION_LIMITS[kind];
  const row = await ctx.db.prepare(`SELECT
      (SELECT version FROM channel_conduct WHERE userId = ?1) AS conduct,
      (SELECT MIN(at) FROM channel_action WHERE userId = ?1 AND kind = ?2 AND at > ?4 ${perChannel ? "AND channelId = ?3" : ""}) AS oldest`)
    .bind(ctx.viewerId, kind, ctx.channel.id, now - windowMs).first<{ conduct: number | null; oldest: number | null }>();
  if (kind === "EDIT" && (row?.conduct ?? 0) < conductVersion(ctx)) return conductRequired();
  const message = kind === "EDIT" ? "You're editing quickly. Try again in a moment." : "You're reacting quickly. Try again in a moment.";
  return new ChannelError("rate_limited", message, 429, Math.max(1, (row?.oldest ?? now) + windowMs - now));
}

/** Editing and deleting belong to a message's author; moderators hide instead (B-2.5). */
function requireAuthor(ctx: ReadContext, target: MessageTarget, verb: "edit" | "delete") {
  if (target.authorKind !== "USER" || target.authorId === null || target.authorId !== ctx.viewerId) {
    throw new ChannelError("forbidden", `You can only ${verb} your own messages.`, 403);
  }
}

/**
 * PATCH /api/messages/:id: the author rewrites a message in a channel they can still post in, under
 * the current code of conduct. The same body again changes nothing. Deleted and hidden messages are
 * not edited (409). The hook may flag the new text; an edit never clears an earlier flag.
 */
export async function editMessage(ctx: WriteContext, target: MessageTarget, input: EditMessage): Promise<Message> {
  requireAuthor(ctx, target, "edit");
  if (target.deletedAt !== null) throw new ChannelError("conflict", "This message was deleted.", 409);
  if (target.moderationState === "HIDDEN") {
    throw new ChannelError("conflict", "A moderator hid this message, so it can't be edited.", 409);
  }
  if (!ctx.channel.capabilities.canPost) throw cannotPost();
  if (input.body === target.body) return loaded(ctx, target.id);

  const now = ctx.now ?? Date.now();
  const { findings, textKey } = await screen(ctx, input.body, target.parentId, "edit");
  const action = createId();
  // ?1 channel, ?2 id, ?3 author, ?7 the logged action, which also stands for the current code of
  // conduct. Each statement repeats the guard, so those, and a concurrent delete or hide, win.
  const guard = `id = ?2 AND channelId = ?1 AND authorId = ?3 AND deletedAt IS NULL AND moderationState <> 'HIDDEN' AND ${logged("?7")}`;
  // ?8 findings, ?9 the text's key.
  const reasons = screenedReasons("?8", "?9");
  const params = [ctx.channel.id, target.id, ctx.viewerId, input.body, now, createId(), action, JSON.stringify(findings), textKey];
  const statements = [logAction(ctx, "EDIT", action, now)];
  if (findings.length > 0) {
    statements.push(ctx.db.prepare(`${FLAG_EVENT} SELECT ?6, id, 'FLAG', 'DETECTOR', NULL, moderationState, 'FLAGGED', r.reasons, ?5
      FROM channel_message, (SELECT ${reasons} AS reasons) r WHERE ${guard} AND json_array_length(r.reasons) > 0`).bind(...params));
  }
  statements.push(ctx.db.prepare(`UPDATE channel_message SET body = ?4, editedAt = ?5,
      changeSeq = (SELECT MAX(changeSeq) + 1 FROM channel_message WHERE channelId = ?1),
      moderationState = CASE WHEN json_array_length(r.reasons) = 0 THEN moderationState ELSE 'FLAGGED' END,
      moderationReasons = CASE WHEN json_array_length(r.reasons) = 0 THEN moderationReasons
        ELSE ${mergedReasons("moderationReasons", "r.reasons")} END
    FROM (SELECT ${reasons} AS reasons) r
    WHERE ${guard}`).bind(...params));
  const results = await ctx.db.batch(statements);
  if (results[0]?.meta.changes !== 1) throw await actionRefusal(ctx, "EDIT", now);
  if (results.at(-1)?.meta.changes !== 1) throw new ChannelError("conflict", "This message changed while you were editing it.", 409);
  return loaded(ctx, target.id);
}

/**
 * DELETE /api/messages/:id: the author removes their message from a channel they can still read,
 * even one they can no longer post in. It keeps its place as an empty placeholder, so its replies
 * stay in their thread, and loses its reactions. Deleting again returns the same placeholder.
 */
export async function deleteMessage(ctx: WriteContext, target: MessageTarget): Promise<Message> {
  requireAuthor(ctx, target, "delete");
  if (target.deletedAt === null) {
    const now = ctx.now ?? Date.now();
    // ?1 channel, ?2 id, ?3 author, ?4 now. The later statements act only for this deletion.
    const deletedNow = "(SELECT deletedAt FROM channel_message WHERE id = ?2) = ?4";
    const statements = [
      ctx.db.prepare(`UPDATE channel_message SET body = '', embeds = '[]', citations = '[]', deletedAt = ?4,
          changeSeq = (SELECT MAX(changeSeq) + 1 FROM channel_message WHERE channelId = ?1)
        WHERE id = ?2 AND channelId = ?1 AND authorId = ?3 AND deletedAt IS NULL`)
        .bind(ctx.channel.id, target.id, ctx.viewerId, now),
      ctx.db.prepare(`DELETE FROM message_reaction WHERE messageId = ?2 AND ${deletedNow}`)
        .bind(ctx.channel.id, target.id, ctx.viewerId, now),
    ];
    // A deleted reply leaves its root's thread summary.
    if (target.parentId !== null) {
      statements.push(ctx.db.prepare(`${touch("?5")} AND ${deletedNow}`)
        .bind(ctx.channel.id, target.id, ctx.viewerId, now, target.parentId));
    }
    await ctx.db.batch(statements);
  }
  // Authors still see their own deleted message, hidden or not.
  return loaded(ctx, target.id);
}

/**
 * POST /api/messages/:id/reactions: turns one of the fixed reactions on or off for the caller. The
 * request states the wanted state rather than toggling, so a retry cannot undo itself. Anyone who
 * reads an open channel may react, announcements included; deleted and hidden messages take none.
 */
export async function reactToMessage(ctx: WriteContext, target: MessageTarget, input: ReactToMessage): Promise<MessageReactions> {
  if (ctx.channel.archivedAt !== null) throw new ChannelError("forbidden", "This channel is archived.", 403);
  if (target.deletedAt !== null || target.moderationState === "HIDDEN") {
    throw new ChannelError("conflict", "This message can't take reactions.", 409);
  }
  const now = ctx.now ?? Date.now();
  const action = createId();
  // ?1 message, ?2 person, ?3 kind, ?4 now, ?5 the logged action.
  const open = `EXISTS (SELECT 1 FROM channel_message WHERE id = ?1 AND deletedAt IS NULL AND moderationState <> 'HIDDEN') AND ${logged("?5")}`;
  const mine = "EXISTS (SELECT 1 FROM message_reaction WHERE messageId = ?1 AND userId = ?2 AND kind = ?3)";
  const params = [target.id, ctx.viewerId, input.kind, now, action];
  const change = input.active
    ? ctx.db.prepare(`INSERT INTO message_reaction (messageId, userId, kind, createdAt) SELECT ?1, ?2, ?3, ?4 WHERE ${open}
        ON CONFLICT (messageId, userId, kind) DO NOTHING`).bind(...params)
    : ctx.db.prepare(`DELETE FROM message_reaction WHERE messageId = ?1 AND userId = ?2 AND kind = ?3 AND ${logged("?5")}`)
      .bind(...params);
  // Counts are part of the message, so other readers' polls pick the change up. The touch is in the
  // same batch and depends only on the wanted state, so a retry after a failure still delivers it.
  const touched = ctx.db.prepare(`UPDATE channel_message SET changeSeq = (SELECT MAX(changeSeq) + 1 FROM channel_message
      WHERE channelId = ?6) WHERE id = ?1 AND channelId = ?6 AND ${open} AND ${input.active ? "" : "NOT "}${mine}`)
    .bind(...params, ctx.channel.id);
  const [log] = await ctx.db.batch([logAction(ctx, "REACT", action, now), change, touched]);
  if (log?.meta.changes !== 1) throw await actionRefusal(ctx, "REACT", now);
  const { id, reactions } = await loaded(ctx, target.id);
  return { messageId: id, reactions };
}

/**
 * POST /api/channels/:id/read: moves the caller's read marker forward (by seq, never back) to a
 * message of this channel they can see. Nothing else moves it: reading a page or a list leaves it
 * where it is. The caller reads the stored marker and the unread count afterwards (readMarker).
 */
export async function markChannelRead(ctx: ReadContext & { now?: number }, messageId: string): Promise<void> {
  const params = [ctx.viewerId, ctx.channel.id, messageId, ctx.now ?? Date.now(), ctx.channel.capabilities.canModerate ? 1 : 0];
  // ?1 viewer, ?2 channel, ?3 message, ?4 now, ?5 canModerate.
  const target = "FROM channel_message m WHERE m.id = ?3 AND m.channelId = ?2 AND (m.moderationState <> 'HIDDEN' OR m.authorId = ?1 OR ?5)";
  const found = await ctx.db.prepare(`SELECT 1 AS found ${target}`).bind(...params).first<{ found: number }>();
  if (!found) throw new ChannelError("not_found", "Message not found.", 404);
  await ctx.db.prepare(`INSERT INTO channel_read (userId, channelId, lastReadMessageId, readAt) SELECT ?1, ?2, m.id, ?4 ${target}
    ON CONFLICT (userId, channelId) DO UPDATE SET lastReadMessageId = excluded.lastReadMessageId, readAt = excluded.readAt
    WHERE (SELECT seq FROM channel_message WHERE id = excluded.lastReadMessageId)
      > coalesce((SELECT seq FROM channel_message WHERE id = channel_read.lastReadMessageId), 0)`).bind(...params).run();
}

/** Whether a reader of the message's channel may see it: a hidden message is missing to anyone but its author and moderators. */
export function visibleTo(target: MessageTarget, userId: string, channel: Pick<Channel, "capabilities">): boolean {
  return target.moderationState !== "HIDDEN" || target.authorId === userId || channel.capabilities.canModerate;
}

/** The message a /api/messages/:id route names, before any access decision. One primary-key read. */
export async function findMessageTarget(db: D1Database, messageId: string): Promise<MessageTarget | null> {
  return db.prepare(`SELECT id, channelId, parentId, authorKind, authorId, body, moderationState, deletedAt, embeds
    FROM channel_message WHERE id = ?1`).bind(messageId).first<MessageTarget>();
}
