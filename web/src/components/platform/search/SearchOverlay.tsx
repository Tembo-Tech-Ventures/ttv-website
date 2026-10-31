import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { PiChatCircleText, PiFolderSimple, PiMagnifyingGlass, PiSparkle, PiVideoCamera, PiX } from "react-icons/pi";
import type { Me } from "@/lib/platform/contracts";
import type { ApiClient } from "@/lib/platform/client/apiClient";
import { createAnnouncer } from "@/lib/platform/client/announcer";
import { createSearchStore, useSearch, type SearchItem } from "@/lib/platform/client/search";
import { Avatar, Button, SpaceGlyph } from "@/components/platform/ui";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { onShellOverlay } from "@/components/platform/shell/overlays";
import LiveRegions from "@/components/platform/overlays/LiveRegions";
import { signInHref } from "@/components/platform/overlays/sign-in";
import { useModalDialog } from "@/components/platform/overlays/useModalDialog";
import { askTemboHref } from "./ask-handoff";
import { clearRecentSearches, onShellSignOut, recentSearchKey } from "./recent-searches";
import { GROUP_LABEL, highlight, scopesFor, searchProblem, timestamp } from "./search-display";
import "./search.css";

function Marked({ text, query }: { text: string; query: string }) {
  let at = 0;
  return (
    <>
      {highlight(text, query).map((part) => {
        // Each part's position in the text is its stable key.
        const start = at;
        at += part.text.length;
        return part.match ? (
          <mark key={start} className="search-mark">
            {part.text}
          </mark>
        ) : (
          <span key={start}>{part.text}</span>
        );
      })}
    </>
  );
}

function Tile({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="search-option__tile">
      {children}
    </span>
  );
}

/** One result: what it is, the words that matched, and who can see it (the server's label, as given). */
function Option({ entry, query }: { entry: SearchItem; query: string }) {
  switch (entry.group) {
    case "people": {
      const { person, bio, visibility } = entry.item;
      const mentor = person.roleBadges.some((badge) => badge.kind === "MENTOR");
      return (
        <>
          <Avatar id={person.id} name={person.name} src={person.avatarUrl ?? undefined} size="lg" mentor={mentor} decorative />
          <span className="search-option__body">
            <span className="search-option__title">
              <Marked text={person.name} query={query} />
            </span>
            {bio && (
              <span className="search-option__text">
                <Marked text={bio} query={query} />
              </span>
            )}
            <span className="search-option__meta">{visibility.label}</span>
          </span>
        </>
      );
    }
    case "projects": {
      const { title, summary, owner, visibility } = entry.item;
      return (
        <>
          <Tile>
            <PiFolderSimple className="size-[1.375rem]" />
          </Tile>
          <span className="search-option__body">
            <span className="search-option__title">
              <Marked text={title} query={query} />
            </span>
            <span className="search-option__text">
              {owner.name}
              {summary && (
                <>
                  {" · "}
                  <Marked text={summary} query={query} />
                </>
              )}
            </span>
            <span className="search-option__meta">{visibility.label}</span>
          </span>
        </>
      );
    }
    case "sessionMoments": {
      const { title, startSeconds, quote, visibility } = entry.item;
      return (
        <>
          <Tile>
            <PiVideoCamera className="size-[1.375rem]" />
          </Tile>
          <span className="search-option__body">
            <span className="search-option__title">
              <Marked text={title} query={query} /> · {timestamp(startSeconds)}
            </span>
            <span className="search-option__text">
              “<Marked text={quote} query={query} />”
            </span>
            <span className="search-option__meta">{visibility.label}</span>
          </span>
        </>
      );
    }
    case "messages": {
      const { author, excerpt, visibility } = entry.item;
      return (
        <>
          <Tile>
            <PiChatCircleText className="size-[1.375rem]" />
          </Tile>
          <span className="search-option__body">
            <span className="search-option__title">{author.name}</span>
            <span className="search-option__text">
              “<Marked text={excerpt} query={query} />”
            </span>
            <span className="search-option__meta">{visibility.label}</span>
          </span>
        </>
      );
    }
  }
}

type Store = ReturnType<typeof createSearchStore>;
type State = ReturnType<Store["getState"]>;

