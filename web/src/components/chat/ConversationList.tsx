import React from "react";
import { PiPlusBold } from "react-icons/pi";
import { Button, EmptyState, FOCUS_RING, cx } from "@/components/platform/ui";
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

/** Title for the header: the active conversation, or the unsaved-chat label. */
export const NEW_CHAT_TITLE = "New chat";

export function conversationTitle(sessions: ChatSession[], activeSessionId: string | null) {
  if (!activeSessionId) return NEW_CHAT_TITLE;
  return sessions.find((session) => session.id === activeSessionId)?.title ?? NEW_CHAT_TITLE;
}

export function truncate(text: string | null, maxLength = 96) {
  if (!text) return "No messages yet";
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Quiet, not peach: Send is the page's one primary action. */
export function NewChatButton({
  onClick,
  label = "New chat",
  full = false,
  size = "md",
}: {
  onClick: () => void;
  label?: string;
  full?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <Button variant="quiet" size={size} onClick={onClick} icon={<PiPlusBold className="size-4" />} className={full ? "w-full" : undefined}>
      {label}
    </Button>
  );
}

interface ConversationListProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  loading: boolean;
  /** Switching is refused while an answer is in flight; show that. */
  disabled?: boolean;
  onSelect: (sessionId: string) => void;
}

export default function ConversationList({
  sessions,
  activeSessionId,
  loading,
  disabled = false,
  onSelect,
}: ConversationListProps) {
  if (loading && sessions.length === 0) {
    return (
      <p className="px-3 py-2 text-sm text-ink-muted">Loading conversations…</p>
    );
  }

  if (sessions.length === 0) {
    return (
      <EmptyState title="No conversations yet" className="mx-1">
        Your chats are saved here after your first question.
      </EmptyState>
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
              disabled={disabled && !isActive}
              onClick={() => onSelect(session.id)}
              // As the space sidebar's links: the current one lifted, never peach; switching
              // is refused mid-answer, so the others go quiet rather than fade.
              className={cx(
                "w-full rounded-xl px-3 py-2.5 text-left transition-colors duration-150 motion-reduce:transition-none pointer-coarse:min-h-11",
                FOCUS_RING,
                isActive
                  ? "bg-ink-primary/8 text-ink-primary"
                  : "text-ink-secondary enabled:hover:bg-ink-primary/5 enabled:hover:text-ink-primary disabled:cursor-not-allowed disabled:text-ink-muted",
              )}
            >
              <span className="line-clamp-1 text-sm font-medium">{session.title}</span>
              <span className="mt-0.5 line-clamp-1 text-xs text-ink-muted">
                {truncate(session.latestMessage)}
              </span>
              <span className="mt-1 block text-xs text-ink-muted">
                {formatSessionDate(session.updatedAt)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
