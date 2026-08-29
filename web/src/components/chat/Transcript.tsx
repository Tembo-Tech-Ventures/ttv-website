import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PiArrowDownBold } from "react-icons/pi";
import MarkdownMessage from "@/components/chat/MarkdownMessage";
import { formatTimestamp } from "@/lib/recordings/time-utils";
import type { ChatMessage, Citation } from "@/components/chat/types";

/**
 * Distance from the bottom, in px, still treated as "reading the latest". The
 * same number decides whether a new answer auto-follows and whether the
 * jump-to-latest pill is showing, so the two can never disagree.
 */
const NEAR_BOTTOM_PX = 100;

const EXAMPLE_PROMPTS = [
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
        <a
          key={`${citation.recordingId}-${citation.startTime}-${index}`}
          href={citationHref(citation)}
          className="group rounded-xl border border-rule bg-dark/40 p-3 transition hover:border-primary/50 hover:bg-dark/70"
        >
          <span className="mb-1.5 flex flex-wrap items-center gap-2">
            {citation.sourceNumber !== undefined && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-subhead text-primary">
                Source {citation.sourceNumber}
              </span>
            )}
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
            ? "max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-dark"
            : // Long-form answers read badly in a chat bubble, so only the
              // user's own turn gets one.
              "max-w-full text-sm leading-relaxed text-ink-primary"
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

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center pt-6 text-center">
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
  messages: ChatMessage[];
  loading: boolean;
  /** A saved conversation is being fetched; the transcript shown is the old one. */
  loadingConversation?: boolean;
  onPickPrompt: (prompt: string) => void;
  /**
   * Changes whenever the transcript is replaced wholesale — a different
   * conversation loaded, or a new chat started. Message-array length is not a
   * usable signal for that: conversations come in user/assistant pairs, so two
   * different four-message conversations collide.
   */
  conversationEpoch: number;
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
}: TranscriptProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const previousCountRef = useRef(messages.length);
  /** Index of a question whose answer has not arrived yet, or null. */
  const pendingQuestionRef = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /** Latest messages, readable from effects that must not depend on them. */
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

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
        className="h-full overflow-y-auto overscroll-contain [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-5 sm:px-6">
          {loadingConversation ? (
            // Otherwise tapping a conversation does nothing visible until the
            // fetch lands, and the transcript on screen is still the old one.
            <p className="py-10 text-center text-sm text-ink-muted">Loading conversation…</p>
          ) : messages.length === 0 ? (
            <EmptyState onPick={onPickPrompt} />
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
