import { channelPagePath } from "@/lib/platform/server/space-routes";
import type { ChannelKind, ModerationSource } from "@/lib/platform/contracts";
import { FINDING_REASONS } from "@/lib/channels/moderation/detectors";
import { audienceFor, bestEffort, persist, type AttentionProducerContext, type EventItem } from "./producers";

/**
 * Attention for channel events (B-2.5; README.md beside this file): a hidden message's notice to its
 * author, the moderation queue's notice to admins, and mentions. Post-commit and best effort, like
 * every producer: they read the committed state, so a retry or a second call adds nothing (each
 * event key is unique per person). Items about channels need both `spaces` and `channels` for their
 * recipient. Message text is never copied into attention. Tembo's answers (B-3.1) tell the person who asked.
 */

/** Where the admin moderation queue lives (U-2.4). */
export const MODERATION_QUEUE_HREF = "/admin/moderation";

interface MessageState {
  id: string; parentId: string | null; authorKind: "USER" | "TEMBO"; authorId: string | null; body: string;
  moderationState: "VISIBLE" | "FLAGGED" | "HIDDEN"; moderationReasons: string; hiddenAt: number | null; hiddenBy: string | null;
  deletedAt: number | null; channelId: string; kind: ChannelKind; slug: string;
  caseState: "PENDING" | "DECIDED" | null; source: ModerationSource | null;
  /** When the case last opened: its latest reopening, else its first opening. Each opening is a new notice. */
  openedAt: number | null;
  reviewRequestedAt: number | null; decision: "HIDE" | "RESTORE" | "KEEP" | null; decidedAt: number | null;
  /** The decision's own audit row (the case's latest admin event): the state it found, and who made it. */
  decidedFrom: "VISIBLE" | "FLAGGED" | "HIDDEN" | null; decidedBy: string | null;
}

async function messageState(context: AttentionProducerContext, messageId: string): Promise<MessageState | null> {
  return context.db.prepare(`SELECT m.id, m.parentId, m.authorKind, m.authorId, m.body, m.moderationState, m.moderationReasons,
      m.hiddenAt, m.hiddenBy, m.deletedAt, m.channelId, ch.kind, ch.slug, c.state AS caseState, c.source, coalesce(c.reopenedAt, c.openedAt) AS openedAt,
      c.reviewRequestedAt, c.decision, c.decidedAt, d.fromState AS decidedFrom, d.actorId AS decidedBy
    FROM channel_message m JOIN channel ch ON ch.id = m.channelId LEFT JOIN moderation_case c ON c.messageId = m.id
      LEFT JOIN moderation_event d ON d.id = (SELECT e.id FROM moderation_event e WHERE e.messageId = m.id AND e.source = 'ADMIN'
        AND e.createdAt = c.decidedAt ORDER BY e.rowid DESC LIMIT 1)
    WHERE m.id = ?1`).bind(messageId).first<MessageState>();
}

/** How a summary names a channel: `#slug`, or a direct conversation (B-4.1), which has no slug of its own. */
const placeName = (message: Pick<MessageState, "kind" | "slug">) => message.kind === "DIRECT" ? "your conversation" : `#${message.slug}`;

/** The message's space, and its channel page, opened on its thread when it is a reply. Conversations are under Community. */
function messagePlace(message: Pick<MessageState, "id" | "parentId" | "channelId" | "kind" | "slug">): Pick<EventItem, "space" | "subject"> {
  const space = message.kind === "COHORT" ? "cohort" : "community";
  const thread = message.parentId === null ? "" : `?thread=${encodeURIComponent(message.parentId)}`;
  const href = `${channelPagePath({ id: message.channelId, kind: message.kind, slug: message.slug })}${thread}`;
  return { space, subject: { kind: "message", id: message.id, href, label: message.kind === "DIRECT" ? "Conversation" : `#${message.slug}` } };
}

/** Where a moderation notice says the message is: `#slug`, or a direct conversation, never naming its members. */
const moderationPlace = (message: Pick<MessageState, "kind" | "slug">) => message.kind === "DIRECT" ? "a direct conversation" : `#${message.slug}`;

const HIDDEN_SUMMARY = {
  automatic: (place: string) => `Your message in ${place} was hidden automatically. You can ask for a review.`,
  moderator: (place: string) => `A moderator hid your message in ${place}. You can ask for a review.`,
  admin: (place: string) => `A moderator hid your message in ${place}.`,
};
/**
 * An admin's decision, told to the author only when they knew of the case (B-3.2, QA2-11): the
 * message was hidden (restored, or kept hidden) or flagged where they could see it (kept as fine). A
 * report alone changes nothing the author sees, so its outcome stays unsaid too, and an admin's own
 * hide already has its hidden notice.
 */
