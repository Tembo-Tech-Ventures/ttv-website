import { useState, type ReactNode } from "react";
import type { Channel, Me, MessageList } from "@/lib/platform/contracts";
import { createChannelStore } from "@/lib/platform/client/channel";
import { createComposer } from "@/lib/platform/client/composer";
import type { Shareables } from "./actions";
import ChannelSurface from "./ChannelSurface";

export type ChannelViewProps = {
  me: Me;
  channel: Channel;
  /** The server's latest page, for the first paint and reading without JavaScript. */
  initial?: MessageList | null;
  /** The server-rendered replies when the page opens on `?thread=`. */
  initialThread?: MessageList | null;
  /** The reader's marker for the "New" divider, as the server read it (it never moves on a page load). */
  initialRead?: { lastReadMessageId: string | null; unreadCount: number } | null;
  /** The server's clock at render. */
  now: number;
  threadId?: string | null;
  messageId?: string | null;
  /**
   * The viewer's own projects and their cohort's session moments, for the
   * composer (B-2.4's getRouteChannelShareables). Null where they cannot post:
   * no attach tools then.
   */
  shareables?: Shareables | null;
  /** The channel frame's header (U-2.3). */
  children?: ReactNode;
};

/**
 * The channel view island (U-2.1): the channel store (S-2.1) and the composer
 * (S-2.2) for one channel, mounted by the channel page at
 * /dashboard/{community,cohort}/c/:slug:
 *
 *   <ChannelView client:load me={me} channel={channel} initial={page} now={Date.now()}>
 *     …the frame's header…
 *   </ChannelView>
 *
 * Renders nothing while the `channels` flag is off for this person. The
 * route itself returns 404 then; this is the second lock.
 */
export default function ChannelView({
  me, channel, initial = null, initialThread = null, initialRead = null, now, threadId = null, messageId = null, shareables = null, children,
}: ChannelViewProps) {
  const enabled = me.flags.channels === true;
  const [store] = useState(() => createChannelStore({
    channelId: channel.id, enabled, viewerId: me.user.id, initial: initial ?? undefined,
    initialRead: initialRead ?? { lastReadMessageId: null, unreadCount: channel.unreadCount },
  }));
  const [composer] = useState(() => createComposer({ store, me }));
  if (!enabled) return null;
  return (
    <ChannelSurface
      me={me}
      channel={channel}
      store={store}
      composer={composer}
      now={now}
      shareables={shareables}
      threadId={threadId}
      initialThread={initialThread}
      messageId={messageId}
    >
      {children}
    </ChannelSurface>
  );
}
