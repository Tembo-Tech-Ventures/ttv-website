import type { Database } from "@/lib/db/schema";
import { Id, MessageList, type Channel } from "@/lib/platform/contracts";
import { readMarker } from "./access";
import { ChannelError, listMessages } from "./messages";

/**
 * What a channel page renders before any JavaScript runs (U-2.1): the latest root messages, the
 * open thread's replies when the URL names one, and the reader's marker for the "New" divider.
 * The page hands `initial` to the channel store, which then polls `since` its cursor. Rendering a
 * page never moves the read marker; only POST /api/channels/:id/read does.
 */
export interface ChannelPage {
  initial: MessageList;
  /** The `?thread=` replies, or null when there is none or it is not a thread this reader can open. */
  thread: MessageList | null;
  read: { lastReadMessageId: string | null; unreadCount: number };
}

/**
 * For a channel the caller can read (findReadableChannel or getRouteChannel already decided).
 * Two reads, four with a thread. A thread that does not exist here, is a reply or is hidden from
 * this reader gives `thread: null`, exactly as if none was asked for.
 */
export async function loadChannelPage(
  db: Database, d1: D1Database, viewerId: string, channel: Channel, { thread }: { thread?: string | null } = {},
): Promise<ChannelPage> {
  const ctx = { db: d1, viewerId, channel };
  const threadId = Id.safeParse(thread);
  const [initial, replies, read] = await Promise.all([
    listMessages(ctx, {}),
    threadId.success ? listMessages(ctx, { thread: threadId.data }).catch((error: unknown) => {
      if (error instanceof ChannelError && error.status === 404) return null;
      throw error;
    }) : null,
    readMarker(db, viewerId, channel.id),
  ]);
  return { initial: MessageList.parse(initial), thread: replies && MessageList.parse(replies), read };
}
