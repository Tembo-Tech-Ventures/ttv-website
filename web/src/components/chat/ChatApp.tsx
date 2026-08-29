import React, { useEffect, useRef, useState } from "react";
import { PiArrowLeftBold, PiCaretUpDownBold, PiPlusBold } from "react-icons/pi";
import Composer, { type ComposerHandle } from "@/components/chat/Composer";
import ConversationList, {
  conversationTitle,
  NewChatButton,
} from "@/components/chat/ConversationList";
import ConversationSheet from "@/components/chat/ConversationSheet";
import Transcript from "@/components/chat/Transcript";
import type { ChatMessage, ChatSession } from "@/components/chat/types";
import { DASHBOARD_LINKS } from "@/components/shells/DashboardShell";

/** Matches Tailwind's `lg:`, the breakpoint the rail appears at. */
const DESKTOP_QUERY = "(min-width: 64rem)";

/**
 * Links back into the rest of the dashboard. Taken from the shell this route no
 * longer renders, so nothing — Logout in particular — becomes unreachable just
 * because the user is on the chat page. "Ask AI" is dropped as the current page.
 */
const APP_NAV = DASHBOARD_LINKS.filter((link) => link.href !== "/dashboard/ask");

/** How many prior turns to send back as context. Matches the previous UI. */
const HISTORY_TURNS = 8;

/**
 * Stand-in round trip for `mockMode`, so the dev page renders like the real one.
 * Long enough that "while an answer is in flight" is a state a test can actually
 * act in — a real retrieval round trip is seconds, not milliseconds.
 */
const MOCK_LATENCY_MS = 1_500;

const NO_SESSIONS: ChatSession[] = [];
const NO_MESSAGES: ChatMessage[] = [];

interface ChatAppProps {
  /** Renders against fixed data and never calls the API. Used by /dev/chat-ui. */
  mockMode?: boolean;
  initialSessions?: ChatSession[];
  initialMessages?: ChatMessage[];
}

/**
 * The Ask AI page.
 *
 * Layout contract, which the rest of the components depend on: this renders
 * inside `ChatLayout`, a container of definite height that cannot scroll. The
 * header, the conversation rail and the composer are fixed-size flex children;
 * the transcript is the only region with `overflow-y-auto`. Anything added here
 * must keep that true, or the composer starts sliding off the bottom of a phone
 * screen again.
 */
