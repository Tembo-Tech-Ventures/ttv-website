import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AuthorSummary, Channel, Me, Message, MessageList as MessagePage } from "@/lib/platform/contracts";
import { selectFirstUnread, type ChannelStore } from "@/lib/platform/client/channel";
import { useChannel, useChannelFeed } from "@/lib/platform/client/hooks/channel";
import type { ChannelActions, Shareables } from "./actions";
import { channelTitle } from "./channel-format";
import Composer from "./Composer";
import MessageList from "./MessageList";
import { PostingNote } from "./PostingNote";
import ThreadRail, { type ThreadView } from "./ThreadRail";
import "./channels.css";

export type ChannelSurfaceProps = {
  me: Me;
  channel: Channel;
  store: ChannelStore;
  /** Null while this person can only read. */
  actions: ChannelActions | null;
  /** The server's clock at render, so day names and times hydrate identically. */
  now: number;
  /** Null: no attach tools (see ChannelView). */
  shareables: Shareables | null;
  /** `?thread=`: the thread open on arrival. */
  threadId?: string | null;
  /** The server-rendered replies for `threadId`, shown until the store has its own (and without JavaScript). */
  initialThread?: MessagePage | null;
  /** `?message=`: a message linked to directly. */
  messageId?: string | null;
  /** The channel frame's header (U-2.3), above the messages, beside the thread. */
  children?: ReactNode;
};

const ANNOUNCEMENT_MS = 6_000;