const DECIDED_SUMMARY = {
  RESTORE: (place: string) => `An admin reviewed your message in ${place} and restored it.`,
  KEEP: (place: string) => `An admin reviewed your message in ${place}. It stays as it is.`,
  HIDE: (place: string) => `An admin reviewed your message in ${place}. It stays hidden.`,
};
function decidedNotice(message: MessageState): keyof typeof DECIDED_SUMMARY | null {
  if (message.caseState !== "DECIDED" || message.decision === null || message.decidedAt === null || message.decidedFrom === null) return null;
  if (message.authorKind !== "USER" || message.authorId === null || message.deletedAt !== null || message.decidedBy === message.authorId) return null;
  const knew = message.decidedFrom === "HIDDEN" || (message.decision === "KEEP" && message.decidedFrom === "FLAGGED");
  return knew ? message.decision : null;
}
const PENDING_SUMMARY: Record<ModerationSource, (place: string) => string> = {
  AI_FLAG: (place) => `A message in ${place} was flagged.`,
  REPORT: (place) => `A message in ${place} was reported.`,
  MENTOR_HIDE: (place) => `A moderator hid a message in ${place}.`,
  ADMIN_HIDE: (place) => `A message in ${place} was hidden.`,
};

/**
 * After any moderation change to a message: its author hears that it was hidden (once per hide,
 * without who hid it) and what an admin decided about a case they knew of (once per decision,
 * DECIDED_SUMMARY), and every admin but the author hears of an open case (once per case, and again
 * when the author asks for a review). An admin's own hide is final, so its notice offers no review.
 * Direct conversations have no moderators, so their cases go to the admins too (QA4-01), never to an
 * admin who is one of its members, and no notice names the conversation's members.
 */
export function moderationAttention(context: AttentionProducerContext, messageId: string) {
  return bestEffort(async () => {
    const audience = await audienceFor(context, "channels");
    if (audience === "OFF") return;
    const message = await messageState(context, messageId);
    if (!message) return;
    const place = moderationPlace(message);
    const items: EventItem[] = [];
    if (message.moderationState === "HIDDEN" && message.authorKind === "USER" && message.authorId !== null
      && message.deletedAt === null && message.hiddenBy !== message.authorId) {
      const by = message.caseState === "DECIDED" && message.decision === "HIDE" ? "admin" : message.hiddenBy === null ? "automatic" : "moderator";
      items.push({ ...messagePlace(message), userId: message.authorId, actorId: null, kind: "message_hidden",
        eventKey: JSON.stringify(["message_hidden", message.id, message.hiddenAt]), summary: HIDDEN_SUMMARY[by](place) });
    }
    const decided = decidedNotice(message);
    if (decided !== null && message.authorId !== null) {
      // access.ts reads decidedAt at $[2] of this key to show only the case's latest decision: keep its place.
      items.push({ ...messagePlace(message), userId: message.authorId, actorId: null, kind: "moderation_decided",
        eventKey: JSON.stringify(["moderation_decided", message.id, message.decidedAt]), summary: DECIDED_SUMMARY[decided](place) });
    }
    if (message.caseState === "PENDING" && message.source !== null) {
      const { results: admins } = await context.db.prepare(`SELECT DISTINCT ur.userId FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId
        WHERE r.name = 'ADMIN' AND ur.userId IS NOT ?1 AND NOT (?3 = 'DIRECT'
          AND EXISTS (SELECT 1 FROM channel_member cm WHERE cm.channelId = ?2 AND cm.userId = ur.userId))`)
        .bind(message.authorId, message.channelId, message.kind).all<{ userId: string }>();
      const queue = { kind: "message" as const, id: message.id, href: MODERATION_QUEUE_HREF, label: "Moderation queue" };
      for (const { userId } of admins) {
        items.push({ userId, actorId: null, kind: "moderation_pending", space: "admin", subject: queue,
          eventKey: JSON.stringify(["moderation_pending", message.id, message.openedAt]), summary: PENDING_SUMMARY[message.source](place) });
        if (message.reviewRequestedAt !== null) {
          items.push({ userId, actorId: null, kind: "moderation_pending", space: "admin", subject: queue,
            eventKey: JSON.stringify(["moderation_review", message.id, message.reviewRequestedAt]),
            summary: `The author of a hidden message in ${place} asked for a review.` });
        }
      }
    }
    await persist(context, audience, items);
  });
}

/** People mentioned in one message, at most this many: more is a mention flood, which notifies nobody. */
const MENTION_RECIPIENTS = 10;
/** Words a name may run to after its @. */
const NAME_WORDS = 4;
/** SQLite's lower() folds ASCII only, so the names compared here fold the same way. */
const asciiLower = (text: string) => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/**
 * Each `@Full Name` as the composer writes it (src/components/channels/mentions.ts), as the names it
 * could be: "@Wanjiku Njeri, see" could mean "wanjiku", "wanjiku njeri" or "wanjiku njeri see".
 */
