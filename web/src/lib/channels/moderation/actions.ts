import { createId } from "@paralleldrive/cuid2";
import {
  MessageEmbed, type Message, type ModerationAction, type ReportMessage, type RequestModerationReview,
} from "@/lib/platform/contracts";
import { drizzle } from "drizzle-orm/d1";
import { moderationAttention } from "@/lib/attention/channel-producers";
import type { AttentionProducerContext } from "@/lib/attention/producers";
import * as schema from "@/lib/db/schema";
import { findChannelById } from "../access";
import { screeningText } from "../embeds";
import { ADMIN_HID, ChannelError, readMessage } from "../messages";
import { findMessageTarget, visibleTo, type MessageTarget, type WriteContext } from "../mutations";
import type { ModerationViewer } from "./queue";
import { detectFindings, textKey } from "./detectors";
import { mergedReasons } from "./reasons";

/**
 * What people do about a message (B-2.5; README.md, "Moderation"): members report it, a channel's
 * moderators hide it, admins have the final say (hide, restore, keep), and the author of a hidden
 * message asks for a review. Each writes a moderation_event, and the case and evidence triggers
 * (migration 0032) follow from it. Callers have already resolved the message and its channel for
 * the caller (a message they cannot see is 404), and own the flag, sign-in and same-origin checks.
 */

/** Reports per person per rolling day, across channels: enough for real use, too few to flood the queue. */
export const REPORT_LIMIT = Object.freeze({ count: 20, windowMs: 24 * 60 * 60_000 });

const EVENT = "INSERT INTO moderation_event (id, messageId, action, source, actorId, fromState, toState, reasons, createdAt)";
/** ?1 is the message's channel: the message moves to its next changeSeq, so pollers see the change. */
const NEXT_CHANGE = "(SELECT MAX(changeSeq) + 1 FROM channel_message WHERE channelId = ?1)";

const deleted = () => new ChannelError("conflict", "This message was deleted.", 409);
/**
 * An admin's restore or keep of message `m` since its text last changed (ADMIN_HID: a hide since it
 * was hidden): from the audit trail, which a later report or flag reopening the case cannot erase.
 */
const ADMIN_KEPT = `EXISTS (SELECT 1 FROM moderation_event e WHERE e.messageId = m.id AND e.source = 'ADMIN'
  AND e.action IN ('RESTORE','KEEP') AND e.createdAt >= coalesce(m.editedAt, 0))`;
const decided = () => new ChannelError("conflict", "An admin has already reviewed this message.", 409);
const keepHidden = () => new ChannelError("conflict", "This message is hidden. Restore it instead.", 409);
const notHidden = () => new ChannelError("conflict", "This message isn't hidden.", 409);

/**
 * A keep needs a message that isn't hidden, or one that was deleted (whatever its state: that closes
 * the case and changes nothing else); a restore, one that is hidden and not deleted.
 */
function assertDecidable(target: MessageTarget, action: ModerationAction["action"]): void {
  const hidden = target.moderationState === "HIDDEN";
  if (action === "keep" && hidden && target.deletedAt === null) throw keepHidden();
  if (action === "restore" && !hidden) throw notHidden();
  if (action === "restore" && target.deletedAt !== null) throw deleted();
}

/**
 * Why a keep or restore that passed its precheck wrote nothing: the message changed since it was read.
 * A keep fails only on a message hidden and not deleted.
 */
async function stale(ctx: WriteContext, id: string, action: "keep" | "restore"): Promise<ChannelError> {
  if (action === "keep") return keepHidden();
  const state = await ctx.db.prepare("SELECT deletedAt FROM channel_message WHERE id = ?1")
    .bind(id).first<{ deletedAt: number | null }>();
  return state && state.deletedAt !== null ? deleted() : notHidden();
}

async function current(ctx: WriteContext, id: string): Promise<Message> {
  const message = await readMessage(ctx, id);
  if (!message) throw new ChannelError("not_found", "Message not found.", 404);
  return message;
}

/**
 * POST /api/messages/:id/report. Once per person and message: reporting again changes nothing
 * (created: false). Nobody reports their own message (403), a deleted one (409) or a hidden one
 * (409: it is already out of the channel, and a report must not reopen an admin's decision). Direct
 * conversations have no moderators yet, so they take no reports (403). The author sees no change;
 * the report opens or joins the admin case and keeps the text the reporter saw.
 */
