import { useEffect } from "react";
import { ROUTES, SearchQuery, SearchResults, type SearchScope } from "../contracts";
import { ApiError, createApiClient, type ApiClient } from "./apiClient";
import { createStore, useStore } from "./store";
import { searchSelectionReducer, type SearchKey } from "./searchKeyboard";
import { boundRecentQueries, readRecentQueries, writeRecentQueries, type SearchStorage } from "./searchRecent";

export const SEARCH_GROUPS = ["messages", "people", "projects", "sessionMoments"] as const;
export const SEARCH_GROUP_LIMIT = 50;
export type SearchItem = { [K in typeof SEARCH_GROUPS[number]]: { group: K; item: SearchResults[K][number] } }[typeof SEARCH_GROUPS[number]];
export type SearchStatus = "idle" | "debouncing" | "loading" | "ready" | "error";
export interface SearchState {
  enabled: boolean;
  open: boolean;
  q: string;
  scope: SearchScope;
  programId?: string;
  status: SearchStatus;
  results: SearchResults | null;
  items: SearchItem[];
  selected: number;
  recentQueries: string[];
  error: ApiError | null;
  announcement: string;
}
export interface SearchOptions {
  /** Effective spaces flag from /me. Default OFF; no work or storage access while disabled. */
  enabled?: boolean;
  client?: ApiClient;
  mock?: boolean;
  debounceMs?: number;
  scope?: SearchScope;
  programId?: string;
  /** Use a per-user key and recreate the store at an identity boundary. Omit to disable persistence. */
  recentStorageKey?: string;
  storage?: () => SearchStorage | undefined;
}

function sameQuery(a: SearchQuery, b: SearchQuery) {
  return a.q === b.q && a.scope === b.scope && a.programId === b.programId;
}

function boundedResults(data: SearchResults): SearchResults {
  function unique<T>(items: T[], key: (item: T) => string): T[] {
    const seen = new Set<string>();
    const bounded: T[] = [];
    for (const item of items) {
      const id = key(item);
      if (seen.has(id)) continue;
      seen.add(id);
      bounded.push(item);
      if (bounded.length === SEARCH_GROUP_LIMIT) break;
    }
    return bounded;
  }
  return { ...data,
    messages: unique(data.messages, x => x.id),
    people: unique(data.people, x => x.person.id),
    projects: unique(data.projects, x => JSON.stringify([x.journeyId, x.version])),
    sessionMoments: unique(data.sessionMoments, x => JSON.stringify([x.recordingId, x.startSeconds])),
  };
}

