/**
 * DEV harness only (/dev/platform-channel): the channel view on fixture data,
 * with fixture actions confirming every change at once. Exposes
 * `window.__channelHarness.arrive(count)` so a browser test can make other
 * people's messages arrive through a real poll.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { Channel, Me, Message, MessageList } from "@/lib/platform/contracts";
import { createChannelStore } from "@/lib/platform/client/channel";
import { FIXTURE_NOW, people } from "@/lib/platform/fixtures";
import { createFixtureActions } from "../actions";
import ChannelSurface from "../ChannelSurface";
import { shareablesFor } from "./fixture-pages";
import { createHarnessClient } from "./harness-client";

declare global {
  interface Window {
    __channelHarness?: { arrive: (count?: number) => void };
  }
}

const ARRIVALS = [
  { author: people.kevin, body: "Pushed my replay test too. It fails the way David described, which is a good sign." },
  { author: people.brian, body: "Is anyone pairing on the webhook exercise tonight?" },
  { author: people.faith, body: "Reminder: Thursday's session starts at 18:00." },
];

type HarnessChannelProps = {
  me: Me;
  channel: Channel;
  initial: MessageList;
  initialThread: MessageList | null;
  threadId: string | null;
  messageId: string | null;
  children?: ReactNode;
};

export default function HarnessChannel({ me, channel, initial, initialThread, threadId, messageId, children }: HarnessChannelProps) {
  const [harness] = useState(() => {
    const client = createHarnessClient(me, initial);
    const store = createChannelStore({
      channelId: channel.id, enabled: me.flags.channels, viewerId: me.user.id, initial, api: client.api,
      initialRead: { lastReadMessageId: null, unreadCount: channel.unreadCount },
    });
    const started = Date.now();
    // Fixture time runs on from FIXTURE_NOW, so new messages land "Today" after the fixtures.
    const now = () => FIXTURE_NOW + (Date.now() - started);
    const actions = createFixtureActions(store, { author: me.user, shareables: shareablesFor(me), now });
    return { client, store, actions, now };
  });

  useEffect(() => {
    let sequence = 0;
    window.__channelHarness = {
      arrive(count = 1) {
        const batch: Message[] = Array.from({ length: count }, () => {
          const { author, body } = ARRIVALS[sequence % ARRIVALS.length];
          sequence += 1;
          return {
            id: `arrival${String(sequence).padStart(4, "0")}`, channelId: channel.id, parentId: null, clientNonce: `arrival-${sequence}`,
            authorKind: "USER", author, body, embeds: [], citations: [], reactions: [], createdAt: harness.now(),
            edited: false, deleted: false, moderation: null, thread: { replyCount: 0, participantIds: [], lastReplyAt: null }, temboScope: null,
          };
        });
        harness.client.arrive(batch);
        // The feed polls at once when the window regains focus.
        window.dispatchEvent(new Event("focus"));
      },
    };
    return () => {
      delete window.__channelHarness;
    };
  }, [channel.id, harness]);

  if (!me.flags.channels) return null;
  return (
    <ChannelSurface
      me={me}
      channel={channel}
      store={harness.store}
      actions={harness.actions}
      now={FIXTURE_NOW}
      shareables={shareablesFor(me)}
      threadId={threadId}
      initialThread={initialThread}
      messageId={messageId}
    >
      {children}
    </ChannelSurface>
  );
}
