import { memo, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { PiEyeSlash, PiFlag } from "react-icons/pi";
import type { AuthorSummary, Message, ReactionKind } from "@/lib/platform/contracts";
import Avatar from "@/components/platform/ui/Avatar";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import RoleBadge from "@/components/platform/ui/RoleBadge";
import TemboMark from "@/components/platform/ui/TemboMark";
import TextReaction, { REACTIONS } from "@/components/platform/ui/TextReaction";
import type { ChannelActions } from "./actions";
import { clock, dayKey, dayLabel, fullTime, moderationNotice, threadSummary } from "./channel-format";
import EmbedCard from "./EmbedCard";
import MessageBody from "./MessageBody";
import { DeleteConfirm, EditForm } from "./MessageEdit";
import MessageMenu from "./MessageMenu";
import { citationIcon, TemboAnswerFoot } from "./TemboAnswer";

export type MessageVariant = "channel" | "thread" | "parent";

type MessageItemProps = {
  message: Message;
  viewerId: string | null;
  now: number;
  /** Names in this conversation, for reading mentions. */
  names: readonly string[];
  /** Authors seen in this conversation, for the faces on a thread link. */
  people: ReadonlyMap<string, AuthorSummary>;
  variant?: MessageVariant;
  /** Show the day before the time (the thread rail has no day headings). */
  withDay?: boolean;
  /** Null when this person can only read. */
  actions: ChannelActions | null;
  /** The message's thread is open beside the list. */
  threadOpen?: boolean;
  threadHref?: (messageId: string) => string;
  onOpenThread?: (messageId: string, trigger: HTMLElement) => void;
  /** Polite announcements: a failed reaction, a deleted message. */
  announce: (text: string) => void;
};

const MAX_FACES = 3;

function TimeStamp({ at, now, withDay }: { at: number; now: number; withDay: boolean }) {
  const text = withDay && dayKey(at) !== dayKey(now) ? `${dayLabel(at, now)} ${clock(at)}` : clock(at);
  return (
    <time dateTime={new Date(at).toISOString()} title={fullTime(at)} className="tabular-nums">
      {text}
    </time>
  );
}

function MessageAvatar({ message }: { message: Message }) {
  if (message.authorKind === "TEMBO") return <TemboMark size="md" decorative />;
  if (message.deleted || message.author.id === null) return <span aria-hidden="true" className="channel-avatar-blank" />;
  const mentor = message.author.roleBadges.some((badge) => badge.kind === "MENTOR");
  return <Avatar id={message.author.id} name={message.author.name} src={message.author.avatarUrl ?? undefined} mentor={mentor} decorative />;
}

function ModerationNote({ message, viewerId }: { message: Message; viewerId: string | null }) {
  const notice = moderationNotice(message, viewerId);
  if (!notice) return null;
  const Icon = notice.state === "HIDDEN" ? PiEyeSlash : PiFlag;
  return (
    <div className="channel-moderation" data-moderation={notice.state}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>
        <strong className="font-semibold text-ink-primary">{notice.title}.</strong> {notice.detail}
      </p>
    </div>
  );
}

function TemboContent({ message, names }: { message: Message; names: readonly string[] }) {
  return (
    <div className="channel-tembo">
      <MessageBody body={message.body} names={names} />
      {message.citations.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Sources">
          {message.citations.map((citation) => (
            <li key={citation.href}>
              <a href={citation.href} className={cx("channel-cite", FOCUS_RING)}>
                {citationIcon(citation)}
                {citation.title}
              </a>
            </li>
          ))}
        </ul>
      )}
      <TemboAnswerFoot message={message} />
    </div>
  );
}

