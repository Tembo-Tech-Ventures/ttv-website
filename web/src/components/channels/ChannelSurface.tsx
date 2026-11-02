import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AuthorSummary, Channel, Me, Message, MessageList as MessagePage } from "@/lib/platform/contracts";
import type { ChannelStore } from "@/lib/platform/client/channel";
import type { Composer as ChannelComposer } from "@/lib/platform/client/composer";
import type { TemboState, TemboStore } from "@/lib/platform/client/tembo";
import { useChannel, useChannelFeed } from "@/lib/platform/client/hooks/channel";
import { useComposer } from "@/lib/platform/client/hooks/composer";
import { createStore, useStore } from "@/lib/platform/client/store";
import type { ModerationActions, Shareables } from "./actions";
import { channelTitle, openingDivider } from "./channel-format";
import Composer from "./Composer";
import MessageList from "./MessageList";
import { ModerationProvider } from "./MessageModeration";
import type { MomentFinder } from "./moment-search";
import { PostingNote } from "./PostingNote";
import { TemboProvider } from "./TemboAnswer";
import ThreadRail, { type ThreadView } from "./ThreadRail";
import { wheelScrollsList } from "./wheel";
import "./channels.css";

export type ChannelSurfaceProps = {
  me: Me;
  channel: Channel;
  store: ChannelStore;
  /** S-2.2's composer for this channel: sends, drafts and the outbox, and every edit, deletion and reaction. */
  composer: ChannelComposer;
  /** S-3.1's questions to Tembo, its allowance and feedback; the composer's `onSent` asks. Null: nothing is asked or rated. */
  tembo?: TemboStore | null;
  /** The server's clock at render, so day names and times hydrate identically. */
  now: number;
  /** Null: no attach tools (see ChannelView). */
  shareables: Shareables | null;
  /** The clip finder's search (GET /api/channels/:id/shareables?q=). Null offers the recent sessions only. */
  findMoments?: MomentFinder | null;
  /** Reporting and, where the channel says this reader moderates, hiding and restoring. Null offers neither. */
  moderation?: ModerationActions | null;
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
/** Stands in while Tembo is off: never changes. */
const NO_TEMBO = createStore<TemboState>({ usage: null, questions: {}, feedback: {}, saving: [], announcement: "" });

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
 * and read markers; the composer (S-2.2) makes every change. Production mounts
 * it through ChannelView; the DEV harness with both on a fixture API.
 */
export default function ChannelSurface({
  me, channel, store, composer, tembo = null, now, shareables, findMoments = null, moderation = null, threadId: initialThreadId = null, initialThread = null,
  messageId = null, children,
}: ChannelSurfaceProps) {
  const refresh = useChannelFeed(store);
  const state = useChannel(store);
  // The "New" divider is decided when the channel first has messages, from the marker the page opened
  // with, and kept for the visit: marking messages read must not move it out from under the reader.
  const divider = useRef<string | null | undefined>(undefined);
  if (divider.current === undefined && state.messages.length > 0) divider.current = openingDivider(state.messages, state.read, me.user.id);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [announcement, setAnnouncement] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const title = channelTitle(channel);

  const announce = useCallback((text: string) => setAnnouncement(text), []);

  // The store's announcements (new messages and replies) and the composer's (a send that failed, or was
  // flagged) join the same polite region.
  const composerAnnouncement = useComposer(composer, (composerState) => composerState.announcement);
  // Tembo's questions are watched while the view is up; its news (pending, answered, refused) joins too.
  useEffect(() => tembo?.retain(), [tembo]);
  const temboAnnouncement = useStore(tembo ?? NO_TEMBO, (temboState) => temboState.announcement);
  useEffect(() => {
    if (temboAnnouncement) setAnnouncement(temboAnnouncement);
  }, [temboAnnouncement]);
  useEffect(() => {
    if (state.announcement) setAnnouncement(state.announcement);
  }, [state.announcement]);
  useEffect(() => {
    if (composerAnnouncement) setAnnouncement(composerAnnouncement);
  }, [composerAnnouncement]);

  // Clear after a while, so the same words can be announced again later.
  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => {
      setAnnouncement("");
      store.clearAnnouncement();
      tembo?.clearAnnouncement();
    }, ANNOUNCEMENT_MS);
    return () => window.clearTimeout(timer);
  }, [announcement, store, tembo]);

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

  // A linked message (a search result, something that needs attention) takes focus once it shows, so a
  // keyboard carries on from it rather than from the top of the page (QA2-04): a reply in the thread the
  // link opened, otherwise the message in the list, which the list has already brought into view.
  const linked = useRef(messageId);
  useEffect(() => {
    const id = linked.current;
    if (!id) return;
    // Someone who has already moved on (into the box, say) keeps their place. The list itself is not
    // somewhere else: arriving on its fragment (after agreeing to the habits) can focus it.
    const active = document.activeElement;
    if (active && active !== document.body && !active.matches("[data-channel-scroller]")) {
      linked.current = null;
      return;
    }
    const reply = threadId !== null && id !== threadId;
    const target = document.querySelector<HTMLElement>(`${reply ? "[data-thread-rail]" : "[data-channel-scroller]"} [data-message="${CSS.escape(id)}"]`);
    if (!target) return;
    linked.current = null;
    target.tabIndex = -1;
    target.focus({ preventScroll: !reply });
  });

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
    <TemboProvider store={tembo}>
    <ModerationProvider
      actions={moderation}
      canReport={channel.kind !== "DIRECT"}
      canModerate={channel.capabilities.canModerate}
      canRestore={me.capabilities.isAdmin}
    >
      <div className="channel-view" data-channel={channel.slug} data-thread={thread ? "open" : "closed"}>
        <div className="channel-view__grid">
        <section aria-label={title} className="channel-view__main" onWheel={(event) => wheelScrollsList(event.nativeEvent, event.currentTarget)}>
          {children}
          <MessageList
            key={channel.id}
            state={state}
            store={store}
            channel={channel}
            viewer={me.user}
            now={now}
            composer={composer}
            names={names}
            people={people}
            firstUnreadId={divider.current ?? null}
            openThreadId={threadId}
            threadHref={threadHref}
            onOpenThread={openThread}
            focusMessageId={messageId}
            retry={refresh}
            announce={announce}
          />
          {posting ? (
            <Composer
              channel={channel}
              me={me}
              parentId={null}
              composer={composer}
              shareables={shareables}
              findMoments={findMoments}
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
            composer={composer}
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
    </ModerationProvider>
    </TemboProvider>
  );
}