/** One instance per signed-in identity/overlay; never a module singleton. Network work starts only while connected, enabled and open. */
export function createSearchStore(options: SearchOptions = {}) {
  const debounceMs = options.debounceMs ?? 250;
  if (!Number.isFinite(debounceMs) || debounceMs < 0 || debounceMs > 2_147_483_647) throw new RangeError("Invalid search debounce");
  const store = createStore<SearchState>({ enabled: options.enabled ?? false, open: false, q: "", scope: options.scope ?? "all",
    programId: options.programId, status: "idle", results: null, items: [], selected: -1, recentQueries: [], error: null, announcement: "" });
  let connections = 0;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let browserDocument: Document | undefined;
  let storage: SearchStorage | undefined;
  let client = options.client;
  let hydrated = false;

  function cancel() {
    generation++;
    clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
  }
  function reset() {
    cancel();
    store.setState(s => ({ ...s, status: "idle", results: null, items: [], selected: -1, error: null, announcement: "" }));
  }
  function hydrate() {
    if (hydrated || !store.getState().enabled || !options.recentStorageKey) return;
    hydrated = true;
    try { storage = options.storage ? options.storage() : typeof window === "undefined" ? undefined : window.localStorage; } catch { storage = undefined; }
    store.setState(s => ({ ...s, recentQueries: readRecentQueries(storage, options.recentStorageKey!) }));
  }
  function remember(q: string) {
    const recentQueries = boundRecentQueries([q, ...store.getState().recentQueries]);
    store.setState(s => ({ ...s, recentQueries }));
    if (options.recentStorageKey) writeRecentQueries(storage, options.recentStorageKey, recentQueries);
  }
  function schedule() {
    reset();
    const state = store.getState();
    if (!connections || !state.enabled || !state.open || browserDocument?.hidden || !state.q.trim()) return;
    const parsed = SearchQuery.safeParse({ q: state.q.trim(), scope: state.scope, programId: state.programId });
    if (!parsed.success) {
      store.setState(s => ({ ...s, status: "error", error: new ApiError("validation_error", 0, "Invalid search query"), announcement: "Invalid search query" }));
      return;
    }
    const query = parsed.data;
    const version = generation;
    store.setState(s => ({ ...s, status: "debouncing" }));
    timer = setTimeout(() => { timer = undefined; void request(query, version); }, debounceMs);
  }
  async function request(query: SearchQuery, version: number) {
    const abort = new AbortController();
    controller = abort;
    store.setState(s => ({ ...s, status: "loading" }));
    try {
      client ??= options.mock ? (await import("./searchMock")).createSearchMockClient() : createApiClient();
      if (version !== generation) return;
      const raw = SearchResults.parse(await client.call(ROUTES.search, { query, signal: abort.signal }));
      if (version !== generation) return;
      if (!sameQuery(raw.query, query)) throw new ApiError("invalid_response", 200, "Search response query mismatch");
      const results = boundedResults(raw);
      const items: SearchItem[] = [
        ...results.messages.map(item => ({ group: "messages" as const, item })),
        ...results.people.map(item => ({ group: "people" as const, item })),
        ...results.projects.map(item => ({ group: "projects" as const, item })),
        ...results.sessionMoments.map(item => ({ group: "sessionMoments" as const, item })),
      ];
      store.setState(s => ({ ...s, results, items, status: "ready", selected: -1, announcement: items.length === 0 ? "No results" : `${items.length} search result${items.length === 1 ? "" : "s"}` }));
    } catch (cause) {
      if (version !== generation) return;
      const error = cause instanceof ApiError ? cause : new ApiError("invalid_response", 0, "Search failed", undefined, { cause });
      store.setState(s => ({ ...s, status: "error", error, announcement: "Search failed. Try again." }));
    } finally {
      if (controller === abort) controller = undefined;
    }
  }
  function visibility() {
    // Finished searches need neither polling nor cancellation on a visibility round-trip.
    if (store.getState().status === "ready") return;
    schedule();
  }
  const actions = {
    connect() {
      if (++connections === 1) {
        browserDocument = typeof document === "undefined" ? undefined : document;
        browserDocument?.addEventListener("visibilitychange", visibility);
        hydrate();
        schedule();
      }
      let connected = true;
      return () => {
        if (!connected) return;
        connected = false;
        if (--connections === 0) {
          browserDocument?.removeEventListener("visibilitychange", visibility);
          browserDocument = undefined;
          reset();
        }
      };
    },
    setEnabled(enabled: boolean) {
      if (store.getState().enabled === enabled) return;
      store.setState(s => ({ ...s, enabled, ...(!enabled ? { open: false, q: "", recentQueries: [] } : {}) }));
      if (!enabled) {
        hydrated = false;
        storage = undefined;
      } else if (connections) {
        hydrate();
      }
      schedule();
    },
    setOpen(open: boolean) {
      const nextOpen = store.getState().enabled && open;
      if (store.getState().open === nextOpen) return;
      store.setState(s => ({ ...s, open: nextOpen }));
      schedule();
    },
    setQuery(q: string, scope = store.getState().scope, programId?: string) {
      const previous = store.getState();
      const nextProgramId = programId ?? (scope === previous.scope ? previous.programId : undefined);
      // Keep overlong input bounded while retaining its validation error.
      store.setState(s => ({ ...s, q: q.slice(0, 501), scope, programId: nextProgramId }));
      schedule();
    },
    /** Explicitly replace the scope; omitting programId clears a previous cohort filter. */
    setScope(scope: SearchScope, programId?: string) {
      store.setState(s => ({ ...s, scope, programId }));
      schedule();
    },
    retry: schedule,
    key(key: SearchKey) {
      const s = store.getState();
      if (!s.enabled || !s.open) return;
      if (key === "Escape") { actions.setOpen(false); return; }
      store.setState({ ...s, selected: searchSelectionReducer(s.selected, key, s.items.length) });
    },
    /** Selection only: caller performs authorized navigation, preserving server visibility labels. */
    select(): SearchItem | null {
      const s = store.getState();
      if (!s.enabled || !s.open || s.status !== "ready") return null;
      const item = s.items[s.selected] ?? null;
      if (item && s.results) remember(s.results.query.q);
      return item;
    },
    /** Local draft only. Integration must check cohort Ask Tembo access, populate its composer, never auto-send. */
    draftForAskTembo(): Pick<SearchQuery, "q"> | null {
      const s = store.getState();
      if (!s.enabled || !s.open) return null;
      const parsed = SearchQuery.shape.q.safeParse(s.q.trim());
      if (!parsed.success) return null;
      return { q: parsed.data };
    },
    clearRecent() {
      store.setState(s => ({ ...s, recentQueries: [] }));
      if (store.getState().enabled && options.recentStorageKey) writeRecentQueries(storage, options.recentStorageKey, []);
    },
  };
  return { ...store, ...actions };
}
export type SearchStore = ReturnType<typeof createSearchStore>;

/** Memoize/create the store once per identity; use createSearchStore({mock:true,enabled:true}) for fixtures. */
export function useSearch(store: SearchStore): SearchState {
  useEffect(() => store.connect(), [store]);
  return useStore(store, state => state);
}