export default function ChatApp({
  mockMode = false,
  initialSessions = NO_SESSIONS,
  initialMessages = NO_MESSAGES,
}: ChatAppProps) {
  const [sessions, setSessions] = useState<ChatSession[]>(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    initialSessions[0]?.id ?? null
  );
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  /**
   * Bumped whenever the transcript is replaced wholesale, so the scroll
   * position resets. Message count cannot stand in for this — two different
   * conversations frequently have the same number of turns.
   */
  const [conversationEpoch, setConversationEpoch] = useState(0);
  /**
   * The same counter, readable synchronously. In-flight requests capture it and
   * discard their result if the user has moved on — otherwise an answer that
   * resolves after "New chat" reinstates the conversation the user just left.
   */
  const conversationEpochRef = useRef(0);
  const composerRef = useRef<ComposerHandle | null>(null);

  function beginNewTranscript() {
    conversationEpochRef.current += 1;
    setConversationEpoch(conversationEpochRef.current);
  }

  const activeTitle = conversationTitle(sessions, activeSessionId);

  // A sheet left open while the window grows past `lg` would sit in the top
  // layer as a `display: none` modal, swallowing every click on the page.
  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_QUERY);
    function close() {
      if (desktop.matches) setSheetOpen(false);
    }
    close();
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, []);

  function openSheet() {
    // The trigger is `lg:hidden`, so this is unreachable on desktop today. The
    // guard keeps that true if the class ever drifts, because the failure mode
    // is severe: an invisible modal that blocks every click on the page.
    if (window.matchMedia(DESKTOP_QUERY).matches) return;
    setSheetOpen(true);
  }

  useEffect(() => {
    if (mockMode) return;
    let cancelled = false;
    async function loadSessions() {
      setHistoryLoading(true);
      try {
        const response = await fetch("/api/chat/sessions");
        const payload = (await response.json()) as {
          sessions?: ChatSession[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? "Unable to load chats");
        if (!cancelled) setSessions(payload.sessions ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load chats");
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }
    void loadSessions();
    return () => {
      cancelled = true;
    };
  }, [mockMode]);

  async function refreshSessions(nextActiveSessionId: string) {
    if (mockMode) return;
    const response = await fetch("/api/chat/sessions");
    const payload = (await response.json()) as { sessions?: ChatSession[] };
    if (response.ok) {
      setSessions(payload.sessions ?? []);
      setActiveSessionId(nextActiveSessionId);
    }
  }

  async function selectSession(sessionId: string) {
    setSheetOpen(false);
    if (sessionId === activeSessionId || loading) return;
    setError("");
    setHistoryLoading(true);
    try {
      if (mockMode) {
        setActiveSessionId(sessionId);
        beginNewTranscript();
        return;
      }
      const response = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}`);
      const payload = (await response.json()) as {
        messages?: ChatMessage[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Unable to load chat");
      setActiveSessionId(sessionId);
      setMessages(payload.messages ?? []);
      beginNewTranscript();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load chat");
    } finally {
      setHistoryLoading(false);
    }
  }

  function startNewChat() {
    setActiveSessionId(null);
    setMessages([]);
    setError("");
    setSheetOpen(false);
    // Any answer still in flight belongs to the conversation being left, so
    // stop reporting it as this one's pending work.
    setLoading(false);
    beginNewTranscript();
    composerRef.current?.focus();
  }

  async function sendMessage(message: string) {
    if (loading) return;
    setLoading(true);
    setError("");
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: message }];
    setMessages(nextMessages);
    // The transcript this answer belongs to. If the user starts a new chat or
    // opens a different conversation while it is in flight, the result is stale
    // and applying it would resurrect the conversation they just left.
    const epoch = conversationEpochRef.current;
    const isStale = () => conversationEpochRef.current !== epoch;

    try {
      if (mockMode) {
        // Deliberately not instant. Answering in the same synchronous batch as
        // the question would collapse the two renders into one, hiding the
        // loading state and the scroll behaviour that depends on the question
        // rendering alone first — which is most of what this page has to get
        // right.
        await new Promise((resolve) => {
          setTimeout(resolve, MOCK_LATENCY_MS);
        });
        if (isStale()) return;
        setActiveSessionId(activeSessionId ?? "mock-session-new");
        setMessages([
          ...nextMessages,
          {
            role: "assistant",
            // Long on purpose: a short answer fits on screen, and then the
            // scroll behaviour this page exists to get right is unobservable.
            content:
              "Based on the session, the practical next step is to validate the problem with users before building.\n\n" +
              "**Start with interviews**\n\n" +
              "- Keep them to fifteen minutes; you are looking for a pattern, not a pitch.\n" +
              "- Ask what they did last time the problem came up, not what they would do.\n" +
              "- Compare what people say with their actual behaviour. The gap is the finding.\n\n" +
              "**Read the evidence honestly**\n\n" +
              "- A repeated pain point beats a single strong opinion.\n" +
              "- Enthusiasm from someone who has never tried to solve the problem is politeness.\n" +
              "- If nobody has a workaround today, you may be early rather than right.\n\n" +
              "**Then cut scope**\n\n" +
              "- Use the evidence to narrow the MVP to one workflow.\n" +
              "- Pick the workflow that tests your riskiest assumption, not the one that demos best.\n" +
              "- Write down what result would tell you the assumption was wrong.\n\n" +
              "**Common traps**\n\n" +
              "- Treating a demo as an interview. If you are presenting, you are not learning.\n" +
              "- Recruiting only from your own network, which agrees with you by construction.\n" +
              "- Writing the summary from memory a week later instead of the same afternoon.\n" +
              "- Counting interest as evidence. Interest is free; a workaround costs something.\n\n" +
              "**What to bring back**\n\n" +
              "- Five quotes, verbatim, attributed to a role rather than a name.\n" +
              "- One sentence naming the workflow you are replacing.\n" +
              "- The assumption you are testing, and the result that would falsify it.\n\n" +
              "The common failure mode in the cohort was building the second version of something nobody had asked for the first version of.",
          },
        ]);
        return;
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          sessionId: activeSessionId,
          conversationHistory: nextMessages.slice(-HISTORY_TURNS),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        sessionId?: string;
        answer: string;
        citations: ChatMessage["citations"];
      };
      if (!response.ok) throw new Error(payload.error ?? "Unable to send message");
      if (isStale()) return;

      const nextSessionId = payload.sessionId ?? activeSessionId;
      setActiveSessionId(nextSessionId);
      setMessages([
        ...nextMessages,
        { role: "assistant", content: payload.answer, citations: payload.citations },
      ]);
      if (nextSessionId) await refreshSessions(nextSessionId);
    } catch (err) {
      if (isStale()) return;
      setError(err instanceof Error ? err.message : "Unable to send message");
    } finally {
      if (!isStale()) setLoading(false);
    }
  }

  const conversationList = (
    <ConversationList
      sessions={sessions}
      activeSessionId={activeSessionId}
      loading={historyLoading}
      // Switching while an answer is in flight is refused by `selectSession`;
      // say so in the UI rather than swallowing the tap.
      disabled={loading}
      onSelect={(sessionId) => void selectSession(sessionId)}
    />
  );

  return (
    <div className="flex min-h-0 flex-1">
      {/* Desktop rail. The way back into the product stays visible at both ends. */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-rule bg-dark/40 lg:flex">
        <div className="shrink-0 border-b border-rule px-3 py-3">
          <a
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-ink-secondary transition hover:bg-ink-primary/[0.06] hover:text-ink-primary"
          >
            <PiArrowLeftBold className="h-4 w-4" aria-hidden="true" />
            Back to dashboard
          </a>
        </div>
        <div className="shrink-0 px-3 py-3">
          <NewChatButton full onClick={startNewChat} />
        </div>
        <nav
          aria-label="Conversations"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4"
        >
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-subhead text-ink-muted">
            Recent
          </p>
          {conversationList}
        </nav>
        <nav aria-label="Site" className="shrink-0 border-t border-rule px-2 py-2">
          {APP_NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="block rounded-lg px-3 py-1.5 text-sm text-ink-muted transition hover:bg-ink-primary/[0.06] hover:text-ink-primary"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-rule px-2 sm:px-4 lg:px-6">
          <a
            href="/dashboard"
            aria-label="Back to dashboard"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition hover:bg-ink-primary/[0.06] hover:text-ink-primary lg:hidden"
          >
            <PiArrowLeftBold className="h-4 w-4" aria-hidden="true" />
          </a>

          {/*
            On mobile the title doubles as the conversation switcher, so history
            costs no extra chrome; on desktop the rail already lists it, so the
            title is plain text. These are two elements rather than one button
            with `lg:pointer-events-none`, because that suppresses only *pointer*
            events — a keyboard user could still activate it on desktop and open
            a `display: none` modal that swallows every click on the page.
          */}
          <h1 className="flex min-w-0 flex-1 justify-center lg:justify-start">
            <span className="hidden truncate font-body text-base font-semibold text-ink-primary lg:inline">
              {activeTitle}
            </span>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              onClick={openSheet}
              className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 transition hover:bg-ink-primary/[0.06] lg:hidden"
            >
              <span className="truncate font-body text-sm font-semibold text-ink-primary">
                {activeTitle}
              </span>
              <PiCaretUpDownBold className="h-3 w-3 shrink-0 text-ink-muted" aria-hidden="true" />
            </button>
          </h1>

          <button
            type="button"
            // Not "New chat": on an empty conversation the switcher above is
            // also titled "New chat", and two identically named buttons doing
            // different things is ambiguous to anyone not seeing the icons.
            aria-label="Start a new chat"
            onClick={startNewChat}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition hover:bg-ink-primary/[0.06] hover:text-ink-primary lg:hidden"
          >
            <PiPlusBold className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <Transcript
          messages={messages}
          loading={loading}
          conversationEpoch={conversationEpoch}
          onPickPrompt={(prompt) => void sendMessage(prompt)}
        />

        {/*
          Above the composer rather than at the end of the transcript: a failed
          conversation switch leaves the transcript showing the previous chat,
          parked wherever the reader left it, so an inline banner is invisible
          exactly when it matters.
        */}
        {error && (
          <p
            role="alert"
            className="mx-auto w-full max-w-3xl shrink-0 px-3 pt-2 text-sm text-red-200 sm:px-6"
          >
            {error}
          </p>
        )}

        <Composer
          ref={composerRef}
          disabled={loading}
          onSend={(message) => void sendMessage(message)}
        />
      </div>

      <ConversationSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        label="Conversations"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
          <h2 className="font-body text-base font-semibold text-ink-primary">Conversations</h2>
          <NewChatButton onClick={startNewChat} label="New" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
          {conversationList}
        </div>
        <nav
          aria-label="Site"
          className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-t border-rule px-4 py-3"
        >
          {APP_NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm text-ink-muted transition hover:text-ink-primary"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </ConversationSheet>
    </div>
  );
}
