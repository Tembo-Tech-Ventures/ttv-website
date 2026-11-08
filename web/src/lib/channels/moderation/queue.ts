import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "@/lib/db/schema";
import type { PlatformCapabilities } from "@/lib/platform/server/capabilities";
import {
  Id, MessageVersion, ModerationQueue, ModerationQueueItem, ModerationQueueState, Timestamp, WebLink,
  type Channel, type Message, type ModerationQueueQuery, type ModerationSource, type PersonSummary,
} from "@/lib/platform/contracts";
import { listChannelsFor } from "../access";
import { ChannelError, messageColumns, toMessage, type MessageRow } from "../messages";
import { requestScoped } from "@/lib/platform/server/request-scope";

/**
 * The admin moderation queue (B-2.5), for GET /api/moderation/queue and the /admin/moderation page
 * (U-2.4) alike: one case per message, newest case first (by when it first opened, so a reopened case
 * keeps its place). One statement reads a page with each
 * message as an admin sees it, the case, who hid or decided, and the evidence (earlier texts, oldest
 * first). A direct conversation has no moderators, so admins decide its cases (QA4-01), but only the
 * case's own message reaches them (caseOnlyChannel, caseOnlyMessage), and never an admin who is one of
 * its two members. The caller owns the `channels` flag and sign-in checks.
 */

/** Who is asking, with capabilities already computed for them in this request (requestCapabilities). */
export interface ModerationViewer { user: { id: string }; capabilities: PlatformCapabilities }

export const QUEUE_PAGE_SIZE = 20;

const QueueCursor = z.strictObject({ v: z.literal(1), state: ModerationQueueState, openedAt: Timestamp, messageId: Id });
type QueueCursor = z.infer<typeof QueueCursor>;
const invalidCursor = () => new ChannelError("validation", "Invalid moderation queue cursor.", 400);

const encodeCursor = (cursor: QueueCursor) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(cursor))));
function decodeCursor(value: string): QueueCursor {
  try {
    return QueueCursor.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)))));
  } catch { throw invalidCursor(); }
}

interface QueueRow extends MessageRow {
  channelKind: Channel["kind"]; caseState: "PENDING" | "DECIDED"; source: ModerationSource; caseReasons: string; reportCount: number; openedAt: number; reopenedAt: number | null;
  decision: "HIDE" | "RESTORE" | "KEEP" | null; decisionReason: string | null; decidedAt: number | null;
  reviewRequestedAt: number | null; reviewNote: string | null; evidence: string;
  actorId: string | null; actorName: string | null; actorImage: string | null;
  deciderId: string | null; deciderName: string | null; deciderImage: string | null;
}

const person = (id: string | null, name: string | null, image: string | null): PersonSummary | null =>
  id === null ? null : { id, name: name?.trim() || "Member", avatarUrl: WebLink.safeParse(image).data ?? null, roleBadges: [] };

const strings = (text: string) => z.array(z.string()).catch([]).parse(JSON.parse(text)).filter((value) => value.trim() !== "");

function evidence(text: string) {
  return z.array(z.tuple([z.string(), z.string(), z.number()])).catch([]).parse(JSON.parse(text)).flatMap(([body, cause, capturedAt]) => {
    const version = MessageVersion.safeParse({ body, cause, capturedAt });
    return version.success ? [version.data] : [];
  });
}

/**
 * A direct conversation as an admin sees it from one of its cases (QA4-01): its id and kind, with no
 * name, topic, members or counts of its own, so nothing about the rest of the conversation. The admin
 * decides (canModerate), and cannot post or open it: its page and APIs stay 404 to non-members.
 */
export function caseOnlyChannel(id: string): Channel {
  return {
    id, kind: "DIRECT", slug: "conversation", name: "Direct conversation", topic: "", postingPolicy: "ALL", programId: null,
    unreadCount: 0, lastMessageAt: null, archivedAt: null, capabilities: { canPost: false, canModerate: true, canShareSessionClip: false },
  };
}

/**
 * A direct conversation's message as its case shows it to an admin: the message, its embeds and its
 * moderation state, without the replies and reactions that would describe the rest of the conversation.
 */
export function caseOnlyMessage(message: Message): Message {
  return { ...message, reactions: [], thread: { replyCount: 0, participantIds: [], lastReplyAt: null } };
}

/**
 * Direct conversations' cases, in SQL over the channel `ch` and a viewer id expression: never for an
 * admin who is one of the conversation's members (nobody judges their own conversation).
 */
export const NOT_OWN_CONVERSATION = (viewerId: string) => `(ch.kind <> 'DIRECT'
  OR NOT EXISTS (SELECT 1 FROM channel_member cm WHERE cm.channelId = ch.id AND cm.userId = ${viewerId}))`;

/**
 * A page of the queue. Admins only (403); a cursor that is not this state's is 400, so a page can
 * start again at the first page.
 */
export async function listModerationQueue(db: D1Database, viewer: ModerationViewer, query: ModerationQueueQuery): Promise<ModerationQueue> {
  if (!viewer.capabilities.isAdmin) throw new ChannelError("forbidden", "Only admins can see the moderation queue.", 403);
  return queuePage(db, viewer.user.id, await moderationChannels(db, viewer), query);
}

