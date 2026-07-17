import {
  PiChatCircleDotsDuotone,
  PiPlusBold,
  PiTrashBold,
  PiXBold,
} from "react-icons/pi";
import type { ChatConversationView } from "@/lib/chat/types";

interface ChatHistoryProps {
  activeConversationId: string | null;
  conversations: ChatConversationView[];
  disabled: boolean;
  onClose: () => void;
  onDelete: (conversationId: string) => void;
  onNew: () => void;
  onOpen: (conversationId: string) => void;
}

export function ChatHistory({
  activeConversationId,
  conversations,
  disabled,
  onClose,
  onDelete,
  onNew,
  onOpen,
}: ChatHistoryProps) {
  return (
    <aside className="flex h-full w-[19rem] flex-col border-r border-white/10 bg-[#002f2c]/95">
      <div className="flex items-center justify-between border-b border-white/10 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/70">
            Learning coach
          </p>
          <h3 className="mt-1 text-sm font-bold text-white">Conversations</h3>
        </div>
        <button
          type="button"
          className="rounded-lg p-2 text-white/55 transition hover:bg-white/10 hover:text-white lg:hidden"
          aria-label="Close conversation history"
          onClick={onClose}
        >
          <PiXBold aria-hidden="true" />
        </button>
      </div>

      <div className="p-3">
        <button
          type="button"
          onClick={onNew}
          disabled={disabled}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/35 bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <PiPlusBold aria-hidden="true" />
          New conversation
        </button>
      </div>

      <nav
        className="flex-1 space-y-1 overflow-y-auto px-2 pb-4"
        aria-label="Chat history"
      >
        {conversations.length === 0 ? (
          <p className="px-3 py-5 text-sm leading-relaxed text-white/40">
            Your conversations will stay here so you can pick up where you left off.
          </p>
        ) : (
          conversations.map((conversation) => {
            const active = conversation.id === activeConversationId;
            return (
              <div
                key={conversation.id}
                className={`group flex w-full items-center rounded-xl transition ${
                  active
                    ? "bg-white/10 text-white"
                    : "text-white/55 hover:bg-white/[0.06] hover:text-white/85"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onOpen(conversation.id);
                  }}
                  disabled={disabled}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left disabled:cursor-not-allowed"
                  aria-current={active ? "page" : undefined}
                >
                  <PiChatCircleDotsDuotone
                    className="shrink-0 text-primary/70"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {conversation.title}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${conversation.title}`}
                  onClick={() => {
                    onDelete(conversation.id);
                  }}
                  disabled={disabled}
                  className="mr-2 rounded p-1.5 opacity-0 transition hover:bg-white/10 hover:text-red-200 focus:opacity-100 disabled:cursor-not-allowed group-hover:opacity-100"
                >
                  <PiTrashBold aria-hidden="true" />
                </button>
              </div>
            );
          })
        )}
      </nav>
    </aside>
  );
}
