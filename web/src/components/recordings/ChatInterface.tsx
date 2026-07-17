import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { PiArrowUpBold, PiListBold, PiSparkleDuotone, PiStopFill } from "react-icons/pi";
import type { ZodType } from "zod";
import { ChatHistory } from "@/components/recordings/ChatHistory";
import { ChatMessage } from "@/components/recordings/ChatMessage";
import {
  apiErrorPayloadSchema,
  conversationDetailPayloadSchema,
  conversationListPayloadSchema,
  conversationPayloadSchema,
} from "@/lib/chat/client-contracts";
import { consumeChatStream } from "@/lib/chat/stream";
import type {
  ChatCitation,
  ChatConversationView,
  ChatMessageView,
  RetrievalStatus,
} from "@/lib/chat/types";

const suggestions = [
  "Explain a concept from my recent sessions",
  "Help me turn a lesson into a practice project",
  "Quiz me on something I have learned",
];

interface FailedMessage {
  content: string;
  removeOptimisticMessage: boolean;
}

async function readJson<T>(response: Response, schema: ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new Error("The chat API returned an invalid response.");
  return parsed.data;
}

function compareConversations(
  first: ChatConversationView,
  second: ChatConversationView
): number {
  return Date.parse(second.updatedAt) - Date.parse(first.updatedAt);
}

export function upsertConversation(
  conversations: ChatConversationView[],
  conversation: ChatConversationView
): ChatConversationView[] {
  return [
    conversation,
    ...conversations.filter((item) => item.id !== conversation.id),
  ].sort(compareConversations);
}

function retrievalLabel(status: RetrievalStatus | null): string | null {
  switch (status) {
    case "grounded":
      return "Using your TTV sessions";
    case "general":
      return "Answering from general knowledge";
    case "unavailable":
      return "Session search is temporarily unavailable";
    case null:
      return null;
  }
}