function MemberContent({ message, names, compact }: { message: Message; names: readonly string[]; compact: boolean }) {
  const hidden = message.moderation?.state === "HIDDEN";
  return (
    <div className={cx(hidden && "channel-message__hidden")}>
      {message.body && <MessageBody body={message.body} names={names} />}
      {message.embeds.map((embed, index) => (
        <EmbedCard
          key={embed.type === "project" ? `p-${embed.journeyId}-${embed.version}`
            : embed.type === "sessionClip" ? `c-${embed.recordingId}-${embed.startSeconds}` : `u-${index}`}
          embed={embed}
          compact={compact}
        />
      ))}
    </div>
  );
}

/** Faces of the people in a thread, as far as this view has met them. */
function ThreadFaces({ message, people }: { message: Message; people: ReadonlyMap<string, AuthorSummary> }) {
  const faces = message.thread.participantIds
    .map((id) => people.get(id))
    .filter((person): person is AuthorSummary & { id: string } => person !== undefined && person.id !== null)
    .slice(0, MAX_FACES);
  if (faces.length === 0) return null;
  return (
    <span aria-hidden="true" className="channel-faces">
      {faces.map((person) => (
        <Avatar key={person.id} id={person.id} name={person.name} src={person.avatarUrl ?? undefined} size="md" decorative />
      ))}
    </span>
  );
}

