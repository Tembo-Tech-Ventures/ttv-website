import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PiArrowDown, PiChatsCircle } from "react-icons/pi";
import type { AuthorSummary, Channel, Message } from "@/lib/platform/contracts";
import type { ChannelState, ChannelStore } from "@/lib/platform/client/channel";
import Button, { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import type { ChannelActions } from "./actions";
import { channelTitle, groupByDay, postingFor } from "./channel-format";
import MessageItem from "./MessageItem";
import { prefersReducedMotion } from "./motion";

/** Within this many pixels of the end counts as reading the latest (docs/chat-full-page-layout.md). */
export const NEAR_BOTTOM_PX = 100;

type MessageListProps = {
  state: ChannelState;
  store: ChannelStore;
  channel: Channel;
  viewerId: string;
  now: number;
  actions: ChannelActions | null;
  names: readonly string[];
  people: ReadonlyMap<string, AuthorSummary>;
  firstUnread: Message | null;
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

function scrollToEnd(element: HTMLElement, smooth: boolean) {
  element.scrollTo({ top: element.scrollHeight, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" });
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
  state, store, channel, viewerId, now, actions, names, people, firstUnread, openThreadId, threadHref, onOpenThread,
  focusMessageId, retry, announce,
}: MessageListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(true);
  const following = useRef(true);
  const positioned = useRef(false);
  const previous = useRef<{ first?: string; last?: string; height: number } | null>(null);
  const messages = state.messages;
  // Only messages newer than the first paint arrive with motion; a page load does not animate its history.
  const arrivedAfter = useRef<number | null>(null);
  if (arrivedAfter.current === null && messages.length > 0) arrivedAfter.current = messages.at(-1)!.createdAt;
  const first = messages[0]?.id;
  const last = messages.at(-1)?.id;
  const title = channelTitle(channel);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const before = previous.current;
    if (!positioned.current && messages.length > 0) {
      positioned.current = true;
      const target = focusMessageId ?? firstUnread?.id ?? null;
      const node = target ? element.querySelector(`[data-message="${CSS.escape(target)}"]`) : null;
      if (node) node.scrollIntoView({ block: focusMessageId ? "center" : "start" });
      else element.scrollTop = element.scrollHeight;
    } else if (before && messages.length > 0) {
      if (first !== before.first && last === before.last) {
        // Older messages arrived above: keep the reader exactly where they were.
        element.scrollTop += element.scrollHeight - before.height;
      } else if (last !== before.last) {
        const sentByViewer = messages.at(-1)?.author.id === viewerId;
        if (following.current || sentByViewer) scrollToEnd(element, true);
      }
    }
    previous.current = { first, last, height: element.scrollHeight };
  }, [messages, first, last, focusMessageId, firstUnread, viewerId]);

  // Reading the end of a live channel marks it read.
  useEffect(() => {
    if (!atEnd || !last || !state.live || document.visibilityState !== "visible") return;
    void store.markRead(last);
  }, [atEnd, last, state.live, store]);

  function onScroll() {
    const element = scroller.current;
    if (!element) return;
    const near = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
    following.current = near;
    setAtEnd(near);
  }

  async function jumpToLatest() {
    if (!state.live) await store.jumpToLatest();
    requestAnimationFrame(() => {
      const element = scroller.current;
      if (!element) return;
      following.current = true;
      scrollToEnd(element, true);
      element.focus({ preventScroll: true });
    });
  }

  const showJump = messages.length > 0 && (!atEnd || !state.live);
  const groups = groupByDay(messages, now);

  return (
    <div className="channel-list">
      {/* The transcript scrolls here, so a keyboard must reach and scroll it (WCAG 2.1.1). */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll container */}
      <section ref={scroller} tabIndex={0} aria-label={`Messages in ${title}`} onScroll={onScroll} className={cx("channel-list__scroller", FOCUS_RING)} data-channel-scroller data-focus-home>
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
                  {message.id === firstUnread?.id && (
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
                      actions={actions}
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