/**
 * The channels whose messages this viewer may see in the queue (listChannelsFor), read once per GET
 * (request-scope.ts), so /admin/moderation can start the read beside its flag checks (PERF-2).
 */
export function moderationChannels(db: D1Database, viewer: ModerationViewer): Promise<Channel[]> {
  return requestScoped(`moderation-channels:${viewer.user.id}`, () => listChannelsFor(drizzle(db, { schema }), viewer.user, viewer.capabilities));
}

/**
 * Open cases this admin may decide, for the page's tab and the Admin sidebar badge (queue index). A
 * badge must never take an admin page down with it, so a failed read counts none.
 * Read once per GET for the page and its admin navigation (request-scope.ts).
 */
export function countPendingModeration(db: D1Database, viewerId: string): Promise<number> {
  return requestScoped(`moderation-pending:${viewerId}`, () => readCountPendingModeration(db, viewerId));
}

async function readCountPendingModeration(db: D1Database, viewerId: string): Promise<number> {
  try {
    const row = await db.prepare(`SELECT count(*) AS count FROM moderation_case c JOIN channel_message m ON m.id = c.messageId
      JOIN channel ch ON ch.id = m.channelId WHERE c.state = 'PENDING' AND ${NOT_OWN_CONVERSATION("?1")}`)
      .bind(viewerId).first<{ count: number }>();
    return row?.count ?? 0;
  } catch {
    console.warn("The moderation queue count could not be read.");
    return 0;
  }
}

/** `channels` are the caller's readable channels (listChannelsFor), with the capabilities each message is shown with. */
async function queuePage(db: D1Database, viewerId: string, channels: Channel[], query: ModerationQueueQuery): Promise<ModerationQueue> {
  const state = query.state ?? "PENDING";
  const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
  if (cursor && cursor.state !== state) throw invalidCursor();
  // ?1 state, ?2 viewer (message columns), ?3 and ?4 the cursor, ?5 page size and one more.
  const { results } = await db.prepare(`SELECT ${messageColumns("ch.programId")}, ch.kind AS channelKind,
      c.state AS caseState, c.source, c.reasons AS caseReasons, c.reportCount, c.openedAt, c.reopenedAt, c.decision, c.decisionReason, c.decidedAt,
      c.reviewRequestedAt, c.reviewNote,
      a.id AS actorId, a.name AS actorName, a.image AS actorImage, d.id AS deciderId, d.name AS deciderName, d.image AS deciderImage,
      (SELECT json_group_array(json_array(v.body, v.cause, v.capturedAt)) FROM (SELECT body, cause, capturedAt
        FROM channel_message_version WHERE messageId = c.messageId ORDER BY capturedAt, rowid) v) AS evidence
    FROM moderation_case c
      JOIN channel_message m ON m.id = c.messageId
      JOIN channel ch ON ch.id = m.channelId
      LEFT JOIN "user" u ON u.id = m.authorId
      LEFT JOIN "user" a ON a.id = c.actorId
      LEFT JOIN "user" d ON d.id = c.decidedBy
    WHERE c.state = ?1 AND ${NOT_OWN_CONVERSATION("?2")}
      AND (?3 IS NULL OR c.openedAt < ?3 OR (c.openedAt = ?3 AND c.messageId < ?4))
    ORDER BY c.openedAt DESC, c.messageId DESC LIMIT ?5`)
    .bind(state, viewerId, cursor?.openedAt ?? null, cursor?.messageId ?? null, QUEUE_PAGE_SIZE + 1).all<QueueRow>();
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  const page = results.slice(0, QUEUE_PAGE_SIZE);
  const last = page.at(-1);
  return ModerationQueue.parse({
    nextCursor: results.length > QUEUE_PAGE_SIZE && last ? encodeCursor({ v: 1, state, openedAt: last.openedAt, messageId: last.id }) : null,
    items: page.flatMap((row) => {
      const direct = row.channelKind === "DIRECT";
      const channel = direct ? caseOnlyChannel(row.channelId) : byId.get(row.channelId);
      if (!channel) return [];
      const message = toMessage(row, { db, viewerId, channel });
      const decider = person(row.deciderId, row.deciderName, row.deciderImage);
      const item = ModerationQueueItem.safeParse({
        id: row.id, message: direct ? caseOnlyMessage(message) : message, channel, source: row.source, reasons: strings(row.caseReasons),
        state: row.caseState, reportCount: row.reportCount, actor: person(row.actorId, row.actorName, row.actorImage), createdAt: row.openedAt,
        ...row.reopenedAt === null ? {} : { reopenedAt: row.reopenedAt },
        evidence: evidence(row.evidence),
        review: row.reviewRequestedAt === null ? null : { requestedAt: row.reviewRequestedAt, note: row.reviewNote },
        decision: row.caseState === "DECIDED" && row.decision !== null && row.decidedAt !== null
          ? { action: row.decision.toLowerCase(), reason: row.decisionReason ?? "", by: decider, decidedAt: row.decidedAt } : null,
      });
      // One case the contract cannot describe (all its reasons blank, say) must not take the queue down.
      if (!item.success) console.warn("A moderation case could not be shown.", row.id);
      return item.success ? [item.data] : [];
    }),
  });
}
