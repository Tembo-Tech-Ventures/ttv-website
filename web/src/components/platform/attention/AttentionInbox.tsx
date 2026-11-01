import { useEffect, useState, type MouseEvent, type Ref } from "react";
import type { AttentionFilter, AttentionItem, Me } from "@/lib/platform/contracts";
import { useAttention, type AttentionFailure } from "@/lib/platform/client/attention";
import { Button } from "@/components/platform/ui";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { signInHref } from "@/components/platform/overlays/sign-in";
import {
  attentionProblem,
  loadAndAnnounce,
  markReadAndAnnounce,
  whenWritesSettle,
  type AttentionOwner,
  type AttentionProblem,
} from "./attention-client";
import { awaitingConfirmation, awaitingConfirmationText } from "@/components/platform/spaces/awaiting-confirmation";
import { SPACE_PAGE_PATHS } from "@/components/platform/spaces/sidebar";
import { ATTENTION_FILTERS, attentionEmpty, attentionViewer, groupAttention, unreadTotal, visibleAttention } from "./attention-display";
import AttentionItemRow from "./AttentionItemRow";

/** How long opening an item waits for its mark-read before following the link anyway. */
const OPEN_WAIT_MS = 1_200;

/**
 * The clock items are aged against. It starts at the list's own snapshot so
 * the server and the first browser render agree, then follows the real time.
 */
