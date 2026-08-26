import React, { useEffect, useMemo, useRef, useState } from "react";
import MarkdownMessage from "@/components/recordings/MarkdownMessage";
import { formatTimestamp } from "@/lib/recordings/time-utils";

interface Citation {
  sourceNumber?: number;
  recordingId: string;
  title: string;
  startTime: number;
  endTime: number;
  url?: string;
  text: string;
}

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  createdAt?: number;
}

interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  latestMessage: string | null;
}

interface ChatInterfaceProps {
  mockMode?: boolean;
  initialSessions?: ChatSession[];
  initialMessages?: Message[];
}

const EXAMPLE_PROMPTS = [
  "What were the main action items from mentor hours?",
  "Explain the advice about customer interviews.",
  "Where did we discuss technical architecture tradeoffs?",
];

const DEFAULT_SESSIONS: ChatSession[] = [];
const DEFAULT_MESSAGES: Message[] = [];

function formatSessionDate(timestamp: number) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1_000));
}

function truncate(text: string | null, maxLength = 96) {
  if (!text) return "No messages yet";
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

export default function ChatInterface({
  mockMode = false,
  initialSessions = DEFAULT_SESSIONS,
  initialMessages = DEFAULT_MESSAGES,
}: ChatInterfaceProps) {
  const [sessions, setSessions] = useState<ChatSession[]>(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    initialSessions[0]?.id ?? null
  );
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const lastAssistantCitations = useMemo(
    () =>
      messages
        .toReversed()
        .find((message) => message.role === "assistant" && message.citations?.length)
        ?.citations ?? [],
    [messages]
  );

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  async function refreshSessions(nextActiveSessionId: string) {
    if (mockMode) return;
    const response = await fetch("/api/chat/sessions");
    const payload = (await response.json()) as { sessions?: ChatSession[] };
    if (response.ok) {
      setSessions(payload.sessions ?? []);
      setActiveSessionId(nextActiveSessionId);
    }
  }

  async function loadSession(sessionId: string) {
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
        messages?: Message[];
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
    inputRef.current?.focus();
  }

  async function sendMessage(event?: React.FormEvent) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || loading) return;

    setInput("");
    setLoading(true);
    setError("");
    const nextMessages: Message[] = [...messages, { role: "user", content: message }];
    setMessages(nextMessages);

    try {
      if (mockMode) {
        const mockSessionId = activeSessionId ?? "mock-session-new";
        setActiveSessionId(mockSessionId);
        setMessages([
          ...nextMessages,
          {
            role: "assistant",
            content:
              "Based on the session, the practical next step is to validate the problem with users before building.\n\n- Start with short customer interviews.\n- Compare what people say with their actual behaviour.\n- Use the evidence to narrow the MVP scope. [1]",
            citations: lastAssistantCitations,
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
          conversationHistory: nextMessages.slice(-8),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        sessionId?: string;
        answer: string;
        citations: Citation[];
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to send message");
      }
      const nextSessionId = payload.sessionId ?? activeSessionId;
      setActiveSessionId(nextSessionId);
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: payload.answer,
          citations: payload.citations,
        },
      ]);
      if (nextSessionId) await refreshSessions(nextSessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send message");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void sendMessage();
  }

  return (
    <div className="grid min-h-[72vh] overflow-hidden rounded-2xl border border-white/10 bg-dark/50 shadow-2xl shadow-dark/40 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className="border-b border-white/10 bg-dark/70 p-4 lg:border-b-0 lg:border-r">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Discussions
            </p>
            <h3 className="text-lg font-semibold text-white">Session chat</h3>
          </div>
          <button
            type="button"
            onClick={startNewChat}
            className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-dark transition hover:bg-primary/90"
          >
            New
          </button>
        </div>

        <div className="space-y-2">
          {historyLoading && sessions.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/50">
              Loading discussions…
            </p>
          ) : sessions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.03] p-3 text-sm text-white/45">
              Your saved chats will appear here after the first question.
            </p>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => void loadSession(session.id)}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  activeSessionId === session.id
                    ? "border-primary/60 bg-primary/10"
                    : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                }`}
              >
                <span className="line-clamp-1 text-sm font-semibold text-white">
                  {session.title}
                </span>
                <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/50">
                  {truncate(session.latestMessage)}
                </span>
                <span className="mt-2 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-white/35">
                  <span>{session.messageCount} messages</span>
                  <span>{formatSessionDate(session.updatedAt)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="flex min-h-[72vh] flex-col">
        <div className="border-b border-white/10 bg-gradient-to-r from-teal/15 via-dark/30 to-primary/10 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
            Transcript assistant
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            Ask across recordings and jump to cited moments.
          </h2>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <div className="mx-auto flex max-w-2xl flex-col items-center justify-center py-14 text-center">
              <div className="mb-5 rounded-3xl border border-primary/20 bg-primary/10 px-5 py-4 text-primary">
                Ask about session decisions, technical advice, or next steps.
              </div>
              <div className="grid w-full gap-2 sm:grid-cols-3">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => {
                      setInput(prompt);
                      inputRef.current?.focus();
                    }}
                    className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-left text-sm text-white/65 transition hover:border-primary/40 hover:bg-primary/10 hover:text-white"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={message.id ?? index}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <article
                  className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[78%] ${
                    message.role === "user"
                      ? "bg-primary text-dark shadow-lg shadow-primary/10"
                      : "border border-white/10 bg-white/[0.06] text-white"
                  }`}
                >
                  {message.role === "assistant" ? (
                    <MarkdownMessage content={message.content} />
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                  {message.citations && message.citations.length > 0 && (
                    <div className="mt-4 grid gap-2">
                      {message.citations.map((citation, citationIndex) => (
                        <a
                          key={`${citation.recordingId}-${citation.startTime}-${citationIndex}`}
                          href={
                            citation.url ??
                            `/dashboard/sessions/${citation.recordingId}?t=${Math.floor(citation.startTime)}`
                          }
                          className="group rounded-xl border border-primary/20 bg-dark/45 p-3 transition hover:border-primary/50 hover:bg-dark/70"
                        >
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            {citation.sourceNumber && (
                              <span className="rounded-full bg-primary/15 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
                                Source {citation.sourceNumber}
                              </span>
                            )}
                            <span className="inline-flex shrink-0 items-center rounded-md bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary group-hover:bg-primary/25">
                              {formatTimestamp(citation.startTime)}
                            </span>
                            <span className="text-xs font-semibold text-white/80 group-hover:text-white">
                              {citation.title}
                            </span>
                          </div>
                          <p className="line-clamp-2 text-xs text-white/55">
                            {citation.text}
                          </p>
                        </a>
                      ))}
                    </div>
                  )}
                </article>
              </div>
            ))
          )}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white/55">
                Thinking…
              </div>
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">
              {error}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={sendMessage} className="border-t border-white/10 bg-dark/75 p-4">
          <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-2 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Ask a question. Shift+Enter adds a new line."
              className="max-h-32 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-white placeholder:text-white/35 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="self-end rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-dark transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
