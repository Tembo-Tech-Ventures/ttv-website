/**
 * Prototype A — "Takeover bar".
 *
 * The conservative option, and the one closest to what people already know from
 * ChatGPT/Claude. The chat route sheds the dashboard shell entirely and owns the
 * viewport. A persistent 18rem conversation rail on desktop collapses to an
 * off-canvas drawer on mobile, opened from a hamburger in a slim top bar. The
 * route back into the product lives in two places: a labelled link at the top of
 * the rail/drawer, and the app-nav group pinned to its bottom.
 */
import React, { useState } from "react";
import { PiArrowLeftBold, PiListBold, PiPlusBold } from "react-icons/pi";
import {
  Composer,
  ConversationList,
  Drawer,
  NewChatButton,
  Transcript,
} from "@/components/chat/prototype/ChatPrimitives";
import {
  APP_NAV,
  MOCK_CONVERSATIONS,
  MOCK_MESSAGES,
  type MockMessage,
} from "@/components/chat/prototype/mock-data";

const COLUMN = "w-full max-w-3xl";

function RailContents({
  activeId,
  onSelect,
  onNewChat,
}: {
  activeId: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}) {
  return (
    <>
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
        <NewChatButton full onClick={onNewChat} />
      </div>

      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-subhead text-ink-muted">
          Recent
        </p>
        <ConversationList activeId={activeId} onSelect={onSelect} />
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
    </>
  );
}

export default function PrototypeA() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeId, setActiveId] = useState(MOCK_CONVERSATIONS[0].id);
  const [messages, setMessages] = useState<MockMessage[]>(MOCK_MESSAGES);

  const activeTitle =
    MOCK_CONVERSATIONS.find((conversation) => conversation.id === activeId)?.title ?? "New chat";

  function select(id: string) {
    setActiveId(id);
    setDrawerOpen(false);
  }

  function newChat() {
    setMessages([]);
    setDrawerOpen(false);
  }

  function send(value: string) {
    setMessages((current) => [
      ...current,
      { id: `sent-${current.length}`, role: "user", content: value },
    ]);
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-rule bg-dark/40 lg:flex">
        <RailContents activeId={activeId} onSelect={select} onNewChat={newChat} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-rule px-2 sm:px-4 lg:px-6">
          <button
            type="button"
            aria-label="Open conversations"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-secondary transition hover:bg-ink-primary/[0.06] hover:text-ink-primary lg:hidden"
          >
            <PiListBold className="h-5 w-5" aria-hidden="true" />
          </button>

          {/* font-body: h1 defaults to the Mattone display face, which is far
              too loud for a piece of app chrome that changes on every click. */}
          <h1 className="min-w-0 flex-1 truncate text-center font-body text-sm font-semibold text-ink-primary lg:text-left lg:text-base">
            {activeTitle}
          </h1>

          <button
            type="button"
            aria-label="New chat"
            onClick={newChat}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-secondary transition hover:bg-ink-primary/[0.06] hover:text-ink-primary lg:hidden"
          >
            <PiPlusBold className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <Transcript messages={messages} columnClassName={COLUMN} onPickPrompt={send} />

        <Composer columnClassName={COLUMN} onSend={send} />
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="Conversations">
        <RailContents activeId={activeId} onSelect={select} onNewChat={newChat} />
      </Drawer>
    </div>
  );
}