export function useNow(initial: number | null): number {
  const [now, setNow] = useState(() => initial ?? Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** What went wrong, and what the person can do about it. */
function Problem({ problem, onRetry, what }: { problem: AttentionProblem; onRetry: () => void; what: string }) {
  if (problem === "failed") {
    return (
      <div className="attention-note" data-attention-problem={problem}>
        <p>{what}</p>
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div className="attention-note" data-attention-problem={problem}>
      <p>
        {problem === "signed-out"
          ? "You've been signed out, so attention can't update."
          : "Attention isn't available right now. If you were signed out, signing in again brings it back."}
      </p>
      <span className="flex shrink-0 flex-wrap items-center gap-2">
        <a href={signInHref()} className={cx("attention-note__link", FOCUS_RING)}>
          Sign in again
        </a>
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Check again
        </Button>
      </span>
    </div>
  );
}

/**
 * Shared work waiting for a mentor's confirmation. It is derived on the
 * Mentoring space, not an attention item, so it sits beside the list.
 */
function AwaitingNote({ awaiting }: { awaiting: number | null }) {
  if (awaiting === null || awaiting < 1) return null;
  return (
    <div className="attention-note" data-attention-awaiting={awaiting}>
      <p>{awaitingConfirmationText(awaiting)}</p>
      <a href={SPACE_PAGE_PATHS.confirm} className={cx("attention-note__link", FOCUS_RING)}>
        Open Confirm work
      </a>
    </div>
  );
}

type FiltersProps = {
  chosen: AttentionFilter;
  total: number;
  onChoose: (filter: AttentionFilter) => void;
  chosenRef?: Ref<HTMLButtonElement>;
};

function Filters({ chosen, total, onChoose, chosenRef }: FiltersProps) {
  return (
    <fieldset className="attention-filters">
      <legend className="sr-only">Show</legend>
      {ATTENTION_FILTERS.map(({ filter, label }) => (
        <button
          key={filter}
          ref={filter === chosen ? chosenRef : undefined}
          type="button"
          aria-pressed={filter === chosen}
          data-attention-filter={filter}
          onClick={() => onChoose(filter)}
          className={cx("attention-filter", FOCUS_RING)}
        >
          {label}
          {/* Only All has an authoritative number: the server counts by space, not by kind. */}
          {filter === "all" && total > 0 && (
            <span className="attention-filter__count">
              <span className="sr-only">, </span>
              {total}
              <span className="sr-only"> new</span>
            </span>
          )}
        </button>
      ))}
    </fieldset>
  );
}

function failureText(failure: AttentionFailure): string {
  if ("through" in failure.body) return "Couldn't mark everything read.";
  const count = failure.body.ids.length;
  return `Couldn't mark ${count === 1 ? "an item" : `${count} items`} read.`;
}

/** Mark-reads that did not land: each rolled back, each with its own retry. */
function Failures({ owner }: { owner: AttentionOwner }) {
  const { store, announcer } = owner;
  const failed = useAttention(store, (state) => state.failed);
  if (failed.length === 0) return null;

  async function retry(id: number) {
    if (await store.retry(id)) announcer.announce("Marked read", "polite", `retry:${id}`);
    else announcer.announce("Could not mark read. Try again is available.", "assertive", `retry-failed:${id}`);
  }

  return (
    <ul className="attention-failures" aria-label="Not marked read">
      {failed.map((failure) => (
        <li key={failure.id} className="attention-note" data-attention-failure={failure.id}>
          <p>{failureText(failure)}</p>
          <span className="flex shrink-0 gap-2">
            <Button size="sm" onClick={() => void retry(failure.id)}>
              Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={() => store.dismissFailure(failure.id)}>
              Dismiss
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Mark everything read, up to the moment the list was taken, so anything that
 * arrives meanwhile stays new. It reaches every kind, so it is offered only
 * where every kind is shown.
 */
export function MarkAll({ owner, me }: { owner: AttentionOwner; me: Me }) {
  const { filter, snapshotAt, loaded, total } = useAttention(
    owner.store,
    (state) => ({ filter: state.filter, snapshotAt: state.snapshotAt, loaded: state.loaded, total: unreadTotal(state.counts.unreadCounts, me.spaces) }),
    (a, b) => a.filter === b.filter && a.snapshotAt === b.snapshotAt && a.loaded === b.loaded && a.total === b.total,
  );
  if (filter !== "all") return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      data-attention-mark-all
      disabled={total === 0 || snapshotAt === null || !loaded}
      onClick={() => snapshotAt !== null && void markReadAndAnnounce(owner, { through: snapshotAt })}
    >
      Mark all read
    </Button>
  );
}

type GroupProps = {
  title: string;
  items: readonly AttentionItem[];
  now: number;
  viewer: { id: string; name: string; src?: string };
  onOpen: (item: AttentionItem, event: MouseEvent<HTMLAnchorElement>) => void;
};

function Group({ title, items, now, viewer, onOpen }: GroupProps) {
  if (items.length === 0) return null;
  return (
    <>
      <h3 className="attention-inbox__group">{title}</h3>
      <ul className="attention-inbox__items">
        {items.map((item) => (
          <AttentionItemRow key={item.id} item={item} now={now} viewer={viewer} onOpen={onOpen} />
        ))}
      </ul>
    </>
  );
}

type AttentionInboxProps = {
  owner: AttentionOwner;
  me: Me;
  /** Labels the list; the heading itself belongs to the panel or page. */
  headingId: string;
  now: number;
  /** The control focus starts on when the panel opens: the chosen filter. */
  initialFocusRef?: Ref<HTMLButtonElement>;
};

/**
 * Everything that needs the person, across the spaces they have: filters, New
 * and Earlier, mark read (one item on opening it, or all at once), older pages,
 * and an honest account of anything that went wrong. Shared by the desktop
 * panel and the phone's attention page.
 */
export default function AttentionInbox({ owner, me, headingId, now, initialFocusRef }: AttentionInboxProps) {
  const { store } = owner;
  const state = useAttention(store);
  const items = visibleAttention(state.items, me.spaces);
  const { fresh, earlier } = groupAttention(items);
  const total = unreadTotal(state.counts.unreadCounts, me.spaces);
  const listProblem = attentionProblem(state.listError);
  const countProblem = attentionProblem(state.countError);
  const viewer = { id: me.user.id, name: me.user.name, src: me.user.avatarUrl ?? undefined };
  const awaiting = awaitingConfirmation(me);
  const empty = attentionEmpty(state.filter, awaiting, attentionViewer(me));
  const settled = state.loaded && !state.listError;

  async function retryCounts() {
    await whenWritesSettle(store);
    await store.refreshCounts().catch(() => undefined);
  }

  async function open(item: AttentionItem, event: MouseEvent<HTMLAnchorElement>) {
    if (item.readAt !== null) return;
    const read = markReadAndAnnounce(owner, { ids: [item.id] });
    // A new tab or window keeps this page: mark it read and let the browser follow.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const href = event.currentTarget.href;
    await Promise.race([read, wait(OPEN_WAIT_MS)]);
    window.location.assign(href);
  }

  return (
    <div className="attention-inbox" data-filter={state.filter}>
      <Filters
        chosen={state.filter}
        total={total}
        chosenRef={initialFocusRef}
        onChoose={(filter) => void loadAndAnnounce(owner, () => store.setFilter(filter))}
      />

      {countProblem && countProblem !== "failed" && !listProblem && (
        <Problem problem={countProblem} onRetry={() => void retryCounts()} what="Counts stopped updating." />
      )}
      <Failures owner={owner} />

      {state.filter === "all" && <AwaitingNote awaiting={awaiting} />}

      <section aria-labelledby={headingId} aria-busy={state.loading || undefined} className="attention-inbox__list">
        {!state.loaded && !state.listError && (
          <p className="attention-inbox__status" data-attention-loading>
            Loading what needs you…
          </p>
        )}
        {listProblem && (
          <Problem
            problem={listProblem}
            onRetry={() => void loadAndAnnounce(owner, () => (state.loaded ? store.loadMore() : store.refresh()))}
            what={state.listError?.code === "stale_page" ? "Attention changed while it was loading." : "Couldn't load attention items."}
          />
        )}
        {settled && items.length === 0 && (
          <p className="attention-inbox__status" data-attention-empty>
            {empty}
          </p>
        )}
        <Group title="New" items={fresh} now={now} viewer={viewer} onOpen={(item, event) => void open(item, event)} />
        <Group title="Earlier" items={earlier} now={now} viewer={viewer} onOpen={(item, event) => void open(item, event)} />
        {state.truncated && <p className="attention-inbox__status">Showing your most recent items.</p>}
        {settled && state.nextCursor && !state.truncated && (
          <Button size="sm" className="attention-inbox__more" loading={state.loading} onClick={() => void loadAndAnnounce(owner, () => store.loadMore())}>
            Show older
          </Button>
        )}
      </section>
    </div>
  );
}
