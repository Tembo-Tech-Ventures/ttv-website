/**
 * DEV harness only (/dev/platform-channel): the channel view on fixture data,
 * with the real store (S-2.1) and composer (S-2.2) over a fixture API that
 * behaves like B-2.3 for this person. Exposes `window.__channelHarness` so a
 * browser test can make other people's messages arrive through a real poll,
 * or make the next sends fail.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { Channel, Me, Message, MessageList } from "@/lib/platform/contracts";
import { createChannelStore } from "@/lib/platform/client/channel";
import { createComposer } from "@/lib/platform/client/composer";
import { FIXTURE_NOW, people } from "@/lib/platform/fixtures";
import ChannelSurface from "../ChannelSurface";
import { shareablesFor } from "./fixture-pages";
import { createHarnessClient } from "./harness-client";

declare global {
  interface Window {
    __channelHarness?: {
      arrive: (count?: number) => void;
      /** The read markers the view has sent, oldest first. */
      reads: () => readonly string[];
      /** Refuse the next `count` writes with this HTTP status and error code. */
      refuseWrites: (count: number, status: number, code: string, message: string, retryAfterMs?: number) => void;
    };
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
  /** The reader's read marker as the server would send it (`?marker=`): the "New" divider follows it. */
  initialRead?: { lastReadMessageId: string | null; unreadCount: number };
  children?: ReactNode;
};

type Refusal = { count: number; status: number; data: { error: { code: string; message: string; retryAfterMs?: number } } };

export default function HarnessChannel({ me, channel, initial, initialThread, threadId, messageId, initialRead, children }: HarnessChannelProps) {
  const [harness] = useState(() => {
    const started = Date.now();
    // Fixture time runs on from FIXTURE_NOW, so new messages land "Today" after the fixtures.
    const now = () => FIXTURE_NOW + (Date.now() - started);
    const refusal: { next: Refusal | null } = { next: null };
    const client = createHarnessClient({
      me, channel, root: initial, shareables: shareablesFor(me), now,
      failure: (request) => {
        const write = request.method !== "GET" && !request.url.endsWith("/read");
        const next = refusal.next;
        if (!write || !next || next.count <= 0) return undefined;
        next.count -= 1;
        return { status: next.status, data: next.data };
      },
    });
    const store = createChannelStore({
      channelId: channel.id, enabled: me.flags.channels, viewerId: me.user.id, initial, api: client.api,
      initialRead: initialRead ?? { lastReadMessageId: null, unreadCount: 0 },
    });
    const composer = createComposer({ store, me, api: client.api, now });
    return { client, store, composer, now, refusal };
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
      reads: () => harness.client.reads(),
      refuseWrites(count, status, code, message, retryAfterMs) {
        harness.refusal.next = { count, status, data: { error: { code, message, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) } } };
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
      composer={harness.composer}
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
