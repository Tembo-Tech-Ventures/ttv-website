/**
 * ARCH-1 motion spike (throwaway, DEV harness only): opening a thread from a card.
 *
 * The card you choose becomes the head of the thread rail (a shared element, through a same-document
 * view transition), the rail slides in beside the list as a second sheet, and closing reverses it back
 * into the card. A reply appears at once and settles when the (simulated) server confirms it. With
 * reduced motion every step is a plain cut. History, focus and Escape behave as ChannelView's do.
 */
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Avatar } from "@/components/platform/ui";

export interface SpikeCard {
  id: string;
  author: string;
  authorId: string;
  title: string;
  body: string;
  replies: { id: string; author: string; authorId: string; body: string }[];
}

type Reply = SpikeCard["replies"][number] & { pending?: boolean };

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Run a DOM change inside a view transition, unless the reader asked for less motion. */
function transition(change: () => void, before?: () => void) {
  if (reduced() || typeof document.startViewTransition !== "function") {
    change();
    return;
  }
  before?.();
  document.startViewTransition(() => flushSync(change));
}

export default function CardThreadSpike({ cards }: { cards: SpikeCard[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, Reply[]>>(() => Object.fromEntries(cards.map((c) => [c.id, c.replies])));
  const [draft, setDraft] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const open = cards.find((card) => card.id === openId) ?? null;

  const name = (element: Element | null, value: string) => {
    if (element instanceof HTMLElement) element.style.viewTransitionName = value;
  };

  function openCard(id: string) {
    const card = document.querySelector(`[data-spike-card="${id}"]`);
    transition(
      () => {
        name(card, "");
        setOpenId(id);
      },
      () => name(card, "thread-origin"),
    );
    history.pushState({ spikeThread: id }, "", `?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), thread: id })}`);
  }

  function closeCard(fromHistory = false) {
    const id = openId;
    if (!id) return;
    const card = document.querySelector(`[data-spike-card="${id}"]`);
    transition(() => {
      setOpenId(null);
      name(card, "thread-origin");
      // Focus returns to the card that opened the thread, once it is back on screen (phones hide the list).
      (card?.querySelector("button") as HTMLButtonElement | null)?.focus({ preventScroll: true });
    });
    // The name only bridges the two states; clear it once the transition has its snapshots.
    requestAnimationFrame(() => requestAnimationFrame(() => name(card, "")));
    if (!fromHistory) {
      const params = new URLSearchParams(location.search);
      params.delete("thread");
      history.pushState({}, "", `?${params}`);
    }
  }

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const onPop = () => {
      const thread = new URLSearchParams(location.search).get("thread");
      if (!thread) closeCard(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && openId) closeCard();
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
  });

  function send() {
    if (!open || !draft.trim()) return;
    const id = `local-${Date.now()}`;
    const reply: Reply = { id, author: "Wanjiku Kamau", authorId: "wanjiku", body: draft.trim(), pending: true };
    setDraft("");
    // Optimistic: the reply is in the thread at once, marked as sending, and settles when the server says so.
    setReplies((all) => ({ ...all, [open.id]: [...(all[open.id] ?? []), reply] }));
    window.setTimeout(() => {
      setReplies((all) => ({ ...all, [open.id]: (all[open.id] ?? []).map((r) => (r.id === id ? { ...r, pending: false } : r)) }));
    }, 700);
  }

  return (
    <div className="spike-threads" data-open={open ? "" : undefined}>
      <ul className="spike-threads__list" aria-label="Recent posts">
        {cards.map((card) => (
          <li key={card.id} data-spike-card={card.id} className="spike-card">
            <button type="button" className="spike-card__button" aria-expanded={openId === card.id} onClick={() => openCard(card.id)}>
              <Avatar id={card.authorId} name={card.author} size="md" decorative />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink-primary">{card.author}</span>
                <span className="block text-base font-semibold text-ink-primary">{card.title}</span>
                <span className="mt-1 block text-sm text-ink-secondary">{card.body}</span>
                <span className="mt-2 block text-xs font-semibold text-teal">{(replies[card.id] ?? []).length} replies</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <aside className="spike-rail" aria-labelledby="spike-rail-heading" style={{ viewTransitionName: "thread-rail" }}>
          <div className="spike-rail__head">
            <h2 id="spike-rail-heading" ref={headingRef} tabIndex={-1} className="text-sm font-semibold text-ink-secondary">
              Thread
            </h2>
            <button type="button" className="spike-rail__close" onClick={() => closeCard()} aria-label="Close thread">
              ×
            </button>
          </div>
          <div className="spike-card spike-card--origin" style={{ viewTransitionName: "thread-origin" }}>
            <div className="spike-card__button">
              <Avatar id={open.authorId} name={open.author} size="md" decorative />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink-primary">{open.author}</span>
                <span className="block text-base font-semibold text-ink-primary">{open.title}</span>
                <span className="mt-1 block text-sm text-ink-secondary">{open.body}</span>
              </span>
            </div>
          </div>
          <ol className="spike-rail__replies" aria-live="polite">
            {(replies[open.id] ?? []).map((reply) => (
              <li key={reply.id} className="spike-reply" data-pending={reply.pending ? "" : undefined}>
                <Avatar id={reply.authorId} name={reply.author} size="sm" decorative />
                <span>
                  <span className="block text-xs font-semibold text-ink-primary">
                    {reply.author}
                    {reply.pending && <span className="ml-2 font-normal text-ink-muted">Sending…</span>}
                  </span>
                  <span className="block text-sm text-ink-secondary">{reply.body}</span>
                </span>
              </li>
            ))}
          </ol>
          <form
            className="spike-rail__composer"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <label className="sr-only" htmlFor="spike-reply">
              Reply
            </label>
            <input id="spike-reply" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Reply in thread" />
            <button type="submit">Send</button>
          </form>
        </aside>
      )}
    </div>
  );
}
