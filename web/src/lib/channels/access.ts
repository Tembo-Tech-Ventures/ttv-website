import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { channel, channelMember, channelMessage, channelRead, program, type Database } from "@/lib/db/schema";
import { Channel } from "@/lib/platform/contracts";
import {
  capabilitiesFor, channelAccessFor, type CapabilityUser, type PlatformCapabilities,
} from "@/lib/platform/server/capabilities";
import { CHANNEL_SLUG, type ChannelSpace } from "@/lib/platform/server/space-routes";

/**
 * Channel lists and lookups for page frontmatter and the channel APIs (README.md beside this file).
 * The database query only narrows the rows; channelAccessFor decides every row it returns, so the
 * list, the lookup and later message APIs cannot drift apart. Callers own the `channels` flag.
 */

/** Cohort channels open in Cohort, community ones in Community. */
const KIND_FOR_SPACE = { cohort: "COHORT", community: "COMMUNITY" } as const satisfies Record<ChannelSpace, Channel["kind"]>;

// The newest message anyone can still see; seq order walks channel_message_seq_idx backwards.
const lastMessageAt = sql<number | null>`(SELECT ${channelMessage.createdAt} FROM ${channelMessage}
  WHERE ${channelMessage.channelId} = ${channel.id} AND ${channelMessage.deletedAt} IS NULL
    AND ${channelMessage.moderationState} <> 'HIDDEN'
  ORDER BY ${channelMessage.seq} DESC LIMIT 1)`;

/** Unread counts stop here; the UI shows "99+" from 100 on. */
export const UNREAD_COUNT_CAP = 100;

/**
 * The caller's unread messages in the channel: root messages after their read marker (all of them
 * without one) that someone else wrote and that nobody deleted or hid, counted up to
 * UNREAD_COUNT_CAP so a long history never costs more than that. Thread replies reach people
 * through attention instead. One range of channel_message_thread_idx per channel.
 */
export function unreadCount(userId: string, channelId: SQL | AnySQLiteColumn, lastReadMessageId: SQL | AnySQLiteColumn) {
  return sql<number>`(SELECT COUNT(*) FROM (SELECT 1 FROM channel_message u
    WHERE u.channelId = ${channelId} AND u.parentId IS NULL
      AND u.seq > coalesce((SELECT r.seq FROM channel_message r WHERE r.id = ${lastReadMessageId}), 0)
      AND u.deletedAt IS NULL AND u.moderationState <> 'HIDDEN' AND u.authorId IS NOT ${userId}
    LIMIT ${UNREAD_COUNT_CAP}))`;
}

function selectChannels(db: Database, userId: string, where: SQL | undefined) {
  return db.select({
    id: channel.id, kind: channel.kind, slug: channel.slug, name: channel.name, topic: channel.topic,
    postingPolicy: channel.postingPolicy, programId: channel.programId, archivedAt: channel.archivedAt,
    isMember: sql<number>`${channelMember.userId} IS NOT NULL`, lastMessageAt,
    unreadCount: unreadCount(userId, channel.id, channelRead.lastReadMessageId),
  })
    .from(channel)
    .leftJoin(channelMember, and(eq(channelMember.channelId, channel.id), eq(channelMember.userId, userId)))
    .leftJoin(channelRead, and(eq(channelRead.channelId, channel.id), eq(channelRead.userId, userId)))
    .leftJoin(program, eq(program.id, channel.programId))
    .where(where);
}

type ChannelRow = Awaited<ReturnType<typeof selectChannels>>[number];

function readable(row: ChannelRow, capabilities: PlatformCapabilities): Channel | null {
  const { canRead, ...access } = channelAccessFor(capabilities, row, { isMember: row.isMember === 1 });
  if (!canRead) return null;
  // Parsing drops isMember.
  return Channel.parse({ ...row, capabilities: access });
}

/**
 * Narrows the channel table to the rows the caller might read; channelAccessFor still decides each
 * one. Community channels, the caller's cohorts' channels (every cohort's for admins), and their
 * direct conversations.
 */
function candidateChannels(db: Database, userId: string, caps: PlatformCapabilities): SQL | undefined {
  const cohortScope = caps.isAdmin ? undefined
    : caps.cohortIds.length > 0 ? inArray(channel.programId, caps.cohortIds) : sql`0`;
  return or(
    eq(channel.kind, "COMMUNITY"),
    and(eq(channel.kind, "COHORT"), cohortScope),
    // From the caller's memberships (channel_member_userId_idx), never a walk over every
    // conversation: unary + keeps SQLite from choosing channel_kind_idx for this branch.
    and(inArray(channel.id, db.select({ id: channelMember.channelId }).from(channelMember)
      .where(eq(channelMember.userId, userId))), sql`+${channel.kind} = 'DIRECT'`),
  );
}

