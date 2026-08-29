/**
 * Prototype B — "Icon rail, no header".
 *
 * The most aggressive use of vertical space on a phone: there is no top bar at
 * all. The two controls that would live in one — open conversations, start a new
 * chat — float over the transcript as pills, and the transcript scrolls beneath
 * them behind a short gradient scrim.
 *
 * On desktop the product stays visible: a 4.5rem icon rail carries the dashboard
 * nav, so the chat reads as a room inside the app rather than a different site,
 * and the conversation panel next to it can be collapsed for a wider column.
 */
import React, { useState } from "react";
import {
  PiArrowLeftBold,
  PiGaugeDuotone,
  PiListBold,
  PiPlusBold,
  PiSidebarSimpleBold,
  PiSuitcaseSimpleDuotone,
  PiUserDuotone,
  PiVideoCameraDuotone,
} from "react-icons/pi";
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

const RAIL_ICONS = [
  { href: "/dashboard", label: "Dashboard", Icon: PiGaugeDuotone },
  { href: "/dashboard/sessions", label: "Sessions", Icon: PiVideoCameraDuotone },
  { href: "/dashboard/portfolio", label: "Portfolio", Icon: PiSuitcaseSimpleDuotone },
  { href: "/dashboard/profile", label: "Profile", Icon: PiUserDuotone },
];

export default function PrototypeB() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeId, setActiveId] = useState(MOCK_CONVERSATIONS[0].id);
  const [messages, setMessages] = useState<MockMessage[]>(MOCK_MESSAGES);

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
      {/* App identity rail — desktop only. */}
      <nav
        aria-label="Site"
        className="hidden w-18 shrink-0 flex-col items-center gap-1 border-r border-rule bg-dark/60 py-3 lg:flex"
      >
        <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-sm font-bold text-dark">
          T
        </span>
        {RAIL_ICONS.map(({ href, label, Icon }) => (
          <a
            key={href}
            href={href}
            title={label}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-muted transition hover:bg-ink-primary/[0.08] hover:text-ink-primary"
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </a>
        ))}
        <span className="mt-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <PiListBold className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Ask AI (current)</span>
        </span>
      </nav>

      {/* Conversation panel — collapsible on desktop. */}
      {panelOpen && (
        <aside className="hidden w-72 shrink-0 flex-col border-r border-rule bg-dark/30 lg:flex">
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-subhead text-ink-muted">
              Conversations
            </p>
            <button
              type="button"
              aria-label="Collapse conversations"
              onClick={() => setPanelOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition hover:bg-ink-primary/[0.06] hover:text-ink-primary"
            >
              <PiSidebarSimpleBold className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="shrink-0 px-3 pb-3">
            <NewChatButton full onClick={newChat} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
            <ConversationList activeId={activeId} onSelect={select} />
          </div>
        </aside>
      )}

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Floating chrome. On mobile these replace the header entirely. */}
        {/* Without a header bar the transcript runs under the pills, so the
            scrim has to actually obscure it — a light fade leaves ghost text. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-24 bg-gradient-to-b from-teal from-45% to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-3 py-3">
          <div className="pointer-events-auto flex items-center gap-2">
            {!panelOpen && (
              <button
                type="button"
                aria-label="Show conversations"
                onClick={() => setPanelOpen(true)}
                className="hidden h-10 w-10 items-center justify-center rounded-full border border-rule bg-bg-raised/90 text-ink-secondary shadow-lg backdrop-blur transition hover:text-ink-primary lg:flex"
              >
                <PiSidebarSimpleBold className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              aria-label="Open conversations"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-rule bg-bg-raised/90 text-ink-secondary shadow-lg backdrop-blur transition hover:text-ink-primary lg:hidden"
            >
              <PiListBold className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            aria-label="New chat"
            onClick={newChat}
            className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-rule bg-bg-raised/90 text-ink-secondary shadow-lg backdrop-blur transition hover:text-ink-primary lg:hidden"
          >
            <PiPlusBold className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <Transcript messages={messages} columnClassName={`${COLUMN} pt-14`} onPickPrompt={send} />

        <Composer columnClassName={COLUMN} onSend={send} />
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="Conversations and navigation">
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
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-subhead text-ink-muted">
            Recent
          </p>
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
      </Drawer>
    </div>
  );
}
