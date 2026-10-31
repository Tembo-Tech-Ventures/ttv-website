import {
  AttentionCount, AttentionFilter, AttentionList, MarkAttentionRead, ROUTES, SPACE_ORDER,
  type AttentionItem, type SpaceId,
} from "../contracts";
import { ApiError, createApiClient, type ApiClient } from "./apiClient";
import { createPoller } from "./poller";
import { createStore } from "./store";

const zeroCounts = (): AttentionCount => ({ count: 0, unreadCounts: {
  cohort: 0, community: 0, mentoring: 0, discover: 0, admin: 0, profile: 0,
} });
const matches = (item: AttentionItem, body: MarkAttentionRead) => "ids" in body
  ? body.ids.includes(item.id) : item.createdAt <= body.through;
const byNewest = (a: AttentionItem, b: AttentionItem) => b.createdAt - a.createdAt || a.id.localeCompare(b.id);
const normalizeError = (error: unknown) => error instanceof ApiError ? error
  : new ApiError("client_error", 0, "Attention request failed", undefined, { cause: error });

function initialPaging(initial: AttentionList | undefined, size: number, capacity: number, overflow: boolean) {
  return {
    nextCursor: size >= capacity ? null : initial?.nextCursor ?? null,
    snapshotAt: initial?.snapshotAt ?? null,
    truncated: overflow || (!!initial?.nextCursor && size >= capacity),
  };
}

export interface AttentionMutation {
  id: number;
  body: MarkAttentionRead;
  readAt: number;
}
export interface AttentionFailure extends AttentionMutation { error: ApiError }
export interface AttentionState {
  items: readonly AttentionItem[];
  counts: AttentionCount;
  filter: AttentionFilter;
  nextCursor: string | null;
  snapshotAt: number | null;
  truncated: boolean;
  loaded: boolean;
  loading: boolean;
  counting: boolean;
  listError: ApiError | null;
  countError: ApiError | null;
  pending: readonly AttentionMutation[];
  failed: readonly AttentionFailure[];
  announcement: string;
}
export interface AttentionOptions {
  /** Supply Me.flags.spaces explicitly. Defaults to false; no requests when disabled. */
  enabled?: boolean;
  api?: ApiClient;
  /** Explicit fixture client imported separately by a development harness. */
  mock?: ApiClient;
  initialList?: AttentionList;
  initialCounts?: AttentionCount;
  filter?: AttentionFilter;
  maxItems?: number;
}