/** Searches this person opened results from, to run again. */
function RecentSearches({ store, recent, onPick }: { store: Store; recent: readonly string[]; onPick: (query: string) => void }) {
  return (
    <div className="search-recent" data-search-recent>
      <div className="search-recent__head">
        <h3 className="search-group__label">Recent searches</h3>
        <Button size="sm" variant="ghost" onClick={() => store.clearRecent()}>
          Clear
        </Button>
      </div>
      <ul className="search-recent__list">
        {recent.map((query) => (
          <li key={query}>
            <button type="button" onClick={() => onPick(query)} className={cx("search-recent__item", FOCUS_RING)}>
              <PiMagnifyingGlass aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
              <span className="truncate">{query}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProblemNote({ store, state }: { store: Store; state: State }) {
  const problem = searchProblem(state.error);
  if (!problem) return null;
  return (
    <div className="search-overlay__problem" data-search-problem>
      <p>{problem.message}</p>
      <span className="flex shrink-0 gap-2">
        {problem.signIn && (
          <a href={signInHref()} className={cx("search-overlay__sign-in", FOCUS_RING)}>
            Sign in again
          </a>
        )}
        {problem.retry && (
          <Button size="sm" onClick={() => store.retry()}>
            Try again
          </Button>
        )}
      </span>
    </div>
  );
}

type ResultsProps = {
  state: State;
  listboxId: string;
  optionId: (index: number) => string;
  onOpen: (index: number) => void;
};

/**
 * The answers, grouped as the keyboard walks them. The input keeps focus; the
 * chosen option is its active descendant, so arrows and Enter work from the
 * box and a pointer can simply click.
 */
function Results({ state, listboxId, optionId, onOpen }: ResultsProps) {
  const shown = state.status === "ready" && state.items.length > 0;
  const query = state.results?.query.q ?? state.q.trim();
  const groups = (["people", "projects", "sessionMoments"] as const)
    .map((group) => ({
      group,
      entries: state.items.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.group === group),
    }))
    .filter(({ entries }) => entries.length > 0);

  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a combobox's popup: a native select cannot hold rich, grouped results
    <div id={listboxId} role="listbox" aria-label="Results" hidden={!shown} className="search-results">
      {shown &&
        groups.map(({ group, entries }) => (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an ARIA group of options inside the listbox; fieldset is not allowed there
          <div key={group} role="group" aria-label={GROUP_LABEL[group]} className="search-group">
            <div aria-hidden="true" className="search-group__label">
              {GROUP_LABEL[group]}
            </div>
            {entries.map(({ entry, index }) => (
              // The input owns focus and the keyboard (aria-activedescendant); options take pointer clicks only.
              // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- combobox option
              <div
                key={optionId(index)}
                id={optionId(index)}
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a native option cannot hold this content
                role="option"
                aria-selected={state.selected === index}
                data-search-option={entry.group}
                onClick={() => onOpen(index)}
                className="search-option"
              >
                <Option entry={entry} query={query} />
                {state.selected === index && (
                  <span aria-hidden="true" className="search-option__enter">
                    Enter
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

/** Everything under the scopes: recent searches, progress, problems, nothing found, or the answers. */
function Body({ store, state, listboxId, optionId, onOpen, onPick }: ResultsProps & { store: Store; onPick: (query: string) => void }) {
  const query = state.q.trim();
  const busy = state.status === "debouncing" || state.status === "loading";
  return (
    <div className="search-overlay__results" aria-busy={busy || undefined} data-search-status={state.status}>
      {!query && state.recentQueries.length > 0 && <RecentSearches store={store} recent={state.recentQueries} onPick={onPick} />}
      {!query && state.recentQueries.length === 0 && (
        <p className="search-overlay__status">Find people, projects, and moments from your own cohort's sessions.</p>
      )}
      {query && busy && (
        <p className="search-overlay__status" data-search-loading>
          Searching for “{query}”…
        </p>
      )}
      <ProblemNote store={store} state={state} />
      {state.status === "ready" && state.items.length === 0 && (
        <p className="search-overlay__status" data-search-empty>
          Nothing matches “{state.results?.query.q ?? query}”{state.scope === "all" ? "." : " here."}
        </p>
      )}
      <Results state={state} listboxId={listboxId} optionId={optionId} onOpen={onOpen} />
    </div>
  );
}

type SearchOverlayProps = {
  me: Me;
  /** DEV harness only: a fixture client. Pages leave it out and search the real API. */
  client?: ApiClient;
};

/**
 * Search everything (Ctrl K / ⌘ K, or the top bar's search): people,
 * projects and moments from your own sessions, grouped, with the arrow keys
 * to move and Enter to open. Typing waits a beat before searching, and an
 * older answer never replaces a newer question. What you type is kept only in
 * memory; a search is remembered (on this browser, for you) only once you open
 * one of its results. "Ask Tembo" hands the words to the cohort assistant's
 * composer, unsent.
 */
export default function SearchOverlay({ me, client }: SearchOverlayProps) {
  const recentKey = recentSearchKey(me.user.id);
  const [store] = useState(() =>
    createSearchStore({
      enabled: me.flags.spaces === true,
      client,
      recentStorageKey: recentKey,
    }),
  );
  const [announcer] = useState(() => createAnnouncer({ throttleMs: 600, dedupeMs: 3_000 }));
  const state = useSearch(store);
  const dialog = useModalDialog(() => store.setOpen(false));
  const { show } = dialog;
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const listboxId = useId();
  const canAsk = me.spaces.includes("cohort") && me.capabilities.cohortIds.length > 0;
  const query = state.q.trim();
  const shown = state.status === "ready" && state.items.length > 0;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  useEffect(() => () => announcer.dispose(), [announcer]);

  /* Recent searches are this person's alone: drop anyone else's, and all of them on sign-out. */
  useEffect(() => {
    clearRecentSearches(recentKey);
    return onShellSignOut(() => {
      store.clearRecent();
      clearRecentSearches();
    });
  }, [store, recentKey]);

  useEffect(
    () =>
      onShellOverlay("search", ({ trigger }) => {
        store.setOpen(true);
        show(trigger);
        // After this frame, so a panel closing for search cannot take focus back to its bell.
        requestAnimationFrame(() => {
          input.current?.focus();
          input.current?.select();
        });
      }),
    [store, show],
  );

  /* Say what came back, once per answer (the same words again if the same thing happens again). */
  useEffect(() => {
    let previous = store.getState().status;
    let answer = 0;
    return store.subscribe(() => {
      const next = store.getState();
      if (next.status !== previous && next.open && (next.status === "ready" || next.status === "error")) {
        const count = next.items.length;
        const message =
          next.status === "error"
            ? (searchProblem(next.error)?.message ?? "Search didn't work.")
            : count === 0
              ? "No results"
              : `${count} result${count === 1 ? "" : "s"}`;
        announcer.announce(message, next.status === "error" ? "assertive" : "polite", `answer:${++answer}`);
      }
      previous = next.status;
    });
  }, [store, announcer]);

  /* Keep the chosen result in view as the arrows move through a long list. */
  useEffect(() => {
    if (state.selected >= 0) document.getElementById(`${listboxId}-option-${state.selected}`)?.scrollIntoView({ block: "nearest" });
  }, [state.selected, listboxId]);

  function open(index: number) {
    // Choosing with the pointer is choosing that option: select it, then open it.
    store.setState((current) => ({ ...current, selected: index }));
    const chosen = store.select();
    if (chosen) window.location.assign(chosen.item.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      // A search field would spend Escape on clearing itself; here it closes, as everywhere else in the overlay.
      event.preventDefault();
      dialog.hide();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      store.key(event.key);
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (state.status === "ready" && state.items.length > 0) open(Math.max(0, state.selected));
    }
  }

  function askTembo() {
    const draft = store.draftForAskTembo();
    if (draft) window.location.assign(askTemboHref(draft.q));
  }

  return (
    <>
      <dialog {...dialog.props} aria-labelledby={titleId} className="search-overlay" data-search-overlay>
        <div className="search-overlay__sheet">
          <h2 id={titleId} className="sr-only">
            Search everything
          </h2>
          <div className="search-overlay__top">
            <div className="search-overlay__field">
              <PiMagnifyingGlass aria-hidden="true" className="size-6 shrink-0 text-ink-secondary" />
              <input
                ref={input}
                type="search"
                role="combobox"
                aria-label="Search people, projects and your sessions"
                aria-expanded={shown}
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={shown && state.selected >= 0 ? optionId(state.selected) : undefined}
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="search"
                placeholder="Search people, projects and sessions"
                value={state.q}
                onChange={(event) => store.setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                className="search-overlay__input"
              />
              <button type="button" onClick={dialog.hide} className={cx("search-overlay__close", FOCUS_RING)} aria-label="Close search">
                {/* The key's name where there is a keyboard; a close mark on touch screens. */}
                <span aria-hidden="true" className="search-overlay__esc">
                  Esc
                </span>
                <PiX aria-hidden="true" className="search-overlay__x size-5" />
              </button>
            </div>

            <fieldset className="search-scopes">
              <legend className="sr-only">Search in</legend>
              {scopesFor(me).map(({ scope, label, glyph }) => (
                <button
                  key={scope}
                  type="button"
                  aria-pressed={state.scope === scope}
                  data-search-scope={scope}
                  onClick={() => store.setScope(scope)}
                  className={cx("search-scope", FOCUS_RING)}
                >
                  {glyph && (
                    <span aria-hidden="true" className="inline-flex">
                      <SpaceGlyph space={glyph} person={{ id: me.user.id, name: me.user.name }} />
                    </span>
                  )}
                  {label}
                </button>
              ))}
            </fieldset>
          </div>

          <Body
            store={store}
            state={state}
            listboxId={listboxId}
            optionId={optionId}
            onOpen={open}
            onPick={(recent) => {
              store.setQuery(recent);
              input.current?.focus();
            }}
          />

          <footer className="search-overlay__footer">
            <p className="search-overlay__hint">↑ ↓ to move · Enter to open</p>
            {canAsk && query && (
              <button
                type="button"
                onClick={askTembo}
                data-ask-tembo
                aria-label={`Ask Tembo about “${query}”. Opens Ask Tembo with this question ready to send.`}
                className={cx("search-overlay__ask", FOCUS_RING)}
              >
                <PiSparkle aria-hidden="true" className="size-4 shrink-0" />
                <span className="truncate">Ask Tembo about “{query}”</span>
              </button>
            )}
          </footer>
        </div>
      </dialog>
      <LiveRegions announcer={announcer} name="search" />
    </>
  );
}
