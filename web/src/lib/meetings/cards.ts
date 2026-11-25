import { ChannelError } from "@/lib/channels/errors";
import { postMessage } from "@/lib/channels/mutations";
import type { ChannelKind, Message, PostingPolicy } from "@/lib/platform/contracts";
import { channelAccessFor, type PlatformCapabilities } from "@/lib/platform/server/capabilities";
import { touchMeetingCard } from "./card-state";

/**
 * Posting a cohort session's card (README.md beside this file, "The session card", slice P9). There
 * is no system author, so a card is posted by the host who acted, as the session notes are. A single
 * date's scheduling note carries its card (sessions.ts); a date of a weekly series gets its card when
 * its room opens, so scheduling five dates never posts five cards (UX review M6). Either way the card
 * is that message's, `meeting.messageId`, its thread is the session's chat, and the card's state is
 * read from the call every time (card-state.ts), moved for open pages by touchMeetingCard.
 */

/** Who posts the card: the host who opened the room, with their capabilities from the database. */
export interface CardAuthor {
  userId: string;
  capabilities: PlatformCapabilities;
  conductVersion?: number;
}

export interface CardContext {
  db: D1Database;
  now: number;
  /** The checks a new card message gets after the response (note-checks.ts), where the caller has them. */
  afterNote?: (message: Message, channel: { id: string; kind: ChannelKind }) => void;
}

/** One card per session and author: posting it again finds the same message. */
export const cardNonce = (meetingId: string) => `session-card-${meetingId}`;

/** The words above a card posted when the room opens: past tense, so they stay true once the session is over. */
export const openedCardBody = (title: string) =>
  `Started “${title}”. Chat in this thread. The recording comes to this card when it's ready.`;

interface CardTarget {
  title: string; purpose: string; messageId: string | null;
  channelId: string; kind: ChannelKind; programId: string | null; postingPolicy: PostingPolicy; archivedAt: number | null;
}

/** Makes `messageId` the session's card, unless it already has one. True when this request set it. */
export async function attachCard(db: D1Database, meetingId: string, messageId: string): Promise<boolean> {
  const set = await db.prepare("UPDATE meeting SET messageId = ?2 WHERE id = ?1 AND messageId IS NULL RETURNING id")
    .bind(meetingId, messageId).first();
  return set !== null;
}

/**
 * Gives a session whose room just opened its card, when it has none yet: a message by the host who
 * opened it, in the session's channel. Posting goes through postMessage, the path every post takes
 * (the detectors, the code of conduct, the rate limits); a refused post leaves the session without a
 * card for now, and the next host to open it tries again. Returns the card's message id, or null.
 */
export async function ensureSessionCard(ctx: CardContext, author: CardAuthor, meetingId: string): Promise<string | null> {
  const target = await ctx.db.prepare(`SELECT m.title, m.purpose, m.messageId, c.id AS channelId, c.kind, c.programId, c.postingPolicy,
      c.archivedAt FROM meeting m JOIN channel c ON c.id = m.channelId WHERE m.id = ?1`).bind(meetingId).first<CardTarget>();
  if (!target || target.purpose !== "SESSION" || target.kind !== "COHORT") return null;
  if (target.messageId !== null) return target.messageId;
  const channel = { kind: target.kind, programId: target.programId, postingPolicy: target.postingPolicy, archivedAt: target.archivedAt };
  const { canRead, ...capabilities } = channelAccessFor(author.capabilities, channel);
  if (!canRead) return null;
  let posted: { message: Message; created: boolean };
  try {
    posted = await postMessage({
      db: ctx.db, viewerId: author.userId, now: ctx.now, conductVersion: author.conductVersion,
      channel: { id: target.channelId, kind: target.kind, programId: target.programId, archivedAt: target.archivedAt, capabilities },
    }, { body: openedCardBody(target.title), clientNonce: cardNonce(meetingId), parentId: null, embeds: [] },
    { card: { type: "meeting", meetingId } });
  } catch (error) {
    if (error instanceof ChannelError) return null;
    throw error;
  }
  if (posted.created) ctx.afterNote?.(posted.message, { id: target.channelId, kind: target.kind });
  // Two hosts opening at once could both post: only the first card is the session's.
  if (await attachCard(ctx.db, meetingId, posted.message.id)) return posted.message.id;
  return (await ctx.db.prepare("SELECT messageId FROM meeting WHERE id = ?1").bind(meetingId).first<{ messageId: string | null }>())?.messageId ?? null;
}

/** Moves a session's card for open pages, as one statement for a batch or on its own. */
export const touchCard = (db: D1Database, meetingId: string) => db.prepare(touchMeetingCard("?1")).bind(meetingId);
