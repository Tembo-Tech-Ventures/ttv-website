import { SPACE_PATHS } from "@/lib/platform/server/space-routes";
import type { ChannelKind, ModerationSource } from "@/lib/platform/contracts";
import { FINDING_REASONS } from "@/lib/channels/moderation/detectors";
import { audienceFor, bestEffort, persist, type AttentionProducerContext, type EventItem } from "./producers";

/**
 * Attention for channel events (B-2.5; README.md beside this file): a hidden message's notice to its
 * author, the moderation queue's notice to admins, and mentions. Post-commit and best effort, like
 * every producer: they read the committed state, so a retry or a second call adds nothing (each
 * event key is unique per person). Items about channels need both `spaces` and `channels` for their
 * recipient. Message text is never copied into attention.
 */

/** Where the admin moderation queue lives (U-2.4). */
export const MODERATION_QUEUE_HREF = "/admin/moderation";

interface MessageState {
  id: string; parentId: string | null; authorKind: "USER" | "TEMBO"; authorId: string | null; body: string;
  moderationState: "VISIBLE" | "FLAGGED" | "HIDDEN"; moderationReasons: string; hiddenAt: number | null; hiddenBy: string | null;
  deletedAt: number | null; kind: ChannelKind; slug: string;
  caseState: "PENDING" | "DECIDED" | null; source: ModerationSource | null; openedAt: number | null;
  reviewRequestedAt: number | null; decision: "HIDE" | "RESTORE" | "KEEP" | null;
}

async function messageState(context: AttentionProducerContext, messageId: string): Promise<MessageState | null> {
  return context.db.prepare(`SELECT m.id, m.parentId, m.authorKind, m.authorId, m.body, m.moderationState, m.moderationReasons,
      m.hiddenAt, m.hiddenBy, m.deletedAt, ch.kind, ch.slug, c.state AS caseState, c.source, c.openedAt, c.reviewRequestedAt, c.decision
    FROM channel_message m JOIN channel ch ON ch.id = m.channelId LEFT JOIN moderation_case c ON c.messageId = m.id
    WHERE m.id = ?1`).bind(messageId).first<MessageState>();
}

/** The message's space, and its channel page, opened on its thread when it is a reply. Cohort and community channels only. */
function messagePlace(message: MessageState): Pick<EventItem, "space" | "subject"> {
  const space = message.kind === "COHORT" ? "cohort" : "community";
  const thread = message.parentId === null ? "" : `?thread=${encodeURIComponent(message.parentId)}`;
  return { space, subject: { kind: "message", id: message.id, href: `${SPACE_PATHS[space]}/c/${message.slug}${thread}`, label: `#${message.slug}` } };
}

const HIDDEN_SUMMARY = {
  automatic: (slug: string) => `Your message in #${slug} was hidden automatically. You can ask for a review.`,
  moderator: (slug: string) => `A moderator hid your message in #${slug}. You can ask for a review.`,
  admin: (slug: string) => `A moderator hid your message in #${slug}.`,
};
const PENDING_SUMMARY: Record<ModerationSource, (slug: string) => string> = {
  AI_FLAG: (slug) => `A message in #${slug} was flagged.`,
  REPORT: (slug) => `A message in #${slug} was reported.`,
  MENTOR_HIDE: (slug) => `A moderator hid a message in #${slug}.`,
  ADMIN_HIDE: (slug) => `A message in #${slug} was hidden.`,
};

/**
 * After any moderation change to a message: its author hears that it was hidden (once per hide,
 * without who hid it), and every admin but the author hears of an open case (once per case, and
 * again when the author asks for a review). An admin's own hide is final, so its notice offers no
 * review. Direct conversations have no moderators and get neither.
 */
export function moderationAttention(context: AttentionProducerContext, messageId: string) {
  return bestEffort(async () => {
    const audience = await audienceFor(context, "channels");
    if (audience === "OFF") return;
    const message = await messageState(context, messageId);
    if (!message || message.kind === "DIRECT") return;
    const items: EventItem[] = [];
    if (message.moderationState === "HIDDEN" && message.authorKind === "USER" && message.authorId !== null
      && message.deletedAt === null && message.hiddenBy !== message.authorId) {
      const by = message.caseState === "DECIDED" && message.decision === "HIDE" ? "admin" : message.hiddenBy === null ? "automatic" : "moderator";
      items.push({ ...messagePlace(message), userId: message.authorId, actorId: null, kind: "message_hidden",
        eventKey: JSON.stringify(["message_hidden", message.id, message.hiddenAt]), summary: HIDDEN_SUMMARY[by](message.slug) });
    }
    if (message.caseState === "PENDING" && message.source !== null) {
      const { results: admins } = await context.db.prepare(`SELECT DISTINCT ur.userId FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId
        WHERE r.name = 'ADMIN' AND ur.userId IS NOT ?1`).bind(message.authorId).all<{ userId: string }>();
      const queue = { kind: "message" as const, id: message.id, href: MODERATION_QUEUE_HREF, label: "Moderation queue" };
      for (const { userId } of admins) {
        items.push({ userId, actorId: null, kind: "moderation_pending", space: "admin", subject: queue,
          eventKey: JSON.stringify(["moderation_pending", message.id, message.openedAt]), summary: PENDING_SUMMARY[message.source](message.slug) });
        if (message.reviewRequestedAt !== null) {
          items.push({ userId, actorId: null, kind: "moderation_pending", space: "admin", subject: queue,
            eventKey: JSON.stringify(["moderation_review", message.id, message.reviewRequestedAt]),
            summary: `The author of a hidden message in #${message.slug} asked for a review.` });
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
const readsChannel = (userId: string) => `(ch.kind = 'COMMUNITY' OR (ch.kind = 'COHORT' AND (
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
    if (!message || message.kind === "DIRECT" || message.authorId === null || message.deletedAt !== null
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
      eventKey: JSON.stringify(["mention", message.id]), summary: `Mentioned you in #${message.slug}.`,
    })));
  });
}