export function mentionedNames(body: string): string[][] {
  return [...body.matchAll(/(?:^|[\s([{])@([\p{L}\p{N}_'’-]+(?:[ \t]+[\p{L}\p{N}_'’-]+){0,3})/gu)].flatMap(([, words = ""]) => {
    const parts = words.split(/[ \t]+/).slice(0, NAME_WORDS).map((part) => asciiLower(part));
    // @tembo is the assistant, not a person.
    return parts[0] === "tembo" ? [] : [parts.map((_, i) => parts.slice(0, i + 1).join(" ").replace(/['’-]+$/, ""))];
  });
}

/** Who reads a channel, in SQL over a user id expression and the channel row `ch` (fail-closed again on read). */
const readsChannel = (userId: string) => `(ch.kind = 'COMMUNITY'
  OR (ch.kind = 'DIRECT' AND EXISTS (SELECT 1 FROM channel_member cm WHERE cm.channelId = ch.id AND cm.userId = ${userId}))
  OR (ch.kind = 'COHORT' AND (
  EXISTS (SELECT 1 FROM programApplication pa WHERE pa.userId = ${userId} AND pa.programId = ch.programId AND pa.status IN ('APPROVED','AUDIT','COMPLETED'))
  OR EXISTS (SELECT 1 FROM programRole pr WHERE pr.userId = ${userId} AND pr.programId = ch.programId AND pr.name IN ('INSTRUCTOR','TA','MENTOR'))
  OR EXISTS (SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId WHERE ur.userId = ${userId} AND r.name = 'ADMIN'))))`;

/**
 * Mentions in a message just posted or edited: each person named after an @ who can read the
 * channel hears of it, the author named as the actor. The longest name that matches wins, and people
 * who share it are all told. Nobody hears of a hidden or deleted message, or of a mention flood. An
 * edit tells only people it newly mentions.
 */
export function mentionAttention(context: AttentionProducerContext, messageId: string) {
  return bestEffort(async () => {
    const audience = await audienceFor(context, "channels");
    if (audience === "OFF") return;
    const message = await messageState(context, messageId);
    if (!message || message.authorId === null || message.deletedAt !== null
      || message.moderationState === "HIDDEN" || (JSON.parse(message.moderationReasons) as unknown[]).includes(FINDING_REASONS.mentions)) return;
    const mentions = mentionedNames(message.body);
    if (mentions.length === 0) return;
    const { results } = await context.db.prepare(`SELECT u.id, lower(u.name) AS name FROM "user" u JOIN channel ch
        ON ch.id = (SELECT channelId FROM channel_message WHERE id = ?2)
      WHERE lower(u.name) IN (SELECT value FROM json_each(?1)) AND u.id <> ?3 AND ${readsChannel("u.id")}`)
      .bind(JSON.stringify(mentions.flat()), message.id, message.authorId).all<{ id: string; name: string }>();
    const names = new Set(results.map((row) => row.name));
    const chosen = new Set(mentions.map((options) => options.findLast((name) => names.has(name))).filter((name) => name !== undefined));
    const recipients = [...new Set(results.filter((row) => chosen.has(row.name)).map((row) => row.id))].slice(0, MENTION_RECIPIENTS);
    await persist(context, audience, recipients.map((userId) => ({
      ...messagePlace(message), userId, actorId: message.authorId, kind: "mention",
      eventKey: JSON.stringify(["mention", message.id]), summary: `Mentioned you in ${placeName(message)}.`,
    })));
  });
}

/**
 * Tembo answered a question (B-3.1): the person who asked hears of it once per answer, at the answer in
 * its thread, while the answer stays visible. Direct conversations included (B-4.1).
 */
export function temboAnswerAttention(context: AttentionProducerContext, answerId: string) {
  return bestEffort(async () => {
    const audience = await audienceFor(context, "channels");
    if (audience === "OFF") return;
    const answer = await context.db.prepare(`SELECT a.userId, m.id, m.parentId, m.channelId, ch.kind, ch.slug FROM tembo_ask a
        JOIN channel_message m ON m.id = a.answerId JOIN channel ch ON ch.id = m.channelId
      WHERE a.answerId = ?1 AND m.deletedAt IS NULL AND m.moderationState <> 'HIDDEN'`)
      .bind(answerId).first<{ userId: string } & Pick<MessageState, "id" | "parentId" | "channelId" | "kind" | "slug">>();
    if (!answer) return;
    await persist(context, audience, [{
      ...messagePlace(answer), userId: answer.userId, actorId: null, kind: "tembo_answer",
      eventKey: JSON.stringify(["tembo_answer", answer.id]), summary: `Tembo answered your question in ${placeName(answer)}.`,
    }]);
  });
}
