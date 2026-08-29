/**
 * Shared building blocks for the `/dev/chat-proto/*` layout prototypes.
 *
 * The three prototypes differ only in chrome and navigation; the transcript,
 * composer and conversation list are identical so that screenshots compare the
 * thing actually under review. Everything here follows one rule: the transcript
 * is the *only* scroll container on the page. Every other region is a fixed-size
 * flex sibling, so the page never scrolls and the composer never leaves the
 * viewport.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PiArrowDownBold, PiArrowUpBold, PiPlusBold } from "react-icons/pi";
import MarkdownMessage from "@/components/recordings/MarkdownMessage";
import { formatTimestamp } from "@/lib/recordings/time-utils";
import {
  EXAMPLE_PROMPTS,
  MOCK_CONVERSATIONS,
  type MockConversation,
  type MockMessage,
} from "@/components/chat/prototype/mock-data";

/** Distance from the bottom, in px, still treated as "pinned to latest". */
const STICK_TO_BOTTOM_THRESHOLD = 100;

/* -------------------------------------------------------------------------- */
/* Conversation list                                                          */
/* -------------------------------------------------------------------------- */

interface ConversationListProps {
  activeId: string;
  onSelect: (id: string) => void;
  conversations?: MockConversation[];
  /** Compact rows drop the preview line — used inside narrow rails. */
  compact?: boolean;
}