function ThreadLink({ message, now, people, open, href, onOpen }: {
  message: Message; now: number; people: ReadonlyMap<string, AuthorSummary>; open: boolean; href: string;
  onOpen?: (messageId: string, trigger: HTMLElement) => void;
}) {
  const summary = threadSummary(message, now);
  function click(event: MouseEvent<HTMLAnchorElement>) {
    // Let a new tab or window open the thread's own URL.
    if (!onOpen || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onOpen(message.id, event.currentTarget);
  }
  return (
    <a
      href={href}
      data-thread-trigger={message.id}
      aria-current={open ? "true" : undefined}
      onClick={click}
      className={cx("channel-thread-link", FOCUS_RING)}
    >
      <ThreadFaces message={message} people={people} />
      <span className="channel-thread-link__count">{summary.replies}</span>
      {summary.last && <span className="channel-thread-link__last">· {summary.last}</span>}
    </a>
  );
}

function Reactions({ message, onReact }: { message: Message; onReact?: (kind: ReactionKind, active: boolean) => void }) {
  if (message.deleted || message.reactions.length === 0) return null;
  return (
    <ul className="channel-reactions" aria-label="Reactions">
      {message.reactions.map((reaction) => (
        <li key={reaction.kind}>
          <TextReaction
            kind={reaction.kind}
            count={reaction.count}
            mine={reaction.mine}
            onChange={onReact ? (active) => onReact(reaction.kind, active) : undefined}
          />
        </li>
      ))}
    </ul>
  );
}

/** Name, role badges (only those the server sent), time and "(edited)"; then the actions button. */
function MessageMeta({ message, nameId, now, withDay, children }: {
  message: Message; nameId: string; now: number; withDay: boolean; children: ReactNode;
}) {
  return (
    <div className="channel-meta">
      <span id={nameId} className={cx("channel-author", message.deleted && "text-ink-muted")}>
        {message.deleted ? "Deleted message" : message.author.name}
      </span>
      {!message.deleted && message.author.roleBadges.map((badge) => <RoleBadge key={`${badge.kind}-${badge.label}`} badge={badge} />)}
      <TimeStamp at={message.createdAt} now={now} withDay={withDay} />
      {message.edited && !message.deleted && <span>(edited)</span>}
      {children}
    </div>
  );
}

function MessageContent({ message, names, compact }: { message: Message; names: readonly string[]; compact: boolean }) {
  if (message.deleted) return <p className="channel-body text-ink-muted italic">This message was deleted.</p>;
  if (message.authorKind === "TEMBO") return <TemboContent message={message} names={names} />;
  return <MemberContent message={message} names={names} compact={compact} />;
}

/** Who may do what to a message, from the viewer, the message and the available actions. */
function permissions(message: Message, viewerId: string | null, actions: ChannelActions | null, variant: MessageVariant, canOpen: boolean) {
  const own = message.authorKind === "USER" && viewerId !== null && message.author.id === viewerId;
  const root = variant === "channel" && message.parentId === null;
  const live = actions !== null && !message.deleted;
  return {
    own,
    react: live && message.moderation?.state !== "HIDDEN",
    change: live && own,
    reply: root && canOpen && !message.deleted,
    thread: root && message.thread.replyCount > 0,
  };
}

/**
 * One message in the channel or a thread: who wrote it and with which role
 * (only the badges the server sends), when, the words and shared work, text
 * reactions, the way into its thread, and the author's own edit and delete.
 */
function MessageItem({
  message, viewerId, now, names, people, variant = "channel", withDay = false, actions, threadOpen = false,
  threadHref, onOpenThread, announce,
}: MessageItemProps) {
  const [mode, setMode] = useState<"read" | "edit" | "delete">("read");
  const menuButton = useRef<HTMLButtonElement>(null);
  const article = useRef<HTMLElement>(null);
  const nameId = useId();
  const can = permissions(message, viewerId, actions, variant, onOpenThread !== undefined);

  function backToMenu() {
    setMode("read");
    requestAnimationFrame(() => menuButton.current?.focus());
  }

  async function react(kind: ReactionKind, active: boolean) {
    try {
      await actions?.react(message.id, kind, active);
    } catch {
      announce(`Couldn't ${active ? "add" : "remove"} “${REACTIONS[kind]}”. Try again.`);
    }
  }

  async function save(body: string) {
    try {
      await actions?.edit(message.id, body);
      backToMenu();
    } catch {
      announce("Couldn't save your edit. Your changes are still in the box.");
    }
  }

  async function remove() {
    try {
      // The actions go with the message: focus returns to the list it sits in.
      const home = article.current?.closest<HTMLElement>("[data-focus-home]");
      await actions?.remove(message.id);
      setMode("read");
      announce("Message deleted.");
      requestAnimationFrame(() => home?.focus());
    } catch {
      announce("Couldn't delete the message. Try again.");
    }
  }

  return (
    <article
      ref={article}
      aria-labelledby={nameId}
      data-message={message.id}
      data-variant={variant}
      data-own={can.own || undefined}
      data-deleted={message.deleted || undefined}
      className={cx("channel-message", variant !== "channel" && "channel-message--compact")}
    >
      <div className="channel-avatar">
        <MessageAvatar message={message} />
      </div>
      <div className="min-w-0">
        <MessageMeta message={message} nameId={nameId} now={now} withDay={withDay}>
          {mode === "read" && (can.react || can.change || can.reply) && (
            <MessageMenu
              message={message}
              buttonRef={menuButton}
              can={can}
              onReply={() => onOpenThread?.(message.id, menuButton.current ?? document.body)}
              onReact={(kind, active) => void react(kind, active)}
              onEdit={() => setMode("edit")}
              onDelete={() => setMode("delete")}
            />
          )}
        </MessageMeta>

        {mode === "edit" && !message.deleted ? (
          <EditForm initial={message.body} onSave={save} onCancel={backToMenu} />
        ) : (
          <MessageContent message={message} names={names} compact={variant === "parent"} />
        )}

        <ModerationNote message={message} viewerId={viewerId} />
        {mode === "delete" && <DeleteConfirm onDelete={remove} onKeep={backToMenu} />}
        <Reactions message={message} onReact={can.react ? (kind, active) => void react(kind, active) : undefined} />
        {can.thread && (
          <ThreadLink
            message={message}
            now={now}
            people={people}
            open={threadOpen}
            href={threadHref?.(message.id) ?? `?thread=${encodeURIComponent(message.id)}`}
            onOpen={onOpenThread}
          />
        )}
      </div>
    </article>
  );
}

/**
 * Memoised: the list re-renders whenever the store publishes (each anchor the
 * reader scrolls past, each poll), and its props are stable between those, so
 * only messages that changed render again.
 */
export default memo(MessageItem);
