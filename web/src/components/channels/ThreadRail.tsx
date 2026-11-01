import { useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type RefObject, type UIEvent } from "react";
import { PiArrowBendUpLeft, PiChatsCircle, PiX } from "react-icons/pi";
import type { AuthorSummary, Channel, Me, Message } from "@/lib/platform/contracts";
import type { ChannelThreadState } from "@/lib/platform/client/channel";
import type { Composer as ChannelComposer } from "@/lib/platform/client/composer";
import { useOutbox } from "@/lib/platform/client/hooks/composer";
import Button, { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import IconButton from "@/components/platform/ui/IconButton";
import type { Shareables } from "./actions";
import { channelTitle, plural } from "./channel-format";
import Composer from "./Composer";
import MessageItem from "./MessageItem";
import { prefersReducedMotion } from "./motion";
import Outbox from "./Outbox";
import { PostingNote } from "./PostingNote";

/** What the rail shows: the store's thread, or the server-rendered one before the store has it. */
export type ThreadView = Pick<ChannelThreadState, "parentId" | "status" | "messages" | "parent" | "hasOlder" | "loadingOlder">;

type ThreadRailProps = {
  thread: ThreadView;
  channel: Channel;
  me: Me;
  now: number;
  composer: ChannelComposer;
  shareables: Shareables | null;
  names: readonly string[];
  people: ReadonlyMap<string, AuthorSummary>;
  mentionPeople: readonly AuthorSummary[];
  headingRef: RefObject<HTMLHeadingElement>;
  onClose: () => void;
  onLoadOlder: () => void;
  onRetry: () => void;
  announce: (text: string) => void;
};

/**
 * One thread beside the channel: its first message, the replies, and a reply
 * box. On a wide sheet it is a second column with its own scroll; on a narrow
 * one it takes the sheet's place, with "Back to channel". Escape closes it.
 */
export default function ThreadRail({
  thread, channel, me, now, composer, shareables, names, people, mentionPeople, headingRef, onClose, onLoadOlder,
  onRetry, announce,
}: ThreadRailProps) {
  const scroller = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const nearEnd = useRef(false);
  const lastReply = useRef<string | undefined>(undefined);
  const parent = thread.parent;
  const replies = thread.messages;
  const replyCount = parent?.thread.replyCount ?? replies.length;
  const newest = replies.at(-1)?.id;
  const threadPeople = useMemo(
    () => new Set([parent?.author.id, ...replies.map((reply) => reply.author.id)].filter((id): id is string => typeof id === "string")),
    [parent, replies],
  );

  // A new reply scrolls into view when the reader is near the end or wrote it.
  useLayoutEffect(() => {
    const element = scroller.current;
    const previous = lastReply.current;
    lastReply.current = newest;
    if (!element || !newest || previous === undefined || previous === newest) return;
    const near = element.scrollHeight - element.scrollTop - element.clientHeight < 160;
    if (near || replies.at(-1)?.author.id === me.user.id) {
      element.scrollTo({ top: element.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
  }, [newest, replies, me.user.id]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    nearEnd.current = false;
  }, [thread.parentId]);

  // A reply the reader just sent waits at the end of the thread: show it, and keep following it
  // there as it changes (sending, then sent or failed with its buttons).
  const pending = useOutbox(composer, thread.parentId).length;
  const pendingBefore = useRef(pending);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && pending > pendingBefore.current) {
      nearEnd.current = true;
      element.scrollTop = element.scrollHeight;
    }
    pendingBefore.current = pending;
  }, [pending]);
  useEffect(() => {
    const element = scroller.current;
    const inner = content.current;
    if (!element || !inner || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (nearEnd.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // Menus and the mention list close themselves first.
    if ((event.target as HTMLElement).closest("[role=menu], [role=listbox]")) return;
    event.preventDefault();
    onClose();
  }

  function trackEnd(event: UIEvent<HTMLElement>) {
    const element = event.currentTarget;
    nearEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 160;
  }

  const posting = channel.archivedAt === null && channel.capabilities.canPost;

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape closes the rail from anywhere inside it
    <aside aria-labelledby="channel-thread-title" className="channel-rail" data-thread-rail={thread.parentId} onKeyDown={onKeyDown}>
      <div className="channel-rail__head">
        <button type="button" onClick={onClose} className={cx("channel-rail__back", FOCUS_RING)}>
          <PiArrowBendUpLeft aria-hidden="true" className="size-5" />
          Back to channel
        </button>
        <PiChatsCircle aria-hidden="true" className="channel-rail__icon size-5 shrink-0 text-ink-secondary" />
        <h2 id="channel-thread-title" ref={headingRef} tabIndex={-1} className="channel-rail__title">
          Thread
          <span className="channel-rail__where"> {channelTitle(channel)}</span>
        </h2>
        <span className="channel-rail__count">{plural(replyCount, "reply", "replies")}</span>
        <IconButton label="Close thread" icon={<PiX className="size-4.5" />} variant="ghost" size="sm" onClick={onClose} className="channel-rail__close" />
      </div>

      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll container */}
      <section ref={scroller} tabIndex={0} aria-label="Replies" onScroll={trackEnd} className={cx("channel-rail__body", FOCUS_RING)} data-focus-home>
        <div ref={content}>
        {parent ? (
          <div className="channel-row" data-thread-parent>
            <MessageItem
              message={parent}
              viewerId={me.user.id}
              now={now}
              names={names}
              people={people}
              variant="parent"
              withDay
              actions={composer}
              announce={announce}
            />
          </div>
        ) : thread.status === "loading" ? null : (
          <p className="channel-status">The first message isn't loaded here.</p>
        )}

        <p className="channel-rail__divider">
          <span>{plural(replyCount, "reply", "replies")}</span>
        </p>

        {thread.hasOlder && (
          <div className="flex justify-center pb-2">
            <Button size="sm" variant="ghost" loading={thread.loadingOlder} onClick={onLoadOlder}>
              Load earlier replies
            </Button>
          </div>
        )}
        {thread.status === "loading" && replies.length === 0 && (
          <output className="channel-status">
            <span className="channel-spinner" aria-hidden="true" /> Loading replies…
          </output>
        )}
        {thread.status === "error" && (
          <div className="channel-status flex flex-col items-start gap-2">
            <p>Couldn't load the replies.</p>
            <Button size="sm" onClick={onRetry}>Try again</Button>
          </div>
        )}
        {thread.status === "removed" && <p className="channel-status">This thread is no longer available.</p>}
        {thread.status === "ready" && replies.length === 0 && (
          <p className="channel-status">No replies yet.{posting ? " Start the thread below." : ""}</p>
        )}

        {replies.length > 0 && (
          <ol className="channel-messages">
            {replies.map((reply: Message, index) => (
              <li key={reply.id}>
                <div className="channel-row">
                  <MessageItem
                    message={reply}
                    viewerId={me.user.id}
                    now={now}
                    names={names}
                    people={people}
                    variant="thread"
                    withDay={index === 0 || replies[index - 1].createdAt < reply.createdAt - 6 * 60 * 60 * 1000}
                    actions={composer}
                    announce={announce}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
        <Outbox composer={composer} parentId={thread.parentId} viewer={me.user} names={names} />
        </div>
      </section>

      {thread.status !== "removed" && (posting ? (
        <Composer
          channel={channel}
          me={me}
          parentId={thread.parentId}
          composer={composer}
          shareables={shareables}
          people={mentionPeople}
          threadPeople={threadPeople}
          label="Reply in thread"
          variant="thread"
        />
      ) : (
        <PostingNote channel={channel} />
      ))}
    </aside>
  );
}