export function ConversationList({
  activeId,
  onSelect,
  conversations = MOCK_CONVERSATIONS,
  compact = false,
}: ConversationListProps) {
  return (
    <ul className="space-y-1">
      {conversations.map((conversation) => {
        const isActive = conversation.id === activeId;
        return (
          <li key={conversation.id}>
            <button
              type="button"
              aria-current={isActive ? "true" : undefined}
              onClick={() => onSelect(conversation.id)}
              className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                isActive
                  ? "bg-primary/15 text-ink-primary"
                  : "text-ink-secondary hover:bg-ink-primary/[0.06] hover:text-ink-primary"
              }`}
            >
              <span className="line-clamp-1 text-sm font-medium">{conversation.title}</span>
              {!compact && (
                <span className="mt-0.5 line-clamp-1 text-xs text-ink-muted">
                  {conversation.latestMessage}
                </span>
              )}
              <span className="mt-1 block text-[11px] uppercase tracking-subhead text-ink-muted">
                {conversation.updatedLabel}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function NewChatButton({
  onClick,
  label = "New chat",
  full = false,
}: {
  onClick?: () => void;
  label?: string;
  full?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-rule bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20 ${
        full ? "w-full" : ""
      }`}
    >
      <PiPlusBold className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Transcript                                                                 */
/* -------------------------------------------------------------------------- */

function Citations({ citations }: { citations: NonNullable<MockMessage["citations"]> }) {
  return (
    <div className="mt-3 grid gap-2">
      {citations.map((citation) => (
        <a
          key={`${citation.recordingId}-${citation.startTime}`}
          href={`/dashboard/sessions/${citation.recordingId}?t=${citation.startTime}`}
          className="group rounded-xl border border-rule bg-dark/40 p-3 transition hover:border-primary/50 hover:bg-dark/70"
        >
          <span className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-subhead text-primary">
              Source {citation.sourceNumber}
            </span>
            <span className="rounded-md bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
              {formatTimestamp(citation.startTime)}
            </span>
            <span className="text-xs font-semibold text-ink-secondary group-hover:text-ink-primary">
              {citation.title}
            </span>
          </span>
          <span className="line-clamp-2 block text-xs text-ink-muted">{citation.text}</span>
        </a>
      ))}
    </div>
  );
}

export function MessageBubble({ message }: { message: MockMessage }) {
  const isUser = message.role === "user";
  return (
    <div data-message-id={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <article
        className={
          isUser
            ? "max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-dark"
            : "max-w-full text-sm leading-relaxed text-ink-primary"
        }
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <>
            <MarkdownMessage content={message.content} />
            {message.citations && message.citations.length > 0 && (
              <Citations citations={message.citations} />
            )}
          </>
        )}
      </article>
    </div>
  );
}

export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center text-center">
      <h2 className="text-2xl tracking-display text-ink-primary">Ask across your sessions</h2>
      <p className="mt-2 text-sm text-ink-secondary">
        Answers cite the recording and the moment they came from.
      </p>
      <div className="mt-6 grid w-full gap-2">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            className="rounded-xl border border-rule bg-ink-primary/[0.04] px-4 py-3 text-left text-sm text-ink-secondary transition hover:border-primary/40 hover:bg-primary/10 hover:text-ink-primary"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

interface TranscriptProps {
  messages: MockMessage[];
  /** Extra classes for the reading column (prototypes vary the max width). */
  columnClassName?: string;
  /** Suggested prompts send straight away rather than filling the composer. */
  onPickPrompt?: (prompt: string) => void;
  children?: React.ReactNode;
}

/**
 * The single scroll surface. `min-h-0` is load-bearing: without it a flex child
 * refuses to shrink below its content height and the scroll escapes to the page.
 *
 * Scroll policy follows NN/g's finding that yanking readers to the end of a
 * response means they never see its start: a newly sent question is pinned to
 * the *top* of the viewport so the answer streams into the space below it, and
 * auto-follow only re-engages once the reader is already near the bottom.
 */
export function Transcript({
  messages,
  columnClassName = "",
  onPickPrompt,
  children,
}: TranscriptProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const previousCountRef = useRef(messages.length);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
  }, []);

  // Land pinned to the newest message rather than animating up from the top.
  // Mount only — every later scroll is governed by the append effect below.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, []);

  useEffect(() => {
    if (messages.length === previousCountRef.current) return;
    previousCountRef.current = messages.length;
    const scroller = scrollerRef.current;
    const last = messages.at(-1);
    if (!scroller || !last) return;

    if (last.role === "user") {
      scroller
        .querySelector(`[data-message-id="${last.id}"]`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
      setAtBottom(false);
      return;
    }
    if (atBottom) scrollToBottom();
  }, [messages, atBottom, scrollToBottom]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    function handleScroll() {
      if (!scroller) return;
      const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      setAtBottom(distance <= STICK_TO_BOTTOM_THRESHOLD);
    }
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollerRef}
        data-chat-scroller="true"
        role="log"
        // Polite, and scoped to the finished message rather than each token —
        // announcing a stream token by token is unusable with a screen reader.
        aria-live="polite"
        aria-relevant="additions"
        className="h-full overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
      >
        <div className={`mx-auto flex flex-col gap-6 px-4 py-5 sm:px-6 ${columnClassName}`}>
          {messages.length === 0 ? (
            <EmptyState onPick={(prompt) => onPickPrompt?.(prompt)} />
          ) : (
            messages.map((message) => <MessageBubble key={message.id} message={message} />)
          )}
          {children}
        </div>
      </div>

      {!atBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom()}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-rule bg-bg-raised/95 px-3 py-1.5 text-xs font-semibold text-ink-secondary shadow-lg backdrop-blur transition hover:text-ink-primary"
        >
          <PiArrowDownBold className="mr-1.5 inline h-3 w-3" aria-hidden="true" />
          Jump to latest
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Composer                                                                   */
/* -------------------------------------------------------------------------- */

/** Max textarea height before it starts scrolling internally (~6 lines). */
const COMPOSER_MAX_HEIGHT = 168;

interface ComposerProps {
  onSend: (value: string) => void;
  placeholder?: string;
  /** Floating variant sits on the transcript instead of on a solid bar. */
  floating?: boolean;
  columnClassName?: string;
}

export function Composer({
  onSend,
  placeholder = "Ask about your sessions…",
  floating = false,
  columnClassName = "",
}: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [enterSends, setEnterSends] = useState(true);

  // On touch keyboards Enter is the newline key users expect; sending on it is a
  // well-known source of half-written messages. Only bind it for fine pointers.
  useEffect(() => {
    setEnterSends(!window.matchMedia("(pointer: coarse)").matches);
  }, []);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, [value]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  }

  return (
    <div
      className={
        floating
          ? "pointer-events-none px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          : "border-t border-rule bg-dark/80 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6"
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className={`pointer-events-auto mx-auto flex items-end gap-2 rounded-2xl border border-rule p-2 focus-within:border-primary/50 ${
          floating ? "bg-bg-raised/95 shadow-2xl shadow-dark/50 backdrop-blur" : "bg-ink-primary/[0.05]"
        } ${columnClassName}`}
      >
        <label className="sr-only" htmlFor="chat-proto-composer">
          Message
        </label>
        <textarea
          id="chat-proto-composer"
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          enterKeyHint={enterSends ? "send" : "enter"}
          onKeyDown={(event) => {
            // `isComposing` keeps an IME's Enter (commit candidate) from sending.
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            if (!enterSends || event.shiftKey) return;
            event.preventDefault();
            submit();
          }}
          placeholder={placeholder}
          className="min-h-10 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-base text-ink-primary placeholder:text-ink-muted focus:outline-none sm:text-sm"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          aria-label="Send message"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-dark transition hover:bg-primary/90 disabled:opacity-40"
        >
          <PiArrowUpBold className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Drawer                                                                     */
/* -------------------------------------------------------------------------- */

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Slide in from the left (default) or up from the bottom. */
  side?: "left" | "bottom";
  label: string;
}

/**
 * A minimal off-canvas panel, built on the native `<dialog>` so that the modal
 * behaviours come from the platform rather than from hand-rolled listeners:
 * `showModal()` gives a focus trap, an inert background, Escape-to-dismiss and
 * focus restored to whatever opened it. The element's own chrome is reset,
 * since a drawer is a full-bleed edge panel rather than a centred box.
 */
export function Drawer({ open, onClose, children, side = "left", label }: DrawerProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      onClose={onClose}
      className="fixed inset-0 m-0 h-full max-h-full w-full max-w-full border-0 bg-transparent p-0 backdrop:bg-dark/70 backdrop:backdrop-blur-sm lg:hidden"
    >
      {/*
        Tap-outside-to-close as a real button rather than a click handler on the
        dialog: `method="dialog"` closes without any JS, and it lands in the tab
        order so the same escape hatch exists for keyboard and screen readers.
      */}
      <form method="dialog" className="absolute inset-0">
        <button type="submit" aria-label="Close menu" className="h-full w-full cursor-default" />
      </form>

      <div
        className={
          side === "left"
            ? "absolute inset-y-0 left-0 flex w-[84%] max-w-sm flex-col border-r border-rule bg-bg-raised pb-[env(safe-area-inset-bottom)] shadow-2xl"
            : "absolute inset-x-0 bottom-0 flex max-h-[75dvh] flex-col rounded-t-3xl border-t border-rule bg-bg-raised pb-[env(safe-area-inset-bottom)] shadow-2xl"
        }
      >
        {side === "bottom" && (
          <span className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-ink-muted" />
        )}
        {children}
      </div>
    </dialog>
  );
}