export async function reportMessage(ctx: WriteContext, target: MessageTarget, input: ReportMessage): Promise<{ created: boolean }> {
  if (target.authorKind === "USER" && target.authorId === ctx.viewerId) {
    throw new ChannelError("forbidden", "You can't report your own message.", 403);
  }
  if (ctx.channel.kind === "DIRECT") throw new ChannelError("forbidden", "Reports aren't available in direct conversations yet.", 403);
  if (target.deletedAt !== null) throw deleted();
  const now = ctx.now ?? Date.now();
  const reportId = createId();
  // ?1 report, ?2 message, ?3 reporter, ?4 reason, ?5 now; then ?6 window start and ?7 limit for the
  // report, ?6 the event for its audit row, written only with the report.
  const [report] = await ctx.db.batch([
    ctx.db.prepare(`INSERT INTO message_report (id, messageId, reporterId, reason, createdAt) SELECT ?1, ?2, ?3, ?4, ?5
      WHERE EXISTS (SELECT 1 FROM channel_message WHERE id = ?2 AND deletedAt IS NULL AND moderationState <> 'HIDDEN')
        AND (SELECT COUNT(*) FROM message_report WHERE reporterId = ?3 AND createdAt > ?6) < ?7
      ON CONFLICT (messageId, reporterId) DO NOTHING RETURNING id`)
      .bind(reportId, target.id, ctx.viewerId, input.reason, now, now - REPORT_LIMIT.windowMs, REPORT_LIMIT.count),
    ctx.db.prepare(`${EVENT} SELECT ?6, id, 'FLAG', 'REPORT', ?3, moderationState, moderationState, json_array(?4), ?5
      FROM channel_message WHERE id = ?2 AND EXISTS (SELECT 1 FROM message_report WHERE id = ?1)`)
      .bind(reportId, target.id, ctx.viewerId, input.reason, now, createId()),
  ]);
  if (report?.results.length === 1) return { created: true };
  const why = await ctx.db.prepare(`SELECT
      EXISTS (SELECT 1 FROM message_report WHERE messageId = ?1 AND reporterId = ?2) AS reported,
      (SELECT deletedAt IS NOT NULL FROM channel_message WHERE id = ?1) AS gone,
      (SELECT moderationState = 'HIDDEN' FROM channel_message WHERE id = ?1) AS hidden,
      (SELECT MIN(createdAt) FROM message_report WHERE reporterId = ?2 AND createdAt > ?3) AS oldest`)
    .bind(target.id, ctx.viewerId, now - REPORT_LIMIT.windowMs)
    .first<{ reported: number; gone: number; hidden: number; oldest: number | null }>();
  if (why?.reported) return { created: false };
  if (why?.gone) throw deleted();
  if (why?.hidden) throw new ChannelError("conflict", "This message is already hidden.", 409);
  throw new ChannelError("rate_limited", "You've sent a lot of reports today. Try again later.", 429,
    Math.max(1, (why?.oldest ?? now) + REPORT_LIMIT.windowMs - now));
}

/**
 * POST /api/moderation/:messageId. A channel's moderators (its cohort's instructors, TAs and mentors;
 * global mentors in community channels) may hide, with a reason the author sees, but not a message
 * an admin restored or kept since its last edit (409): admins have the final say. Admins hide (also
 * upholding a moderator's hide, which closes the case), restore, or keep: fine as is. Restore and
 * keep make the message visible again and allowlist its text and each detector finding in it, so
 * neither is flagged again. Keep is for a message that is not hidden (409): Restore is the way back.
 * On a deleted message only keep is left: it closes the case, whatever the message's state, and
 * leaves that state as it is and allowlists nothing.
 */
