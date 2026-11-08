import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PiArrowDownBold } from "react-icons/pi";
import MarkdownMessage from "@/components/chat/MarkdownMessage";
import { Button, Chip, FOCUS_RING, INSET_FOCUS_RING, RAISED, RoleBadge, TemboMark, cx } from "@/components/platform/ui";
import { formatTimestamp } from "@/lib/recordings/time-utils";
import type { ChatMessage, Citation } from "@/components/chat/types";

/**
 * Distance from the bottom, in px, still treated as "reading the latest". The
 * same number decides whether a new answer auto-follows and whether the
 * jump-to-latest pill is showing, so the two can never disagree.
 */
const NEAR_BOTTOM_PX = 100;

const NO_SUGGESTIONS: string[] = [];

/** Tembo's badge, as in channels: its own mark and "AI", never a person's avatar. */
const AI_BADGE = { kind: "AI", label: "AI" } as const;

const FALLBACK_PROMPTS = [
  "What were the main action items from mentor hours?",
  "Explain the advice about customer interviews.",
  "Where did we discuss architecture tradeoffs?",
];

/** How long an announcement stays in the DOM before it is cleared. */
const ANNOUNCEMENT_TTL_MS = 5_000;

/**
 * Answers are markdown. Announcing them raw reads the asterisks and brackets
 * out loud, so flatten to something a screen reader can speak.
 */
