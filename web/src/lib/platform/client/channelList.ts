import { ChannelList, ROUTES, type Channel, type ChannelRead, type Id, type SpaceId } from "../contracts";
import { ApiError, createApiClient, type ApiClient } from "./apiClient";
import { createPoller } from "./poller";
import { createStore } from "./store";

export interface ChannelListState {
  /** Visible channels in server order, each with the caller's unread count. */
  channels: readonly Channel[];
  loaded: boolean;
  loading: boolean;
  error: ApiError | null;
  /** 401/403/404/flag_off: polling stopped until `refresh()` succeeds. */
  terminal: boolean;
}
export interface ChannelListOptions {
  /** Supply Me.flags.channels. Defaults to false: no requests while disabled. */
  enabled?: boolean;
  api?: ApiClient;
  /** Explicit fixture client from `client/channel.mock`. */
  mock?: ApiClient;
  /** Server-rendered list for SSR and hydration. The first poll then waits one interval. */
  initial?: ChannelList;
}

export const CHANNEL_LIST_POLL_INTERVAL_MS = 30_000;
export const CHANNEL_LIST_MAX_POLL_INTERVAL_MS = 120_000;

const normalizeError = (error: unknown) => error instanceof ApiError ? error
  : new ApiError("client_error", 0, "Channel list request failed", undefined, { cause: error });
const isTerminal = (error: ApiError) => [401, 403, 404].includes(error.status) || error.code === "flag_off";
const summary = (channels: readonly Channel[]) =>
  JSON.stringify(channels.map(channel => [channel.id, channel.unreadCount, channel.lastMessageAt, channel.archivedAt]));

/**
 * Per-user channel list: the sidebars' source of channel unread counts. One
 * instance per signed-in user and request. Badges share it through `retain()`.
 */
export function createChannelListStore(options: ChannelListOptions = {}) {
  const { enabled = false } = options;
  const api = options.api ?? options.mock ?? createApiClient();
  const initial = options.initial ? ChannelList.parse(options.initial) : undefined;
  const store = createStore<ChannelListState>({
    channels: initial?.items ?? [], loaded: !!initial, loading: false, error: null, terminal: false,
  });
  // Read results newer than an in-flight list request win over that request's counts.
  const localReads = new Map<Id, { unreadCount: number; revision: number }>();
  let revision = 0;
  let stopped = false;
  let terminal = false;
  let retains = 0;
  let warmup: ReturnType<typeof setTimeout> | undefined;
  let deferFirstPoll = !!initial;
  let flight: { controller: AbortController; promise: Promise<boolean> } | undefined;
  const available = () => enabled && !stopped;

  function withLocalReads(channels: readonly Channel[], since: number): Channel[] {
    for (const [id, read] of localReads) if (read.revision <= since) localReads.delete(id);
    return channels.map(channel => {
      const local = localReads.get(channel.id);
      return local && local.unreadCount !== channel.unreadCount ? { ...channel, unreadCount: local.unreadCount } : channel;
    });
  }

  function settle(controller: AbortController) {
    if (flight?.controller === controller) flight = undefined;
  }

  /** Resolves true when unread counts or activity changed. Rejects on failure. */
  function refresh(signal?: AbortSignal): Promise<boolean> {
    if (!available()) return Promise.resolve(false);
    if (flight) return flight.promise;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const since = revision;
    store.setState(state => ({ ...state, loading: true }));
    const promise = (async () => {
      try {
        const result = await api.call(ROUTES.listChannels, { signal: controller.signal });
        if (!available() || controller.signal.aborted) return false;
        const previous = store.getState().channels;
        const channels = withLocalReads(result.items, since);
        const resumed = terminal;
        terminal = false;
        store.setState(state => ({ ...state, channels, loaded: true, error: null, terminal: false }));
        if (resumed && retains > 0) poller.start();
        return summary(previous) !== summary(channels);
      } catch (error) {
        if (available() && !controller.signal.aborted) {
          const failure = normalizeError(error);
          terminal = isTerminal(failure);
          if (terminal) poller.stop();
          store.setState(state => ({ ...state, error: failure, terminal }));
        }
        throw error;
      } finally {
        signal?.removeEventListener("abort", abort);
        settle(controller);
        store.setState(state => ({ ...state, loading: false }));
      }
    })();
    flight = { controller, promise };
    return promise;
  }

  const poller = createPoller({
    intervalMs: CHANNEL_LIST_POLL_INTERVAL_MS, maxIntervalMs: CHANNEL_LIST_MAX_POLL_INTERVAL_MS,
    isActive: () => available() && !terminal,
    run: async signal => ({ changed: await refresh(signal) }),
  });

  function start() {
    stopped = false;
    if (!enabled) return;
    if (!deferFirstPoll) { poller.start(); return; }
    deferFirstPoll = false;
    warmup = setTimeout(() => { warmup = undefined; poller.start(); }, CHANNEL_LIST_POLL_INTERVAL_MS);
  }

  function stop() {
    stopped = true;
    clearTimeout(warmup);
    warmup = undefined;
    poller.stop();
    flight?.controller.abort();
    flight = undefined;
    store.setState(state => state.loading ? { ...state, loading: false } : state);
  }

  return {
    ...store,
    refresh,
    /** Apply a confirmed read marker from a channel store (`onRead`). */
    applyRead(read: ChannelRead) {
      revision++;
      localReads.set(read.channelId, { unreadCount: read.unreadCount, revision });
      store.setState(state => {
        const index = state.channels.findIndex(channel => channel.id === read.channelId);
        if (index < 0 || state.channels[index].unreadCount === read.unreadCount) return state;
        const channels = state.channels.with(index, { ...state.channels[index], unreadCount: read.unreadCount });
        return { ...state, channels };
      });
    },
    /** Reference-counted ownership for badges and sidebars; the last release stops polling. */
    retain() {
      if (++retains === 1) start();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--retains === 0) stop();
      };
    },
  };
}
export type ChannelListStore = ReturnType<typeof createChannelListStore>;

/** Cohort channels count towards the Cohort space; community channels and conversations towards Community. */
export function channelSpace(channel: Pick<Channel, "kind">): SpaceId {
  return channel.kind === "COHORT" ? "cohort" : "community";
}
export const selectChannelUnread = (channelId: Id) => (state: ChannelListState) =>
  state.channels.find(channel => channel.id === channelId)?.unreadCount ?? 0;
export const selectSpaceChannelUnread = (space: SpaceId) => (state: ChannelListState) =>
  state.channels.reduce((total, channel) => channelSpace(channel) === space ? total + channel.unreadCount : total, 0);
export const selectChannelUnreadTotal = (state: ChannelListState) =>
  state.channels.reduce((total, channel) => total + channel.unreadCount, 0);
export const selectSpaceChannels = (space: SpaceId) => (state: ChannelListState) =>
  state.channels.filter(channel => channelSpace(channel) === space);