export async function moderateMessage(
  ctx: WriteContext, target: MessageTarget, input: ModerationAction, { isAdmin }: { isAdmin: boolean },
): Promise<Message> {
  if (!isAdmin && !ctx.channel.capabilities.canModerate) {
    throw new ChannelError("forbidden", "Only this channel's moderators can do that.", 403);
  }
  if (!isAdmin && input.action !== "hide") throw new ChannelError("forbidden", "Only admins can restore or keep a message.", 403);
  assertDecidable(target, input.action);
  const now = ctx.now ?? Date.now();
  const eventId = createId();
  // ?1 channel, ?2 message, ?3 actor, ?4 reason, ?5 now, ?6 event, ?7 source.
  const params = [ctx.channel.id, target.id, ctx.viewerId, input.reason, now, eventId, isAdmin ? "ADMIN" : "MENTOR"];
  const written = "EXISTS (SELECT 1 FROM moderation_event WHERE id = ?6)";

  if (input.action === "hide") {
    if (target.deletedAt !== null) throw deleted();
    const [event] = await ctx.db.batch([
      // A moderator's hide needs a message not yet hidden and no admin restore or keep since its last edit.
      ctx.db.prepare(`${EVENT} SELECT ?6, m.id, 'HIDE', ?7, ?3, m.moderationState, 'HIDDEN', json_array(?4), ?5
        FROM channel_message m WHERE m.id = ?2 AND m.channelId = ?1 AND m.deletedAt IS NULL
          AND (?7 = 'ADMIN' OR (m.moderationState <> 'HIDDEN' AND NOT ${ADMIN_KEPT})) RETURNING id`)
        .bind(...params),
      ctx.db.prepare(`UPDATE channel_message SET moderationState = 'HIDDEN', hiddenBy = ?3, hiddenAt = coalesce(hiddenAt, ?5),
          moderationReasons = ${mergedReasons("moderationReasons", "json_array(?4)")}, changeSeq = ${NEXT_CHANGE}
        WHERE id = ?2 AND ${written}`).bind(...params.slice(0, 6)),
    ]);
    if (event?.results.length !== 1) {
      const state = await ctx.db.prepare("SELECT moderationState, deletedAt FROM channel_message WHERE id = ?1")
        .bind(target.id).first<{ moderationState: string; deletedAt: number | null }>();
      if (state?.deletedAt !== null) throw deleted();
      // Hiding again is a no-op for a moderator: the message is already hidden.
      if (state.moderationState !== "HIDDEN") throw decided();
    }
    return current(ctx, target.id);
  }

  // ?8 the action; keep only while the message is not hidden or is deleted, restore only while it is
  // hidden and not deleted (any of which may have changed since it was read). A deleted message keeps
  // its state.
  const [event] = await ctx.db.batch([
    ctx.db.prepare(`${EVENT} SELECT ?6, id, ?8, 'ADMIN', ?3, moderationState,
        CASE WHEN deletedAt IS NULL THEN 'VISIBLE' ELSE moderationState END, json_array(?4), ?5
      FROM channel_message WHERE id = ?2 AND channelId = ?1
        AND (CASE ?8 WHEN 'KEEP' THEN moderationState <> 'HIDDEN' OR deletedAt IS NOT NULL
          ELSE moderationState = 'HIDDEN' AND deletedAt IS NULL END)
      RETURNING id`)
      .bind(...params, input.action.toUpperCase()),
    ctx.db.prepare(`UPDATE channel_message SET moderationState = 'VISIBLE', moderationReasons = '[]', hiddenBy = NULL, hiddenAt = NULL,
        changeSeq = ${NEXT_CHANGE}
      WHERE id = ?2 AND moderationState <> 'VISIBLE' AND deletedAt IS NULL AND ${written}`).bind(...params.slice(0, 6)),
    ...await allowlisting(ctx, target, params.slice(0, 6)),
  ]);
  // Nothing written: the message was hidden (keep), or restored or deleted (restore), since it was read.
  if (event?.results.length !== 1) throw await stale(ctx, target.id, input.action);
  return current(ctx, target.id);
}

export interface DecisionContext extends AttentionProducerContext {
  now?: number;
  /** Sends the author's and admins' notices after the response (the API). Without it they are awaited (the page). */
  notifyLater?: (messageId: string) => void;
}

/**
 * A moderation decision for /admin/moderation (U-2.4) and POST /api/moderation/:messageId alike, so
 * both refuse the same things with the same ChannelError: a message the viewer cannot see is 404,
 * then moderateMessage's rules. The caller owns the `channels` flag, sign-in and same-origin checks.
 */
export async function decideModeration(
  context: DecisionContext, viewer: ModerationViewer, input: ModerationAction & { messageId: string },
): Promise<Message> {
  const target = await findMessageTarget(context.db, input.messageId);
  const channel = target && await findChannelById(drizzle(context.db, { schema }), viewer.user, target.channelId, viewer.capabilities);
  if (!target || !channel || !visibleTo(target, viewer.user.id, channel)) throw new ChannelError("not_found", "Message not found.", 404);
  const message = await moderateMessage(
    { db: context.db, viewerId: viewer.user.id, channel, now: context.now }, target,
    { action: input.action, reason: input.reason }, { isAdmin: viewer.capabilities.isAdmin },
  );
  if (context.notifyLater) context.notifyLater(target.id);
  else await moderationAttention(context, target.id);
  return message;
}