export function toPlainText(markdown: string) {
  return (
    markdown
      .replace(/```[\s\S]*?```/g, " code block ")
      .replace(/^\s*[-*]\s+/gm, "")
      .replace(/^\s*#{1,6}\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      // Links before bare citation markers, so `[text](url)` is not left as a
      // stray `(url)` by the citation rule.
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[\d+\]/g, "")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/\*\*(.+?)\*\*|__(.+?)__/g, "$1$2")
      // Underscore emphasis only when it wraps a word, so `snake_case` survives.
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/(^|\s)_(.+?)_(?=\s|$|[.,;:!?])/g, "$1$2")
      .replace(/`/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function citationHref(citation: Citation) {
  return (
    citation.url ??
    `/dashboard/sessions/${citation.recordingId}?t=${Math.floor(citation.startTime)}`
  );
}

function Citations({ citations }: { citations: Citation[] }) {
  return (
    <div className="mt-3 grid gap-2">
      {citations.map((citation, index) => (
        // A card that is a link: the kit's card recipe (RAISED on a hairline) on the link itself, with the ring.
        <a
          key={`${citation.recordingId}-${citation.startTime}-${index}`}
          href={citationHref(citation)}
          className={cx(
            "group block rounded-[1.125rem] border border-hairline p-3 transition-colors duration-150 hover:border-ink-primary/30 motion-reduce:transition-none",
            RAISED,
            FOCUS_RING,
          )}
        >
          <span className="mb-1.5 flex flex-wrap items-center gap-2">
            {citation.sourceNumber !== undefined && <Chip>Source {citation.sourceNumber}</Chip>}
            <Chip>{formatTimestamp(citation.startTime)}</Chip>
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

function MessageRow({ message, index }: { message: ChatMessage; index: number }) {
  const isUser = message.role === "user";
  return (
    <div
      data-message-index={index}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <article
        className={
          isUser
            ? // Lifted, not peach: peach is the Send button's alone.
              "max-w-[85%] rounded-2xl rounded-br-md border border-hairline bg-ink-primary/8 px-4 py-2.5 text-sm leading-relaxed text-ink-primary"
            : // Long-form answers read badly in a chat bubble, so only the
              // user's own turn gets one.
              "max-w-full text-sm leading-relaxed text-ink-primary"
        }
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <>
            {/* Every answer says who wrote it: an AI (QA3-03). */}
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-primary" data-chat-author>
              <TemboMark size="sm" decorative />
              Tembo
              <RoleBadge badge={AI_BADGE} />
            </p>
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

function Welcome({ onPick, suggestions, name }: { onPick: (prompt: string) => void; suggestions: string[]; name: string }) {
  const prompts = suggestions.length > 0 ? suggestions : FALLBACK_PROMPTS;
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center pt-6 text-center">
      {/* Body type: the page's one Mattone heading is its h1 (ChatApp). */}
      <h2 className="text-2xl text-ink-primary">{name}</h2>
      <p className="mt-2 text-sm text-ink-secondary">
        Ask about your sessions, your program, or anything you need help with. Just you and Tembo: nothing here is
        posted in a channel.
      </p>
      <div className="mt-6 grid w-full gap-2">
        {prompts.map((prompt) => (
          <Button key={prompt} variant="quiet" onClick={() => onPick(prompt)} className="h-auto w-full justify-start py-3">
            {/* The words wrap, left aligned, inside the kit's single-line button. */}
            <span className="min-w-0 text-left whitespace-normal">{prompt}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

interface TranscriptProps {
  messages: ChatMessage[];
  loading: boolean;
  /**
   * A saved conversation is being fetched. The transcript is replaced while it
   * loads rather than dimmed, so showing this for a fast load would read as a
   * flash of missing content; `ChatApp` only sets it once the load is slow
   * enough to be worth acknowledging.
   */
  loadingConversation?: boolean;
  onPickPrompt: (prompt: string) => void;
  /**
   * Changes whenever the transcript is replaced wholesale — a different
   * conversation loaded, or a new chat started. Message-array length is not a
   * usable signal for that: conversations come in user/assistant pairs, so two
   * different four-message conversations collide.
   */
  conversationEpoch: number;
  /** Contextual prompts from the API, based on the user's actual recordings. */
  suggestions?: string[];
  /** The page's name on the empty state: "Ask Tembo privately", unlike a channel's "Ask Tembo here". */
  assistantName?: string;
}

/**
 * The page's only scroll surface.
 *
 * `min-h-0` on the wrapper is load-bearing: a flex item defaults to
 * `min-height: auto` and so refuses to shrink below its content, which would
 * push the composer off the bottom of the viewport instead of letting this
 * region scroll.
 *
 * Scroll policy: when an answer arrives, the question that prompted it is
 * pinned to the top of the viewport so the answer is read from its beginning
 * rather than its end. (Pinning at the moment the question is *sent* does
 * nothing — it is the last node, so the scroller is already clamped at the
 * bottom. The pin has to wait until there is content beneath it.) Auto-follow
 * only applies to messages that arrive unprompted, and only when the reader is
 * already near the bottom.
 */
export default function Transcript({
  messages,
  loading,
  loadingConversation = false,
  onPickPrompt,
  conversationEpoch,
  suggestions = NO_SUGGESTIONS,
  assistantName = "Ask Tembo",
}: TranscriptProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const previousCountRef = useRef(messages.length);
  /** Index of a question whose answer has not arrived yet, or null. */
  const pendingQuestionRef = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /** Latest messages, readable from effects that must not depend on them. */
  const messagesRef = useRef(messages);
  useLayoutEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
  }, []);

  const pinToTop = useCallback((index: number) => {
    scrollerRef.current
      ?.querySelector(`[data-message-index="${index}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  // Mount only: land on the newest message instead of animating down to it.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, []);

  // A different conversation, or a new one: start at the bottom of it rather
  // than inheriting wherever the reader had scrolled the previous transcript.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    previousCountRef.current = messagesRef.current.length;
    pendingQuestionRef.current = null;
    setNearBottom(true);
  }, [conversationEpoch]);

  useEffect(() => {
    if (messages.length === previousCountRef.current) return;
    const appended = messages.length > previousCountRef.current;
    previousCountRef.current = messages.length;
    const last = messages.at(-1);
    if (!appended || !last) return;

    if (last.role === "user") {
      // Show the question and the thinking indicator straight away. Pinning it
      // to the top cannot happen yet — it is the last node, so the scroller is
      // already clamped — but without scrolling at all, both the question and
      // the indicator sit below the fold and the send looks like it failed.
      pendingQuestionRef.current = messages.length - 1;
      scrollToBottom();
      return;
    }

    setAnnouncement(toPlainText(last.content));
    const pending = pendingQuestionRef.current;
    pendingQuestionRef.current = null;
    // A reader who scrolled away while waiting is reading something else. The
    // pin exists to avoid yanking people around; it must not do the yanking.
    if (!nearBottom) return;
    if (pending !== null) {
      pinToTop(pending);
      return;
    }
    scrollToBottom();
  }, [messages, nearBottom, pinToTop, scrollToBottom]);

  useEffect(() => {
    if (loading) setAnnouncement("Thinking…");
  }, [loading]);

  // Clear once spoken. Left in place, the last answer stays in the DOM as a
  // second copy, which a screen reader re-reads in browse mode.
  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(""), ANNOUNCEMENT_TTL_MS);
    return () => clearTimeout(timer);
  }, [announcement]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    function handleScroll() {
      if (!scroller) return;
      const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      setNearBottom(distance <= NEAR_BOTTOM_PX);
    }
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      {/*
        The document no longer scrolls, so this region has to be focusable or
        Page Up / Space stop working for anyone without a mouse. A named,
        focusable scroll container is the documented exception to
        jsx-a11y/no-noninteractive-tabindex (WCAG 2.1.1); the rule is turned off
        for this file in .oxlintrc.json rather than the tabIndex being dropped.
      */}
      <section
        ref={scrollerRef}
        data-chat-scroller="true"
        tabIndex={0}
        aria-label="Conversation"
        className={cx("h-full overflow-y-auto overscroll-contain [scrollbar-gutter:stable]", INSET_FOCUS_RING)}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-5 sm:px-6">
          {loadingConversation ? (
            // Otherwise tapping a conversation does nothing visible until the
            // fetch lands, and the transcript on screen is still the old one.
            <p className="py-10 text-center text-sm text-ink-muted">Loading conversation…</p>
          ) : messages.length === 0 ? (
            <Welcome onPick={onPickPrompt} suggestions={suggestions} name={assistantName} />
          ) : (
            messages.map((message, index) => (
              <MessageRow key={message.id ?? index} message={message} index={index} />
            ))
          )}

          {loading && <p className="text-sm text-ink-muted">Thinking…</p>}
        </div>
      </section>

      {/*
        Announcements are pushed here deliberately rather than by making the
        transcript itself a live region: loading a saved conversation replaces
        every child at once, which a live region would read out in full.
      */}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {!nearBottom && (
        // The kit's quiet button over the sheet's own colour, so words scrolling under it never show through.
        <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg bg-[var(--sheet,var(--color-dark))]">
          <Button variant="quiet" size="sm" onClick={() => scrollToBottom()} icon={<PiArrowDownBold className="size-3" />}>
            Jump to latest
          </Button>
        </span>
      )}
    </div>
  );
}
