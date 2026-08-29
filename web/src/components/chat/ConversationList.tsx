import React from "react";
import { PiPlusBold } from "react-icons/pi";
import type { ChatSession } from "@/components/chat/types";

export function formatSessionDate(timestamp: number) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1_000));
}

export function truncate(text: string | null, maxLength = 96) {
  if (!text) return "No messages yet";
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

export function NewChatButton({
  onClick,
  label = "New chat",
  full = false,
}: {
  onClick: () => void;
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

interface ConversationListProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  loading: boolean;
  onSelect: (sessionId: string) => void;
}

export default function ConversationList({
  sessions,
  activeSessionId,
  loading,
  onSelect,
}: ConversationListProps) {
  if (loading && sessions.length === 0) {
    return (
      <p className="px-3 py-2 text-sm text-ink-muted">Loading conversations…</p>
    );
  }

  if (sessions.length === 0) {
    return (
      <p className="mx-2 rounded-xl border border-dashed border-rule px-3 py-3 text-sm text-ink-muted">
        Your saved chats will appear here after the first question.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId;
        return (
          <li key={session.id}>
            <button
              type="button"
              aria-current={isActive ? "true" : undefined}
              onClick={() => onSelect(session.id)}
              className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                isActive
                  ? "bg-primary/15 text-ink-primary"
                  : "text-ink-secondary hover:bg-ink-primary/[0.06] hover:text-ink-primary"
              }`}
            >
              <span className="line-clamp-1 text-sm font-medium">{session.title}</span>
              <span className="mt-0.5 line-clamp-1 text-xs text-ink-muted">
                {truncate(session.latestMessage)}
              </span>
              <span className="mt-1 block text-[11px] uppercase tracking-subhead text-ink-muted">
                {formatSessionDate(session.updatedAt)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