/** Per-user/request instance. Construct without side effects; start/retain owns polling. */
export function createAttentionStore(options: AttentionOptions = {}) {
  const { enabled = false, maxItems = 500 } = options;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 10_000) throw new RangeError("Invalid maxItems");
  const api = options.api ?? options.mock ?? createApiClient();
  const initial = options.initialList ? AttentionList.parse(options.initialList) : undefined;
  let entities = new Map<string, AttentionItem>();
  function merge(items: readonly AttentionItem[], replace = false) {
    const next = replace ? new Map<string, AttentionItem>() : new Map(entities);
    for (const item of items) {
      // Read state is monotonic; an old page must never resurrect an acknowledged item.
      const previous = entities.get(item.id);
      next.set(item.id, previous?.readAt !== null && previous?.readAt !== undefined && item.readAt === null
        ? { ...item, readAt: previous.readAt } : item);
    }
    entities = new Map([...next.values()].toSorted(byNewest).slice(0, maxItems).map(item => [item.id, item]));
    return next.size > maxItems;
  }
  const initialOverflow = merge(initial?.items ?? []);
  let counts = options.initialCounts ? AttentionCount.parse(options.initialCounts) : zeroCounts();
  const store = createStore<AttentionState>({
    items: [...entities.values()], counts, filter: AttentionFilter.parse(options.filter ?? "all"),
    ...initialPaging(initial, entities.size, maxItems, initialOverflow),
    loaded: !!initial, loading: false, counting: false, listError: null, countError: null,
    pending: [], failed: [], announcement: "",
  });
  let stopped = false;
  let started = false;
  let terminal = false;
  let delayInitial = !!options.initialCounts;
  let countKnown = !!options.initialCounts;
  let stopWarmup: (() => void) | undefined;
  let epoch = 0;
  let revision = 0;
  let sequence = 0;
  let retains = 0;
  let listController: AbortController | undefined;
  let countController: AbortController | undefined;
  let countFlight: Promise<boolean> | undefined;
  let listFlight: Promise<void> | undefined;
  let mutationController: AbortController | undefined;
  let queue: Promise<void> = Promise.resolve();
  const available = () => enabled && !stopped;
  const valid = (generation: number, signal: AbortSignal) => available() && epoch === generation && !signal.aborted;
  const optimisticItems = new Map<string, AttentionItem>();
  function project(update: Partial<AttentionState> = {}) {
    store.setState(state => {
      const next = { ...state, ...update };
      const projected = { count: counts.count, unreadCounts: { ...counts.unreadCounts } };
      // Keep the known optimistic count delta when paging/filtering evicts items.
      for (const [id, item] of optimisticItems) {
        if (item.readAt !== null || !next.pending.some(entry => matches(item, entry.body))) optimisticItems.delete(id);
      }
      for (const item of entities.values()) {
        if (item.readAt === null && optimisticItems.size < maxItems && next.pending.some(entry => matches(item, entry.body))) {
          optimisticItems.set(item.id, item);
        }
      }
      for (const item of optimisticItems.values()) {
        projected.count = Math.max(0, projected.count - 1);
        projected.unreadCounts[item.space] = Math.max(0, projected.unreadCounts[item.space] - 1);
      }
      const items = [...entities.values()].map(item => {
        const mutation = next.pending.find(entry => matches(item, entry.body));
        if (!mutation || item.readAt !== null) return item;
        return { ...item, readAt: mutation.readAt };
      });
      const stableItems = items.length === state.items.length && items.every((item, i) => {
        const previous = state.items[i];
        return item === previous || (Object.keys(item) as (keyof AttentionItem)[]).every(key => item[key] === previous[key]);
      }) ? state.items : items;
      const stableCounts = projected.count === state.counts.count
        && SPACE_ORDER.every(space => projected.unreadCounts[space] === state.counts.unreadCounts[space]) ? state.counts : projected;
      return { ...next, counts: stableCounts, items: stableItems };
    });
  }
  async function refreshCounts(signal?: AbortSignal): Promise<boolean> {
    if (!available() || store.getState().pending.length > 0) return false;
    if (countFlight) {
      const current = countController;
      const abortShared = () => current?.abort();
      signal?.addEventListener("abort", abortShared, { once: true });
      if (signal?.aborted) abortShared();
      try { return await countFlight; }
      finally { signal?.removeEventListener("abort", abortShared); }
    }
    const resuming = terminal; terminal = false;
    const controller = new AbortController();
    countController = controller;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const generation = epoch; const version = revision;
    project({ counting: true, countError: null });
    const flight = (async () => {
      try {
        const result = await api.call(ROUTES.countAttention, { signal: controller.signal });
        if (!valid(generation, controller.signal) || revision !== version) return false;
        const changed = JSON.stringify(counts) !== JSON.stringify(result);
        const increase = countKnown ? result.count - counts.count : 0;
        countKnown = true; counts = result;
        const announcement = increase > 0 ? `${increase} new attention item${increase === 1 ? "" : "s"}`
          : store.getState().announcement === "Could not update attention count" ? "" : store.getState().announcement;
        project({ announcement });
        return changed;
      } catch (error) {
        if (valid(generation, controller.signal) && version === revision) {
          const failure = normalizeError(error);
          if ([401, 403, 404].includes(failure.status) || failure.code === "flag_off") {
            terminal = true; stopWarmup?.(); poller.stop();
          }
          project({ countError: failure, announcement: "Could not update attention count" });
        }
        throw error;
      } finally {
        signal?.removeEventListener("abort", abort);
        if (countController === controller) {
          countController = undefined; countFlight = undefined; project({ counting: false });
          if (resuming && started && valid(generation, controller.signal) && !terminal) deferPolling();
        }
      }
    })();
    countFlight = flight;
    return flight;
  }
  const poller = createPoller({
    intervalMs: 30_000, maxIntervalMs: 180_000,
    isActive: () => available() && !terminal,
    // Pending writes are activity, not evidence of an idle feed.
    run: async signal => ({ changed: store.getState().pending.length > 0 || await refreshCounts(signal) }),
  });
  function deferPolling() {
    stopWarmup?.();
    const doc = typeof document === "undefined" ? undefined : document;
    const win = typeof window === "undefined" ? undefined : window;
    const begin = () => {
      stopWarmup?.();
      if (started && available() && !terminal) poller.start();
    };
    const timer = setTimeout(begin, 30_000);
    doc?.addEventListener("visibilitychange", begin);
    win?.addEventListener("focus", begin);
    stopWarmup = () => {
      clearTimeout(timer);
      doc?.removeEventListener("visibilitychange", begin);
      win?.removeEventListener("focus", begin);
      stopWarmup = undefined;
    };
  }
  async function page(reset: boolean, filter = store.getState().filter): Promise<void> {
    if (!available()) return;
    if (!reset && listFlight) return listFlight;
    const state = store.getState();
    if (!reset && state.loaded && !state.nextCursor) return;
    listController?.abort();
    const controller = new AbortController(); listController = controller;
    const generation = epoch;
    const cursor = reset ? undefined : state.nextCursor ?? undefined;
    project({ loading: true, listError: null, ...(reset ? { filter } : {}) });
    const flight = (async () => {
      try {
        // Mutations may invalidate readAt on a page. Retry the same cursor twice;
        // continuing churn must become a visible, retryable error, never an empty idle panel.
        for (let attempt = 0; attempt < 3; attempt++) {
          const version = revision;
          const result = await api.call(ROUTES.listAttention, { query: { filter, cursor }, signal: controller.signal });
          if (!valid(generation, controller.signal) || listController !== controller) return;
          if (version !== revision) continue;
          const overflow = merge(result.items, reset);
          const truncated = overflow || (entities.size >= maxItems && result.nextCursor !== null);
          // Stop at the memory window instead of offering pages we would immediately discard.
          const nextCursor = truncated || result.nextCursor === cursor ? null : result.nextCursor;
          project({ loaded: true, truncated, nextCursor, snapshotAt: reset || !state.loaded ? result.snapshotAt : state.snapshotAt });
          return;
        }
        throw new ApiError("stale_page", 0, "Attention changed while loading. Retry available");
      } catch (error) {
        if (valid(generation, controller.signal) && listController === controller) project({ listError: normalizeError(error), announcement: "Could not load attention items" });
      } finally {
        if (listController === controller) { listController = undefined; listFlight = undefined; project({ loading: false }); }
      }
    })();
    listFlight = flight;
    return flight;
  }
  function markRead(input: MarkAttentionRead): Promise<boolean> {
    if (!available()) return Promise.resolve(false);
    const body = MarkAttentionRead.parse(input);
    if (store.getState().pending.length >= 100) return Promise.resolve(false);
    const mutation: AttentionMutation = { id: ++sequence, body, readAt: Date.now() };
    const generation = epoch;
    // Invalidate reads taken before this write; counts have no server version.
    revision++;
    countController?.abort();
    project({ pending: [...store.getState().pending, mutation] });
    const outcome = queue.then(async () => {
      if (!available() || generation !== epoch) return false;
      const controller = new AbortController(); mutationController = controller;
      try {
        const result = await api.call(ROUTES.markAttentionRead, { body, signal: controller.signal });
        if (!valid(generation, controller.signal)) return false;
        revision++;
        counts = result; countKnown = true; // Server truth includes unread items outside the bounded cache.
        for (const [id, item] of optimisticItems) if (matches(item, body)) optimisticItems.delete(id);
        entities = new Map([...entities].map(([id, item]) => [id, item.readAt === null && matches(item, body)
          ? { ...item, readAt: mutation.readAt } : item]));
        project({ pending: store.getState().pending.filter(entry => entry.id !== mutation.id), announcement: "Attention marked read" });
        return true;
      } catch (error) {
        if (valid(generation, controller.signal)) {
          revision++;
          project({ pending: store.getState().pending.filter(entry => entry.id !== mutation.id),
            failed: [...store.getState().failed, { ...mutation, error: normalizeError(error) }].slice(-20),
            announcement: "Could not mark attention read. Retry available" });
        }
        return false;
      } finally {
        if (mutationController === controller) mutationController = undefined;
      }
    });
    queue = outcome.then(() => undefined);
    return outcome;
  }
  function stop() {
    stopped = true; started = false; epoch++; revision++; stopWarmup?.();
    poller.stop(); listController?.abort(); countController?.abort(); mutationController?.abort();
    listController = undefined; listFlight = undefined; countController = undefined; countFlight = undefined;
    // A queued write cannot run in a new lifecycle. Old promises still settle to false.
    queue = Promise.resolve();
    project({ pending: [], loading: false, counting: false });
  }
  function start() {
    if (started && !terminal) return;
    stopped = false; started = true; terminal = false;
    if (!enabled) return;
    if (delayInitial) { delayInitial = false; deferPolling(); }
    else poller.start();
  }
  return {
    ...store,
    start, stop,
    /** Reference-counted effect ownership supports multiple badges/panels and StrictMode. */
    retain() {
      if (++retains === 1) start();
      let released = false;
      return () => { if (!released) { released = true; if (--retains === 0) stop(); } };
    },
    refreshCounts,
    refresh: () => page(true),
    loadMore: () => page(false),
    setFilter(filter: AttentionFilter) {
      const parsed = AttentionFilter.parse(filter);
      if (parsed === store.getState().filter) return Promise.resolve();
      listController?.abort(); entities = new Map();
      project({ filter: parsed, loaded: false, truncated: false, nextCursor: null, snapshotAt: null });
      return page(true, parsed);
    },
    markRead,
    retry(id: number) {
      const failed = store.getState().failed.find(entry => entry.id === id);
      if (!failed || !available() || store.getState().pending.length >= 100) return Promise.resolve(false);
      project({ failed: store.getState().failed.filter(entry => entry.id !== id) });
      return markRead(failed.body);
    },
    dismissFailure(id: number) { project({ failed: store.getState().failed.filter(entry => entry.id !== id) }); },
  };
}
export type AttentionStore = ReturnType<typeof createAttentionStore>;
export const selectAttentionCount = (state: AttentionState) => state.counts.count;
export const selectAttentionBadge = (space: SpaceId) => (state: AttentionState) => state.counts.unreadCounts[space];
export { useAttention, useAttentionCount, useAttentionBadge } from "./hooks/attention";