function threadUrl(threadId: string | null): string {
  const url = new URL(window.location.href);
  if (threadId) url.searchParams.set("thread", threadId);
  else url.searchParams.delete("thread");
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Everyone this view has met, by id: authors in the channel window and the open thread. */
function collectPeople(...lists: ReadonlyArray<readonly (Message | null | undefined)[]>): Map<string, AuthorSummary> {
  const people = new Map<string, AuthorSummary>();
  for (const list of lists) {
    for (const message of list) {
      if (message && message.authorKind === "USER" && !message.deleted && message.author.id) people.set(message.author.id, message.author);
    }
  }
  return people;
}

/**
 * A channel: messages, an optional thread beside them, and the composer.
 * It owns no data itself. The store (S-2.1) holds messages, paging, polling
 * and read markers; `actions` makes changes. Production mounts it through
 * ChannelView; the DEV harness through fixture-backed versions of both.
 */
export default function ChannelSurface({
  me, channel, store, actions, now, shareables, threadId: initialThreadId = null, initialThread = null, messageId = null, children,
}: ChannelSurfaceProps) {
  const refresh = useChannelFeed(store);
  const state = useChannel(store);
  const firstUnread = useChannel(store, selectFirstUnread);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [announcement, setAnnouncement] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const title = channelTitle(channel);

  const announce = useCallback((text: string) => setAnnouncement(text), []);

  // The store's own announcements (new messages and replies, failures) join the same polite region.
  useEffect(() => {
    if (state.announcement) setAnnouncement(state.announcement);
  }, [state.announcement]);

  // Clear after a while, so the same words can be announced again later.
  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => {
      setAnnouncement("");
      store.clearAnnouncement();
    }, ANNOUNCEMENT_MS);
    return () => window.clearTimeout(timer);
  }, [announcement, store]);

  // Open the arriving thread once the store is live.
  useEffect(() => {
    if (initialThreadId) void store.openThread(initialThreadId);
  }, [initialThreadId, store]);

  const showThread = useCallback((id: string | null, focus: boolean) => {
    setThreadId(id);
    if (id) {
      void store.openThread(id);
      if (focus) requestAnimationFrame(() => heading.current?.focus());
    } else {
      store.closeThread();
    }
  }, [store]);

  // Back and Forward move between the channel and its threads.
  useEffect(() => {
    const onPop = () => showThread(new URL(window.location.href).searchParams.get("thread"), false);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [showThread]);

  const openThread = useCallback((id: string, trigger: HTMLElement) => {
    opener.current = trigger;
    // One history entry for "a thread is open": switching threads replaces it, so Back returns to the channel.
    if (threadId === null) window.history.pushState({ channelThread: id }, "", threadUrl(id));
    else if (id !== threadId) window.history.replaceState({ channelThread: id }, "", threadUrl(id));
    showThread(id, true);
  }, [showThread, threadId]);

  const closeThread = useCallback(() => {
    const closing = threadId;
    if ((window.history.state as { channelThread?: string } | null)?.channelThread === closing) {
      window.history.back();
    } else {
      window.history.replaceState(null, "", threadUrl(null));
    }
    showThread(null, false);
    requestAnimationFrame(() => {
      const trigger = opener.current?.isConnected
        ? opener.current
        : closing ? document.querySelector<HTMLElement>(`[data-thread-trigger="${CSS.escape(closing)}"]`) : null;
      (trigger ?? document.querySelector<HTMLElement>("[data-channel-scroller]"))?.focus();
    });
  }, [showThread, threadId]);

  const thread: ThreadView | null = useMemo(() => {
    if (!threadId) return null;
    if (state.thread?.parentId === threadId && (state.thread.status !== "loading" || !initialThread)) {
      return { ...state.thread, parent: state.thread.parent ?? state.messages.find((m) => m.id === threadId) ?? null };
    }
    const parent = state.messages.find((m) => m.id === threadId) ?? null;
    if (initialThread?.thread === threadId) {
      return { parentId: threadId, status: "ready", messages: initialThread.items, parent, hasOlder: false, loadingOlder: false };
    }
    return { parentId: threadId, status: "loading", messages: [], parent, hasOlder: false, loadingOlder: false };
  }, [threadId, state.thread, state.messages, initialThread]);

  const people = useMemo(() => {
    const met = collectPeople(state.messages, thread?.messages ?? [], [thread?.parent]);
    // The viewer is always someone this view knows, so their face shows in threads they joined.
    met.set(me.user.id, me.user);
    return met;
  }, [state.messages, thread, me.user]);
  const names = useMemo(() => [...people.values()].map((person) => person.name), [people]);
  const mentionPeople = useMemo(() => [...people.values()].filter((person) => person.id !== me.user.id), [people, me.user.id]);
  const threadHref = useCallback((id: string) => `?thread=${encodeURIComponent(id)}`, []);
  const posting = channel.archivedAt === null && channel.capabilities.canPost;

  return (
    <div className="channel-view" data-channel={channel.slug} data-thread={thread ? "open" : "closed"}>
      <div className="channel-view__grid">
      <section aria-label={title} className="channel-view__main">
        {children}
        <MessageList
          state={state}
          store={store}
          channel={channel}
          viewerId={me.user.id}
          now={now}
          actions={actions}
          names={names}
          people={people}
          firstUnread={firstUnread}
          openThreadId={threadId}
          threadHref={threadHref}
          onOpenThread={openThread}
          focusMessageId={messageId}
          retry={refresh}
          announce={announce}
        />
        {actions && posting ? (
          <Composer
            channel={channel}
            me={me}
            parentId={null}
            actions={actions}
            shareables={shareables}
            people={mentionPeople}
            label={`Message ${title}`}
          />
        ) : (
          <PostingNote channel={channel} />
        )}
      </section>

      {thread && (
        <ThreadRail
          thread={thread}
          channel={channel}
          me={me}
          now={now}
          actions={actions}
          shareables={shareables}
          names={names}
          people={people}
          mentionPeople={mentionPeople}
          headingRef={heading}
          onClose={closeThread}
          onLoadOlder={() => void store.loadOlderReplies()}
          onRetry={() => threadId && void store.openThread(threadId)}
          announce={announce}
        />
      )}
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true" data-channel-announcer>
        {announcement}
      </p>
    </div>
  );
}
