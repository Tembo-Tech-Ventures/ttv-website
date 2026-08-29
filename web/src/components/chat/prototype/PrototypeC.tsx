/**
 * Prototype C — "Thumb-first bottom sheet".
 *
 * Same single-scroll spine as A and B, but it moves the two controls a phone
 * user actually reaches for — switch conversation, start a new one — to the
 * bottom of the screen, next to the thumb, instead of the top-left corner.
 * Tapping the conversation title (a chip in a very slim header, or the switcher
 * beside the composer) opens a bottom sheet rather than a side drawer.
 *
 * The composer is a floating island so the transcript can run edge to edge
 * beneath it, which reads as more content on a short screen.
 */
import React, { useState } from "react";
import { PiArrowLeftBold, PiCaretUpDownBold, PiPlusBold } from "react-icons/pi";
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

export default function PrototypeC() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeId, setActiveId] = useState(MOCK_CONVERSATIONS[0].id);
  const [messages, setMessages] = useState<MockMessage[]>(MOCK_MESSAGES);

  const activeTitle =
    MOCK_CONVERSATIONS.find((conversation) => conversation.id === activeId)?.title ?? "New chat";

  function select(id: string) {
    setActiveId(id);
    setSheetOpen(false);
  }

  function newChat() {
    setMessages([]);
    setSheetOpen(false);
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
          <NewChatButton full onClick={newChat} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
          <ConversationList activeId={activeId} onSelect={select} />
        </div>
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
        {/* 44px header: a back affordance and the title, nothing else. */}
        <header className="flex h-11 shrink-0 items-center gap-1 px-2 lg:hidden">
          <a
            href="/dashboard"
            aria-label="Back to dashboard"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition hover:bg-ink-primary/[0.06] hover:text-ink-primary"
          >
            <PiArrowLeftBold className="h-4 w-4" aria-hidden="true" />
          </a>
          <h1 className="min-w-0 flex-1 truncate px-1 text-center font-body text-sm font-semibold text-ink-primary">
            {activeTitle}
          </h1>
          <button
            type="button"
            aria-label="New chat"
            onClick={newChat}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition hover:bg-ink-primary/[0.06] hover:text-ink-primary"
          >
            <PiPlusBold className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <Transcript messages={messages} columnClassName={COLUMN} onPickPrompt={send} />

        {/* Thumb zone: conversation switcher sits directly above the composer. */}
        <div className="shrink-0 px-3 pb-1 lg:hidden">
          <div className="mx-auto flex max-w-3xl justify-center">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen(true)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-rule bg-bg-raised/90 px-3 py-1.5 text-xs font-semibold text-ink-secondary backdrop-blur transition hover:text-ink-primary"
            >
              <PiCaretUpDownBold className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">Switch conversation</span>
            </button>
          </div>
        </div>

        <Composer floating columnClassName={COLUMN} onSend={send} />
      </div>

      <Drawer
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        side="bottom"
        label="Switch conversation"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
          <h2 className="font-body text-base font-semibold text-ink-primary">Conversations</h2>
          <NewChatButton onClick={newChat} label="New" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
          <ConversationList activeId={activeId} onSelect={select} />
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
      </Drawer>
    </div>
  );
}