/**
 * Every channel the caller can read, in display order: cohort channels (newest cohort first), then
 * community channels, then their direct conversations. Within a group, open channels come before
 * archived ones, then by position and name. Signed-out callers get nothing, without a query.
 * Pass capabilities already computed for this same user in this request to save their reads.
 */
export async function listChannelsFor(
  db: Database, user: CapabilityUser, capabilities?: PlatformCapabilities,
): Promise<Channel[]> {
  if (!user?.id) return [];
  const caps = capabilities ?? await capabilitiesFor(db, user);
  const rows = await selectChannels(db, user.id, candidateChannels(db, user.id, caps)).orderBy(
    sql`CASE ${channel.kind} WHEN 'COHORT' THEN 0 WHEN 'COMMUNITY' THEN 1 ELSE 2 END`,
    sql`${program.startDate} DESC NULLS LAST`, asc(program.name), asc(channel.programId),
    sql`${channel.archivedAt} IS NOT NULL`, asc(channel.position), asc(channel.name), asc(channel.id),
  );
  return rows.flatMap((row) => readable(row, caps) ?? []);
}

/**
 * The channel at /dashboard/<space>/c/<slug>, or null when it does not exist, lives in another
 * space, or the caller cannot read it. Those cases are indistinguishable on purpose: a cohort's
 * slug never confirms its existence to anyone outside that cohort.
 */
export async function findReadableChannel(
  db: Database, user: CapabilityUser, { space, slug }: { space: ChannelSpace; slug: string },
  capabilities?: PlatformCapabilities,
): Promise<Channel | null> {
  if (!user?.id || !CHANNEL_SLUG.test(slug)) return null;
  const caps = capabilities ?? await capabilitiesFor(db, user);
  // Slugs are unique among cohort and community channels. The literal term lets SQLite use the
  // partial index channel_slug_idx (WHERE kind <> 'DIRECT').
  const [row] = await selectChannels(db, user.id, and(
    eq(channel.slug, slug), sql`${channel.kind} <> 'DIRECT'`, eq(channel.kind, KIND_FOR_SPACE[space]),
  )).limit(1);
  return row ? readable(row, caps) : null;
}

/**
 * The channel with this id, or null when it does not exist or the caller cannot read it, through the
 * same queries either way: the /api/channels/:id routes never confirm another cohort's channel.
 */
export async function findChannelById(
  db: Database, user: CapabilityUser, channelId: string, capabilities?: PlatformCapabilities,
): Promise<Channel | null> {
  if (!user?.id) return null;
  const caps = capabilities ?? await capabilitiesFor(db, user);
  const [row] = await selectChannels(db, user.id, eq(channel.id, channelId)).limit(1);
  return row ? readable(row, caps) : null;
}

/**
 * The caller's read marker in a channel they can read, and how many messages are unread after it:
 * the same count the channel list shows. lastReadMessageId is null before their first marker.
 */
export async function readMarker(
  db: Database, userId: string, channelId: string,
): Promise<{ lastReadMessageId: string | null; unreadCount: number }> {
  const [row] = await db.select({
    lastReadMessageId: channelRead.lastReadMessageId,
    unreadCount: unreadCount(userId, channel.id, channelRead.lastReadMessageId),
  }).from(channel)
    .leftJoin(channelRead, and(eq(channelRead.channelId, channel.id), eq(channelRead.userId, userId)))
    .where(eq(channel.id, channelId));
  return { lastReadMessageId: row?.lastReadMessageId ?? null, unreadCount: row?.unreadCount ?? 0 };
}

/** Just enough of a readable channel to search it and link to it. */
export type ChannelRef = Pick<Channel, "id" | "kind" | "slug" | "programId">;

/**
 * Every channel the caller can read, without the counts the channel list carries: one indexed read,
 * each row decided by channelAccessFor like everywhere else. For search and, later, Tembo.
 */
export async function readableChannelRefs(
  db: Database, userId: string, capabilities: PlatformCapabilities,
): Promise<ChannelRef[]> {
  const rows = await db.select({
    id: channel.id, kind: channel.kind, slug: channel.slug, programId: channel.programId,
    postingPolicy: channel.postingPolicy, archivedAt: channel.archivedAt,
    isMember: sql<number>`${channelMember.userId} IS NOT NULL`,
  })
    .from(channel)
    .leftJoin(channelMember, and(eq(channelMember.channelId, channel.id), eq(channelMember.userId, userId)))
    .where(candidateChannels(db, userId, capabilities));
  return rows.flatMap(({ postingPolicy, archivedAt, isMember, ...ref }) =>
    channelAccessFor(capabilities, { ...ref, postingPolicy, archivedAt }, { isMember: isMember === 1 }).canRead ? [ref] : []);
}