/**
 * What a restore or keep allowlists, written in its batch only with its event (?6) and only while the
 * message still has the text the admin read: the text as written and as it was screened (with the
 * shared work's text, screeningText), and each detector finding in it. A deleted message has none.
 */
async function allowlisting(ctx: WriteContext, target: MessageTarget, params: unknown[]): Promise<D1PreparedStatement[]> {
  if (target.body === "") return [];
  const screened = screeningText(target.body, storedEmbeds(target.embeds));
  const keys = new Set([await textKey(target.body), await textKey(screened), ...detectFindings(screened).flatMap((finding) => finding.key ?? [])]);
  return [ctx.db.prepare(`INSERT INTO moderation_allowlist (key, messageId, createdBy, createdAt)
    SELECT value, ?2, ?3, ?5 FROM json_each(?7)
    WHERE EXISTS (SELECT 1 FROM moderation_event WHERE id = ?6) AND EXISTS (SELECT 1 FROM channel_message WHERE id = ?2 AND body = ?8)
    ON CONFLICT (key) DO NOTHING`).bind(...params, JSON.stringify([...keys]), target.body)];
}

function storedEmbeds(text: string): MessageEmbed[] {
  try {
    return MessageEmbed.array().catch([]).parse(JSON.parse(text));
  } catch { return []; }
}

/**
 * POST /api/messages/:id/review. The author of a hidden message asks an admin to look again, with an
 * optional note. Once per case: asking again changes nothing. A hide an admin made or upheld is final
 * (409), and only a hidden message that is not deleted can be reviewed (409).
 */
export async function requestModerationReview(
  ctx: WriteContext, target: MessageTarget, input: RequestModerationReview,
): Promise<{ created: boolean }> {
  if (target.authorKind !== "USER" || target.authorId !== ctx.viewerId) {
    throw new ChannelError("forbidden", "Only the author can ask for a review.", 403);
  }
  if (target.moderationState !== "HIDDEN") throw new ChannelError("conflict", "This message isn't hidden.", 409);
  if (target.deletedAt !== null) throw deleted();
  const now = ctx.now ?? Date.now();
  // ?1 message, ?2 author, ?3 now, ?4 note. A hidden message always has a case; the INSERT covers one
  // that predates the case triggers.
  const { results } = await ctx.db.prepare(`INSERT INTO moderation_case
      (messageId, state, source, reasons, actorId, openedAt, updatedAt, reviewRequestedAt, reviewNote)
    SELECT id, 'PENDING', CASE WHEN hiddenBy IS NULL THEN 'AI_FLAG' ELSE 'MENTOR_HIDE' END, moderationReasons, hiddenBy, ?3, ?3, ?3, ?4
    FROM channel_message m WHERE id = ?1 AND authorId = ?2 AND moderationState = 'HIDDEN' AND deletedAt IS NULL AND NOT ${ADMIN_HID}
    ON CONFLICT (messageId) DO UPDATE SET reviewRequestedAt = excluded.reviewRequestedAt, reviewNote = excluded.reviewNote,
      updatedAt = max(updatedAt, excluded.updatedAt)
    WHERE state = 'PENDING' AND reviewRequestedAt IS NULL RETURNING messageId`).bind(target.id, ctx.viewerId, now, input.note ?? null).run();
  if (results.length === 1) return { created: true };
  const found = await ctx.db.prepare(`SELECT c.state, c.reviewRequestedAt, m.moderationState, m.deletedAt FROM channel_message m
    LEFT JOIN moderation_case c ON c.messageId = m.id WHERE m.id = ?1`)
    .bind(target.id).first<{ state: string | null; reviewRequestedAt: number | null; moderationState: string; deletedAt: number | null }>();
  if (found && found.deletedAt !== null) throw deleted();
  if (found?.moderationState === "HIDDEN" && found.state === "PENDING" && found.reviewRequestedAt !== null) return { created: false };
  if (found?.moderationState !== "HIDDEN") throw new ChannelError("conflict", "This message isn't hidden.", 409);
  throw decided();
}
