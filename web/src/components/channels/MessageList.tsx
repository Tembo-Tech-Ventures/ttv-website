import { useCallback, useEffect, useRef, useState } from "react";
import { PiArrowDown, PiChatsCircle } from "react-icons/pi";
import type { AuthorSummary, Channel, Message, PersonSummary } from "@/lib/platform/contracts";
import type { ChannelState, ChannelStore } from "@/lib/platform/client/channel";
import type { Composer } from "@/lib/platform/client/composer";
import { useOutbox } from "@/lib/platform/client/hooks/composer";
import { useScrollAnchoring } from "@/lib/platform/client/hooks/scroll";
import Button, { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { channelTitle, groupByDay, postingFor } from "./channel-format";
import MessageItem from "./MessageItem";
import Outbox from "./Outbox";

type MessageListProps = {
  state: ChannelState;
  store: ChannelStore;
  channel: Channel;
  viewer: PersonSummary;
  now: number;
  /** S-2.2's composer: changes to messages, and the reader's unconfirmed sends after the list. */
  composer: Composer;
  names: readonly string[];
  people: ReadonlyMap<string, AuthorSummary>;
  /** Where the "New" divider sits for this visit (ChannelSurface decides it once). */
  firstUnreadId: string | null;
  openThreadId: string | null;
  threadHref: (messageId: string) => string;
  onOpenThread: (messageId: string, trigger: HTMLElement) => void;
  /** A message linked to directly (`?message=`): shown first, and marked. */
  focusMessageId: string | null;
  retry: () => void;
  announce: (text: string) => void;
};

function emptyCopy(channel: Channel): { title: string; detail: string } {
  const title = channel.kind === "DIRECT" ? `This is the start of your conversation with ${channel.name}` : `This is the start of ${channelTitle(channel)}`;
  switch (postingFor(channel)) {
    case "staff":
      return { title, detail: "Announcements from the TTV team will appear here." };
    case "archived":
      return { title, detail: "This channel is archived. Nothing was posted before it closed." };
    case "closed":
      return { title, detail: "Nothing has been posted yet." };
    case "open":
      return {
        title,
        detail: channel.kind === "COHORT"
          ? "Say hello, ask about a session, or share what you're working on."
          : channel.kind === "DIRECT"
            ? "Say hello and say what you'd like to talk through."
            : "Share what you're building, or ask a question.",
      };
  }
}

function OlderControls({ state, store }: { state: ChannelState; store: ChannelStore }) {
  return (
    <>
      {state.hasOlder && (
        <div className="flex justify-center pb-2">
          <Button size="sm" variant="ghost" loading={state.loadingOlder} onClick={() => void store.loadOlder()}>
            Load earlier messages
          </Button>
        </div>
      )}
      {state.olderError && <p className="channel-status">Couldn't load earlier messages. Try again.</p>}
      {state.olderTrimmed && !state.hasOlder && (
        <p className="channel-status">Earlier messages were put away to keep this page light. Jump to latest to page back through them.</p>
      )}
    </>
  );
}

/** Loading, failure and the empty channel: what the list says when it has no messages to show. */
function ListState({ state, channel, retry }: { state: ChannelState; channel: Channel; retry: () => void }) {
  if (state.messages.length > 0) return null;
  if (state.status === "idle" || state.status === "loading") {
    return (
      <output className="channel-status">
        <span className="channel-spinner" aria-hidden="true" /> Loading messages…
      </output>
    );
  }
  if (state.status === "error") {
    return (
      <div className="channel-empty">
        <output className="channel-empty__title">
          {state.terminal ? "This channel isn't available to you right now." : "Couldn't load messages."}
        </output>
        {!state.terminal && (
          <Button size="sm" variant="quiet" onClick={retry}>
            Try again
          </Button>
        )}
      </div>
    );
  }
  if (state.hasOlder) return null;
  const copy = emptyCopy(channel);
  return (
    <div className="channel-empty" data-channel-empty>
      <PiChatsCircle aria-hidden="true" className="size-8 text-peach-ink" />
      <p className="channel-empty__title">{copy.title}</p>
      {channel.topic && <p className="text-ink-secondary">{channel.topic}</p>}
      <p className="text-ink-secondary">{copy.detail}</p>
    </div>
  );
}

/** Whether the reader can see this element: laid out, and not hidden (a phone's open thread hides the list). */
function isShown(element: HTMLElement): boolean {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

/**
 * The channel's messages: the one scroll surface of the view. It opens at
 * the first unread message (or a linked one, or the end), keeps the reader's
 * place when older messages load above, follows new messages only while the
 * reader is at the end (or has just sent one), and otherwise offers "Jump to
 * latest". New messages are announced by the view's own live region, never
 * by this list, so opening a channel does not read it all aloud.
 */
export default function MessageList({
  state, store, channel, viewer, now, composer, names, people, firstUnreadId, openThreadId, threadHref, onOpenThread,
  focusMessageId, retry, announce,
}: MessageListProps) {
  const scroller = useRef<HTMLElement>(null);
  const messages = state.messages;
  // Only messages newer than the first paint arrive with motion; a page load does not animate its history.
  const arrivedAfter = useRef<number | null>(null);
  if (arrivedAfter.current === null && messages.length > 0) arrivedAfter.current = messages.at(-1)!.createdAt;
  const last = messages.at(-1)?.id;
  const title = channelTitle(channel);
  const viewerId = viewer.id;

  // S-2.3's anchoring: it opens at a linked message or the "New" divider (held there until the reader
  // moves, however content above it loads), keeps the reader's place as older pages load or are put
  // away, follows the end only from the end or for the reader's own message, and tells the store
  // which message is being read.
  const followOwn = useCallback((appended: readonly Message[]) => appended.some((message) => message.author.id === viewerId), [viewerId]);
  const { atBottom, measured, scrollToBottom, scrollToItem } = useScrollAnchoring(scroller, {
    items: messages,
    initialItemId: focusMessageId ?? firstUnreadId,
    shouldFollow: followOwn,
    onAnchor: store.setAnchor,
  });

  // A linked message is shown in the middle of the list, once, after it opens.
  const centred = useRef(false);
  useEffect(() => {
    if (!measured || centred.current || !focusMessageId) return;
    centred.current = scrollToItem(focusMessageId, "center");
  }, [measured, focusMessageId, scrollToItem]);

  // A message the reader just sent waits at the end, in the outbox: show it there at once.
  const pending = useOutbox(composer, null).length;
  const pendingBefore = useRef(pending);
  useEffect(() => {
    if (pending > pendingBefore.current) scrollToBottom();
    pendingBefore.current = pending;
  }, [pending, scrollToBottom]);

  // The tab coming back is a chance to have read what arrived while it was away.
  const [shownAgain, setShownAgain] = useState(0);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setShownAgain((count) => count + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Reading the end of a live channel marks it read, but only while the list can actually be seen:
  // on a phone an open thread hides it, and messages arriving then are not read yet. Closing the
  // thread (or returning to the tab) looks again.
  useEffect(() => {
    const element = scroller.current;
    if (!atBottom || !last || !state.live || document.visibilityState !== "visible" || !element || !isShown(element)) return;
    void store.markRead(last);
  }, [atBottom, last, state.live, store, openThreadId, shownAgain]);

  async function jumpToLatest() {
    if (!state.live) await store.jumpToLatest();
    scrollToBottom();
    scroller.current?.focus({ preventScroll: true });
  }

  const showJump = measured && messages.length > 0 && (!atBottom || !state.live);
  const groups = groupByDay(messages, now);

  return (
    <div className="channel-list" data-jump={showJump || undefined}>
      {/* The transcript scrolls here, so a keyboard must reach and scroll it (WCAG 2.1.1). */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll container */}
      <section ref={scroller} tabIndex={0} aria-label={`Messages in ${title}`} className={cx("channel-list__scroller", FOCUS_RING)} data-channel-scroller data-focus-home>
        <div>
        <OlderControls state={state} store={store} />
        <ListState state={state} channel={channel} retry={retry} />
        {groups.length > 0 && <h2 className="sr-only">Messages</h2>}
        {groups.map((group) => (
          <section key={group.key} aria-labelledby={`day-${group.key}`}>
            <h3 id={`day-${group.key}`} className="channel-day">
              {group.label}
            </h3>
            <ol className="channel-messages">
              {group.messages.map((message) => (
                <li key={message.id} data-message-row={message.id}>
                  {message.id === firstUnreadId && (
                    <p className="channel-new" data-new-divider>
                      <span>New</span>
                    </p>
                  )}
                  <div
                    className="channel-row"
                    data-arrived={(arrivedAfter.current !== null && message.createdAt > arrivedAfter.current) || undefined}
                    data-highlight={message.id === openThreadId || message.id === focusMessageId || undefined}
                  >
                    <MessageItem
                      message={message}
                      viewerId={viewerId}
                      now={now}
                      names={names}
                      people={people}
                      actions={composer}
                      threadOpen={message.id === openThreadId}
                      threadHref={threadHref}
                      onOpenThread={onOpenThread}
                      announce={announce}
                    />
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
        <Outbox composer={composer} parentId={null} viewer={viewer} names={names} />
        </div>
      </section>

      {showJump && (
        <button type="button" onClick={() => void jumpToLatest()} className={cx("channel-jump", FOCUS_RING)} data-jump-latest>
          <PiArrowDown aria-hidden="true" className="size-4" />
          Jump to latest
        </button>
      )}
    </div>
  );
}