export function ChatInterface() {
  const [conversations, setConversations] = useState<ChatConversationView[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [input, setInput] = useState("");
  const [streamedAnswer, setStreamedAnswer] = useState("");
  const [streamedCitations, setStreamedCitations] = useState<ChatCitation[]>([]);
  const [retrievalStatus, setRetrievalStatus] = useState<RetrievalStatus | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState("");
  const [failedMessage, setFailedMessage] = useState<FailedMessage | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const initialize = async () => {
      try {
        const response = await fetch("/api/chat/conversations", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unable to load conversations.");
        const payload = await readJson(response, conversationListPayloadSchema);
        setConversations(payload.conversations);

        const first = payload.conversations[0];
        if (first) {
          const detailResponse = await fetch(`/api/chat/conversations/${first.id}`, {
            signal: controller.signal,
          });
          if (!detailResponse.ok) throw new Error("Unable to load conversation.");
          const detail = await readJson(detailResponse, conversationDetailPayloadSchema);
          setActiveConversationId(detail.conversation.id);
          setMessages(detail.messages);
        }
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(cause instanceof Error ? cause.message : "Unable to load chat.");
        }
      } finally {
        if (!controller.signal.aborted) setInitializing(false);
      }
    };

    void initialize();
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: streamedAnswer ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, sending, streamedAnswer]);

  useEffect(
    () => () => {
      requestControllerRef.current?.abort();
    },
    []
  );

  const startNewConversation = () => {
    if (sending) return;
    setActiveConversationId(null);
    setMessages([]);
    setInput("");
    setError("");
    setFailedMessage(null);
    setHistoryOpen(false);
  };

  const openConversation = async (conversationId: string) => {
    if (sending || conversationId === activeConversationId) {
      setHistoryOpen(false);
      return;
    }

    setLoadingConversation(true);
    setError("");
    try {
      const response = await fetch(`/api/chat/conversations/${conversationId}`);
      if (!response.ok) throw new Error("Unable to load conversation.");
      const payload = await readJson(response, conversationDetailPayloadSchema);
      setActiveConversationId(payload.conversation.id);
      setMessages(payload.messages);
      setFailedMessage(null);
      setHistoryOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load conversation.");
    } finally {
      setLoadingConversation(false);
    }
  };

  const deleteConversation = async (conversationId: string) => {
    if (sending || !window.confirm("Delete this conversation permanently?")) return;

    const response = await fetch(`/api/chat/conversations/${conversationId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setError("Unable to delete conversation.");
      return;
    }

    const remaining = conversations.filter((item) => item.id !== conversationId);
    setConversations(remaining);
    if (activeConversationId === conversationId) {
      const next = remaining[0];
      if (next) await openConversation(next.id);
      else startNewConversation();
    }
  };

  const ensureConversation = async (): Promise<ChatConversationView> => {
    const existing = conversations.find(
      (conversation) => conversation.id === activeConversationId
    );
    if (existing) return existing;

    const response = await fetch("/api/chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error("Unable to start a conversation.");
    const payload = await readJson(response, conversationPayloadSchema);
    setActiveConversationId(payload.conversation.id);
    setConversations((current) => upsertConversation(current, payload.conversation));
    return payload.conversation;
  };

  const sendMessage = async (message: string, replaceFailed = false) => {
    const trimmed = message.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setInput("");
    setError("");
    setFailedMessage(null);
    setStreamedAnswer("");
    setStreamedCitations([]);
    setRetrievalStatus(null);
    if (replaceFailed) setMessages((current) => current.slice(0, -1));

    let optimisticId: string | null = null;
    try {
      const conversation = await ensureConversation();
      optimisticId = `pending-${crypto.randomUUID()}`;
      const optimisticMessage: ChatMessageView = {
        id: optimisticId,
        role: "user",
        content: trimmed,
        citations: [],
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, optimisticMessage]);

      const controller = new AbortController();
      requestControllerRef.current = controller;
      const response = await fetch(
        `/api/chat/conversations/${conversation.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed }),
          signal: controller.signal,
        }
      );
      if (!response.ok) {
        const payload = await readJson(response, apiErrorPayloadSchema);
        throw new Error(payload.error ?? "Unable to send message.");
      }
      if (!response.body) throw new Error("The chat response did not start.");

      const completed = await consumeChatStream(response.body, (event) => {
        switch (event.type) {
          case "metadata":
            setMessages((current) =>
              current.map((item) => (item.id === optimisticId ? event.userMessage : item))
            );
            setConversations((current) =>
              upsertConversation(current, event.conversation)
            );
            setStreamedCitations(event.citations);
            setRetrievalStatus(event.retrievalStatus);
            break;
          case "delta":
            setStreamedAnswer((current) => current + event.content);
            break;
          case "done":
            setMessages((current) => [...current, event.message]);
            setStreamedAnswer("");
            setStreamedCitations([]);
            setRetrievalStatus(null);
            break;
          case "error":
            throw new Error(event.error);
        }
      });
      if (!completed) throw new Error("The chat response ended unexpectedly.");
    } catch (cause) {
      const stopped = cause instanceof DOMException && cause.name === "AbortError";
      setError(
        stopped
          ? "Response stopped. You can retry when you are ready."
          : cause instanceof Error
            ? cause.message
            : "Unable to send message."
      );
      setFailedMessage({
        content: trimmed,
        removeOptimisticMessage: optimisticId !== null,
      });
      setStreamedAnswer("");
      setStreamedCitations([]);
      setRetrievalStatus(null);
    } finally {
      requestControllerRef.current = null;
      setSending(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const history = (
    <ChatHistory
      activeConversationId={activeConversationId}
      conversations={conversations}
      disabled={sending}
      onClose={() => {
        setHistoryOpen(false);
      }}
      onDelete={(conversationId) => {
        void deleteConversation(conversationId);
      }}
      onNew={startNewConversation}
      onOpen={(conversationId) => {
        void openConversation(conversationId);
      }}
    />
  );

  const currentStreamingMessage: ChatMessageView | null = streamedAnswer
    ? {
        id: "streaming-response",
        role: "assistant",
        content: streamedAnswer,
        citations: streamedCitations,
        createdAt: new Date().toISOString(),
      }
    : null;
  const statusLabel = retrievalLabel(retrievalStatus);

  return (
    <div className="relative flex h-[calc(100dvh-12.5rem)] min-h-[36rem] overflow-hidden rounded-2xl border border-white/10 bg-[#013936]/80 shadow-[0_28px_90px_rgba(0,0,0,0.2)] backdrop-blur-sm">
      <div className="hidden lg:block">{history}</div>
      {historyOpen && (
        <div className="absolute inset-0 z-30 flex lg:hidden">
          {history}
          <button
            type="button"
            className="flex-1 bg-black/50"
            aria-label="Close conversation history"
            onClick={() => {
              setHistoryOpen(false);
            }}
          />
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col" aria-label="TTV AI chat">
        <header className="flex items-center gap-3 border-b border-white/10 bg-[#06413d]/75 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => {
              setHistoryOpen(true);
            }}
            className="rounded-lg p-2 text-white/65 transition hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Open conversation history"
          >
            <PiListBold className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
            <PiSparkleDuotone className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-white">TTV Learning Coach</h3>
            <p className="text-xs text-white/45">Gemma 4 · grounded in your learning</p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-7" aria-live="polite">
          {initializing || loadingConversation ? (
            <div className="grid h-full place-items-center">
              <div className="flex items-center gap-3 text-sm text-white/45">
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                Loading your conversation…
              </div>
            </div>
          ) : messages.length === 0 && !sending ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center text-center">
              <span className="grid h-16 w-16 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-[0_20px_60px_rgba(242,141,104,0.12)]">
                <PiSparkleDuotone className="h-8 w-8" aria-hidden="true" />
              </span>
              <h3 className="mt-6 text-xl font-bold text-white sm:text-2xl">
                What would you like to understand?
              </h3>
              <p className="mt-2 max-w-lg text-sm leading-6 text-white/50">
                Ask about a TTV session, work through a technical idea, or turn what you
                are learning into something practical.
              </p>
              <div className="mt-7 grid w-full gap-2 sm:grid-cols-3">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void sendMessage(suggestion)}
                    className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-left text-xs leading-5 text-white/60 transition hover:border-primary/30 hover:bg-primary/[0.08] hover:text-white"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl space-y-5">
              {messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
              {currentStreamingMessage && (
                <ChatMessage message={currentStreamingMessage} />
              )}
              {sending && !streamedAnswer && (
                <div className="flex items-center gap-2 text-sm text-white/45">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                  Thinking with your learning context…
                </div>
              )}
              {sending && statusLabel && (
                <p className="text-xs text-white/35">{statusLabel}</p>
              )}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-white/10 bg-[#003733]/90 p-3 sm:p-4">
          {error && (
            <div
              role="alert"
              className="mx-auto mb-3 flex max-w-4xl items-center justify-between gap-3 rounded-xl border border-red-200/15 bg-red-950/20 px-3 py-2 text-sm text-red-100/80"
            >
              <span>{error}</span>
              {failedMessage && !sending && (
                <button
                  type="button"
                  onClick={() =>
                    void sendMessage(
                      failedMessage.content,
                      failedMessage.removeOptimisticMessage
                    )
                  }
                  className="shrink-0 font-semibold text-primary hover:underline"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          <form
            onSubmit={submit}
            className="mx-auto flex max-w-4xl items-end gap-2 rounded-2xl border border-white/15 bg-black/15 p-2 shadow-inner focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10"
          >
            <label htmlFor="chat-message" className="sr-only">
              Message the TTV Learning Coach
            </label>
            <textarea
              id="chat-message"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
              }}
              onKeyDown={handleComposerKeyDown}
              placeholder="Ask about a lesson, idea, or project…"
              maxLength={2_000}
              rows={1}
              disabled={sending || initializing}
              className="max-h-40 min-h-11 min-w-0 flex-1 resize-y bg-transparent px-3 py-2.5 text-sm leading-6 text-white outline-none placeholder:text-white/30 disabled:cursor-not-allowed"
            />
            {sending ? (
              <button
                type="button"
                onClick={() => requestControllerRef.current?.abort()}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/10 text-white transition hover:bg-white/15"
                aria-label="Stop response"
              >
                <PiStopFill aria-hidden="true" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || initializing}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-dark shadow-[0_8px_24px_rgba(242,141,104,0.2)] transition hover:-translate-y-0.5 hover:bg-[#ff9d79] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="Send message"
              >
                <PiArrowUpBold aria-hidden="true" />
              </button>
            )}
          </form>
          <div className="mx-auto mt-2 flex max-w-4xl justify-between px-2 text-[0.68rem] text-white/30">
            <span>Enter to send · Shift+Enter for a new line</span>
            {input.length > 1_600 && <span>{input.length}/2,000</span>}
          </div>
        </div>
      </section>
    </div>
  );
}
