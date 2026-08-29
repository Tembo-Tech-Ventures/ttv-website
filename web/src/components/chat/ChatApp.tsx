import React, { useEffect, useRef, useState } from "react";
import { PiArrowLeftBold, PiCaretUpDownBold, PiPlusBold } from "react-icons/pi";
import Composer, { type ComposerHandle } from "@/components/chat/Composer";
import ConversationList, { NewChatButton } from "@/components/chat/ConversationList";
import ConversationSheet from "@/components/chat/ConversationSheet";
import Transcript from "@/components/chat/Transcript";
import type { ChatMessage, ChatSession } from "@/components/chat/types";

/** Links back into the rest of the dashboard, shown below the conversation list. */
const APP_NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/sessions", label: "Sessions" },
  { href: "/dashboard/portfolio", label: "Portfolio" },
  { href: "/dashboard/profile", label: "Profile" },
];

/** How many prior turns to send back as context. Matches the previous UI. */
const HISTORY_TURNS = 8;

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
  const composerRef = useRef<ComposerHandle | null>(null);

  const activeTitle =
    sessions.find((session) => session.id === activeSessionId)?.title ?? "New chat";

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
    composerRef.current?.focus();
  }

  async function sendMessage(message: string) {
    if (loading) return;
    setLoading(true);
    setError("");
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: message }];
    setMessages(nextMessages);

    try {
      if (mockMode) {
        setActiveSessionId(activeSessionId ?? "mock-session-new");
        setMessages([
          ...nextMessages,
          {
            role: "assistant",
            content:
              "Based on the session, the practical next step is to validate the problem with users before building.\n\n- Start with short customer interviews.\n- Compare what people say with their actual behaviour.\n- Use the evidence to narrow the MVP scope.",
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

      const nextSessionId = payload.sessionId ?? activeSessionId;
      setActiveSessionId(nextSessionId);
      setMessages([
        ...nextMessages,
        { role: "assistant", content: payload.answer, citations: payload.citations },
      ]);
      if (nextSessionId) await refreshSessions(nextSessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send message");
    } finally {
      setLoading(false);
    }
  }

  const conversationList = (
    <ConversationList
      sessions={sessions}
      activeSessionId={activeSessionId}
      loading={historyLoading}
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
            title is inert text.
          */}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 transition hover:bg-ink-primary/[0.06] lg:pointer-events-none lg:justify-start"
          >
            <span className="truncate font-body text-sm font-semibold text-ink-primary lg:text-base">
              {activeTitle}
            </span>
            <PiCaretUpDownBold className="h-3 w-3 shrink-0 text-ink-muted lg:hidden" aria-hidden="true" />
          </button>

          <button
            type="button"
            aria-label="New chat"
            onClick={startNewChat}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition hover:bg-ink-primary/[0.06] hover:text-ink-primary lg:hidden"
          >
            <PiPlusBold className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <Transcript
          messages={messages}
          loading={loading}
          error={error}
          onPickPrompt={(prompt) => void sendMessage(prompt)}
        />

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
