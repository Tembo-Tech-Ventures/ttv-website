import { ROUTES, type ChannelRead, type Id, type Message, type MessageList, type ReactionKind } from "../contracts";
import { ApiError, createApiClient, type ApiClient } from "./apiClient";
import type { PollResult } from "./poller";
import { createStore } from "./store";
import {
  acceptsNew, appendNewer, compareMessages, evict, prependOlder, removeIds, segmentFromLatest, segmentIds,
  segmentMessages, type Segment,
} from "./channelWindow";

export interface ChannelReadState {
  /** Newest message the reader has read, including an advance the server has not confirmed yet. */
  markerId: Id | null;
  /** Server-confirmed marker. It only ever moves forward. */
  confirmedId: Id | null;
  /** Unread count; null until known. Optimistically 0 after reading the newest message. */
  unreadCount: number | null;
  pending: boolean;
  /** The last read sync failed; `retryRead()` sends it again. */
  error: ApiError | null;
}
export interface ChannelThreadState {
  parentId: Id;
  status: "loading" | "ready" | "error" | "removed";
  /** Replies, oldest first. */
  messages: readonly Message[];
  /** The parent message when cached; it is kept while the pane is open. */
  parent: Message | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  error: ApiError | null;
}
export interface ChannelState {
  channelId: Id;
  status: "idle" | "loading" | "ready" | "error";
  /** Retained root messages, oldest first. */
  messages: readonly Message[];
  hasOlder: boolean;
  /** Older history exists but was trimmed from memory; `jumpToLatest()` pages through it again. */
  olderTrimmed: boolean;
  loadingOlder: boolean;
  olderError: ApiError | null;
  /** At the newest messages and polling. False after newer pages were evicted ("Jump to latest"). */
  live: boolean;
  /** The latest load or polling failure. */
  error: ApiError | null;
  /** 401/403/404/flag_off: requests stopped until `restart()`. */
  terminal: boolean;
  anchorId: Id | null;
  thread: ChannelThreadState | null;
  read: ChannelReadState;
  /** Polite aria-live text: new messages and failures. */
  announcement: string;
}
/**
 * An unconfirmed change shown over the cached copy of a message (S-2.2's
 * optimistic edits, deletions and reactions). Server copies replace the cached
 * message underneath; the overlay stays on top until its owner clears it.
 */
export interface MessageOverlay {
  body?: string;
  deleted?: boolean;
  /** The reader's wanted `mine` for each reaction kind. */
  reactions?: Partial<Record<ReactionKind, boolean>>;
}
export interface ChannelInitialRead {
  lastReadMessageId: Id | null;
  unreadCount: number;
}
export interface ChannelOptions {
  channelId: Id;
  /** Supply Me.flags.channels. Defaults to false: no requests while disabled. */
  enabled?: boolean;
  api?: ApiClient;
  /** Explicit fixture client from `client/channel.mock`. */
  mock?: ApiClient;
  /** Server-rendered latest page (no cursor), used for SSR and hydration. */
  initial?: MessageList;
  initialRead?: ChannelInitialRead;
  /** The signed-in user; their own new messages are not announced. */
  viewerId?: Id | null;
  /** Root messages kept in memory. Default 600, allowed 50–10000. */
  maxMessages?: number;
  /** Replies kept for the open thread. Default 500, allowed 50–10000. */
  maxThreadMessages?: number;
  /** Polled messages join the newest page until it holds this many. Default 50. */
  pageSize?: number;
  /** Receives every confirmed read marker, for example `channelList.applyRead`. */
  onRead?: (read: ChannelRead) => void;
}

export const CHANNEL_POLL_INTERVAL_MS = 5_000;
/** Messages the reader's own deletions confirmed, remembered so no older server copy shows them again. */
const MAX_CONFIRMED_DELETIONS = 500;
export const CHANNEL_MAX_POLL_INTERVAL_MS = 30_000;

type Scope = "channel" | "thread";
interface Flight<T> { controller: AbortController; promise: Promise<T> }
interface ThreadCache { parentId: Id; gen: number; segment: Segment | null }
/** A marker's id and its position. An unknown server marker borrows the position of the one sent. */
interface ReadKey { id: Id; position: Pick<Message, "createdAt" | "id"> }

const terminalCodes = new Set(["flag_off", "forbidden", "not_found"]);
const isTerminal = (error: ApiError) => [401, 403, 404].includes(error.status) || terminalCodes.has(error.code);
/** The server refuses an expired or unknown cursor; a fresh snapshot replaces it. */
const isCursorRejected = (error: ApiError) => error.status === 410 || (error.status === 400 && error.code === "validation");
const isAbort = (error: unknown) => error instanceof ApiError && error.code === "aborted";
const normalizeError = (error: unknown) => error instanceof ApiError ? error
  : new ApiError("client_error", 0, "Channel request failed", undefined, { cause: error });
const ahead = (a: ReadKey | null, b: ReadKey | null) => a !== null && (b === null || compareMessages(a.position, b.position) > 0);
const keyOf = (message: Message): ReadKey => ({ id: message.id, position: message });

function withReaction(reactions: Message["reactions"], kind: ReactionKind, mine: boolean): Message["reactions"] {
  const existing = reactions.find(reaction => reaction.kind === kind);
  if ((existing?.mine ?? false) === mine) return reactions;
  const count = Math.max(0, (existing?.count ?? 0) + (mine ? 1 : -1));
  const next = existing
    ? reactions.map(reaction => reaction.kind === kind ? { ...reaction, count, mine } : reaction)
    : [...reactions, { kind, count, mine }];
  return next.filter(reaction => reaction.count > 0);
}

/** The message as the reader should see it while the overlay's changes are unconfirmed. */
export function applyOverlay(message: Message, overlay: MessageOverlay): Message {
  if (overlay.deleted || message.deleted) {
    return message.deleted ? message : { ...message, body: "", embeds: [], citations: [], reactions: [], deleted: true };
  }
  let reactions = message.reactions;
  for (const [kind, mine] of Object.entries(overlay.reactions ?? {}) as [ReactionKind, boolean][]) {
    reactions = withReaction(reactions, kind, mine);
  }
  const edited = overlay.body !== undefined && overlay.body !== message.body;
  if (!edited && reactions === message.reactions) return message;
  return { ...message, reactions, ...(edited ? { body: overlay.body, edited: true } : {}) };
}

/** Keep the previous array when every element is the same object, so selectors stay stable. */
function stable<T>(previous: readonly T[], next: readonly T[]): readonly T[] {
  return previous.length === next.length && next.every((item, i) => item === previous[i]) ? previous : next;
}

function checkLimit(name: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`Invalid ${name}`);
}

/** Start abortable work owned by the store, optionally also cancelled by a caller's signal. */
function flight<T>(work: (signal: AbortSignal) => Promise<T>, signal: AbortSignal | undefined, done: (f: Flight<T>) => void): Flight<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const result: Flight<T> = {
    controller,
    promise: work(controller.signal).finally(() => {
      signal?.removeEventListener("abort", abort);
      done(result);
    }),
  };
  return result;
}

/** One store per channel view. Construction performs no network, timer or browser work. */
export function createChannelStore(options: ChannelOptions) {
  const { channelId, enabled = false, viewerId = null, onRead } = options;
  const maxMessages = options.maxMessages ?? 600;
  const maxThreadMessages = options.maxThreadMessages ?? 500;
  const pageSize = options.pageSize ?? 50;
  checkLimit("maxMessages", maxMessages, 50, 10_000);
  checkLimit("maxThreadMessages", maxThreadMessages, 50, 10_000);
  checkLimit("pageSize", pageSize, 1, maxMessages);
  const api = options.api ?? options.mock ?? createApiClient();

  const entities = new Map<Id, Message>();
  // Confirmed writes (S-2.2) are pinned against copies from requests that started before them.
  // Such a copy may be older or newer than the write, so a delta that carried one is read again.
  let requestSeq = 0;
  const pins = new Map<Id, number>();
  // The server never undeletes, so these hold whatever a copy's request timing was, cached or not.
  const deletedIds = new Set<Id>();
  const overlays = new Map<Id, MessageOverlay>();
  const overlaid = new WeakMap<Message, { overlay: MessageOverlay; result: Message }>();
  let channel: Segment | null = null;
  let thread: ThreadCache | null = null;
  let anchorId: Id | null = null;
  let stopped = false;
  let terminal = false;
  let retains = 0;
  let windowGen = 0;
  let threadGen = 0;
  let tail: Flight<boolean> | undefined;
  let older: Flight<void> | undefined;
  let threadTail: Flight<boolean> | undefined;
  let threadOlder: Flight<void> | undefined;
  let threadPoll: Flight<boolean> | undefined;
  const available = () => enabled && !stopped && !terminal;

  // Read markers: one request at a time, the newest target wins, nothing rewinds.
  let confirmed: ReadKey | null = null;
  let confirmedUnread = options.initialRead?.unreadCount ?? null;
  let target: ReadKey | null = null;
  let lastFailed: ReadKey | null = null;
  let reads: Flight<void> | undefined;

  function gc() {
    const keep = new Set<Id>(channel ? segmentIds(channel) : []);
    if (thread) {
      keep.add(thread.parentId);
      for (const id of thread.segment ? segmentIds(thread.segment) : []) keep.add(id);
    }
    for (const id of entities.keys()) if (!keep.has(id)) entities.delete(id);
    for (const id of pins.keys()) if (!entities.has(id)) pins.delete(id);
  }

  /** A server copy as it must be shown: a message the reader's deletion was confirmed for stays deleted. */
  const settled = (item: Message) => !item.deleted && deletedIds.has(item.id) ? applyOverlay(item, { deleted: true }) : item;

  /**
   * Cache a server copy, unless a write was confirmed after this request started:
   * then the copy may predate the write, and it is skipped. Returns false when skipped.
   */
  function put(item: Message, started: number): boolean {
    const pin = pins.get(item.id);
    if (pin !== undefined && entities.has(item.id)) {
      if (started <= pin) return false;
      pins.delete(item.id);
    }
    entities.set(item.id, settled(item));
    return true;
  }

  /**
   * Cache a copy from a snapshot (latest page or thread). It is polled from its own
   * checkpoint, so whatever it predates arrives next; only a confirmed deletion is
   * kept meanwhile, because deletion is terminal and can't hide later truth.
   */
  function putSnapshot(item: Message) {
    entities.set(item.id, settled(item));
  }

  function rememberDeleted(item: Message) {
    if (!item.deleted || deletedIds.has(item.id)) return;
    deletedIds.add(item.id);
    if (deletedIds.size > MAX_CONFIRMED_DELETIONS) deletedIds.delete(deletedIds.values().next().value!);
  }

  /** A server copy from a confirmed write: newer than any response to a request already in flight. */
  function confirmWrite(item: Message) {
    rememberDeleted(item);
    entities.set(item.id, item);
    pins.set(item.id, requestSeq);
  }

  function view(message: Message): Message {
    const overlay = overlays.get(message.id);
    if (!overlay) return message;
    const cached = overlaid.get(message);
    if (cached?.overlay === overlay) return cached.result;
    const result = applyOverlay(message, overlay);
    overlaid.set(message, { overlay, result });
    return result;
  }

  function threadState(previous: ChannelThreadState | null): ChannelThreadState | null {
    if (!thread) return null;
    const base: ChannelThreadState = previous?.parentId === thread.parentId ? previous : {
      parentId: thread.parentId, status: "loading", messages: [], parent: null, hasOlder: false,
      loadingOlder: false, error: null,
    };
    const messages = thread.segment ? segmentMessages(thread.segment, entities).map(view) : [];
    const parent = entities.get(thread.parentId);
    return {
      ...base, messages: stable(base.messages, messages), parent: parent ? view(parent) : null,
      hasOlder: (thread.segment?.olderCursor ?? null) !== null, loadingOlder: threadOlder !== undefined,
    };
  }

  /** Fill every field derived from the caches. */
  function derive(state: ChannelState): ChannelState {
    gc();
    const messages = channel ? segmentMessages(channel, entities).map(view) : [];
    return {
      ...state, messages: stable(state.messages, messages), hasOlder: (channel?.olderCursor ?? null) !== null,
      loadingOlder: older !== undefined,
      olderTrimmed: channel?.olderTrimmed ?? false, live: channel?.live ?? false, anchorId,
      thread: threadState(state.thread),
    };
  }

  if (options.initial) {
    const roots = options.initial.items.filter(item => item.parentId === null);
    for (const item of roots) entities.set(item.id, item);
    channel = evict(segmentFromLatest(options.initial, roots), { maxMessages, anchorId: null });
  }
  const initialMarker = options.initialRead?.lastReadMessageId ?? null;
  if (initialMarker !== null) {
    // An uncached marker is older than everything retained, as far as the client can tell.
    const cached = entities.get(initialMarker);
    confirmed = cached ? keyOf(cached) : { id: initialMarker, position: { createdAt: -1, id: initialMarker } };
  }
  const store = createStore<ChannelState>(derive({
    channelId, status: options.initial ? "ready" : "idle", messages: [], hasOlder: false, olderTrimmed: false,
    loadingOlder: false, olderError: null, live: false, error: null, terminal: false, anchorId: null, thread: null,
    read: { markerId: initialMarker, confirmedId: initialMarker, unreadCount: confirmedUnread, pending: false, error: null },
    announcement: "",
  }));

  const publish = (update: Partial<ChannelState> = {}) => store.setState(state => derive({ ...state, ...update }));
  const patchThread = (update: Partial<ChannelThreadState>) =>
    store.setState(state => state.thread ? { ...state, thread: { ...state.thread, ...update } } : state);
  const patchRead = (update: Partial<ChannelReadState>) =>
    store.setState(state => ({ ...state, read: { ...state.read, ...update } }));

  /** Record a failure; authorization and flag failures stop all requests. */
  function fail(error: ApiError, announcement: string, update: Partial<ChannelState> = {}) {
    if (isTerminal(error)) {
      terminal = true;
      abortAll();
    }
    publish({ error, terminal, announcement, ...update });
  }

  function forget(removedIds: readonly Id[]) {
    const removed = new Set(removedIds);
    let changed = false;
    for (const id of removed) changed = entities.delete(id) || changed;
    if (channel) channel = removeIds(channel, removed);
    if (thread?.segment) thread.segment = removeIds(thread.segment, removed);
    if (anchorId !== null && removed.has(anchorId)) anchorId = null;
    return { changed, parentRemoved: thread !== null && removed.has(thread.parentId) };
  }

  /**
   * Merge a forward delta (a `since` page, or messages the client posted) into
   * one scope: removals, edits to cached messages, then accepted new messages.
   */
  function applyDelta(scope: Scope, page: MessageList, started: number | "confirmed") {
    const removal = forget(page.removedIds);
    let changed = removal.changed;
    let skipped = false;
    const fresh: Message[] = [];
    const cache = (item: Message) => {
      if (started === "confirmed") confirmWrite(item);
      else if (!put(item, started)) skipped = true;
    };
    for (const item of page.items) {
      if (entities.has(item.id)) { cache(item); changed = true; continue; }
      const segment = scope === "channel" ? channel : thread?.segment;
      const belongs = scope === "channel" ? item.parentId === null : item.parentId === thread?.parentId;
      if (!belongs || !segment?.live || !acceptsNew(segment, entities, item)) continue;
      cache(item);
      fresh.push(item);
    }
    // A skipped copy might hold a later change (another person's edit or deletion): keep the old
    // checkpoint, so the next poll, which starts after the write, reads this delta again.
    const next = (segment: Segment) => {
      const appended = appendNewer(segment, page, fresh, pageSize);
      return skipped ? { ...appended, sinceCursor: segment.sinceCursor } : appended;
    };
    if (scope === "channel" && channel) {
      channel = evict(next(channel), { maxMessages, anchorId });
    } else if (scope === "thread" && thread?.segment) {
      thread.segment = evict(next(thread.segment), { maxMessages: maxThreadMessages, anchorId: null });
    }
    return { changed: changed || fresh.length > 0, fresh, parentRemoved: removal.parentRemoved };
  }

  /**
   * Cache an older page's messages. Every id joins the segment (`prependOlder`
   * skips ids already retained), even one cached for another reason, such as an
   * open thread's parent. While the segment is live, polling keeps cached copies
   * fresh, so they win; otherwise the page's copy is the newer one.
   */
  function cacheOlder(items: readonly Message[], live: boolean, started: number): Message[] {
    for (const item of items) if (!live || !entities.has(item.id)) put(item, started);
    return items.map(item => entities.get(item.id)!);
  }

  /** A successful thread request clears an earlier failure; a removed thread stays removed. */
  function recoverThread() {
    store.setState(state => state.thread?.status === "error"
      ? { ...state, thread: { ...state.thread, status: "ready", error: null } } : state);
  }

  /** The parent of the open thread was removed while the pane is showing it. */
  function threadRemoved() {
    patchThread({ status: "removed" });
    publish({ announcement: "This thread is no longer available" });
  }

  function announceFresh(fresh: readonly Message[], noun: string): Partial<ChannelState> {
    const count = fresh.filter(item => item.author.id === null || item.author.id !== viewerId).length;
    return count > 0 ? { announcement: `${count} new ${noun}${count === 1 ? "" : "s"}` } : {};
  }

  const list = (query: { before?: string; since?: string; thread?: Id }, signal: AbortSignal) =>
    api.call(ROUTES.listMessages, { params: { id: channelId }, query, signal });

  // ---- Channel window ----

  function runTail(work: (signal: AbortSignal) => Promise<boolean>, signal?: AbortSignal): Promise<boolean> {
    tail ??= flight(work, signal, done => { if (tail === done) tail = undefined; });
    return tail.promise;
  }

  async function fetchLatest(signal: AbortSignal): Promise<boolean> {
    const gen = ++windowGen;
    older?.controller.abort();
    if (!channel) publish({ status: "loading", error: null });
    try {
      const page = await list({}, signal);
      if (!available() || gen !== windowGen) return false;
      forget(page.removedIds);
      const roots = page.items.filter(item => item.parentId === null);
      for (const item of roots) putSnapshot(item);
      anchorId = null;
      channel = evict(segmentFromLatest(page, roots), { maxMessages, anchorId: null });
      publish({ status: "ready", error: null, olderError: null });
      return true;
    } catch (error) {
      if (isAbort(error) || gen !== windowGen) return false;
      fail(normalizeError(error), "Could not load messages", channel ? {} : { status: "error" });
      return false;
    }
  }

  async function pollChannel(signal: AbortSignal): Promise<boolean> {
    if (!channel?.live) return false;
    const cursor = channel.sinceCursor;
    const gen = windowGen;
    const started = ++requestSeq;
    try {
      const page = await list({ since: cursor }, signal);
      // A reset, eviction or newer response already moved the checkpoint: this response is stale.
      if (!available() || gen !== windowGen || !channel?.live || channel.sinceCursor !== cursor) return false;
      const { changed, fresh, parentRemoved } = applyDelta("channel", page, started);
      publish({ error: null, ...announceFresh(fresh, "message") });
      if (parentRemoved) threadRemoved();
      return changed;
    } catch (error) {
      if (isAbort(error) || gen !== windowGen) return false;
      const failure = normalizeError(error);
      if (isCursorRejected(failure)) return fetchLatest(signal);
      fail(failure, "Could not update messages");
      return false;
    }
  }

  async function fetchOlder(cursor: string, signal: AbortSignal): Promise<void> {
    const gen = windowGen;
    // Reading older history: keep the current top unless the UI reported an anchor.
    const keep = anchorId ?? channel?.pages[0]?.ids[0] ?? null;
    const started = ++requestSeq;
    try {
      const page = await list({ before: cursor }, signal);
      if (!available() || gen !== windowGen || channel?.olderCursor !== cursor) return;
      forget(page.removedIds);
      const roots = cacheOlder(page.items.filter(item => item.parentId === null), channel.live, started);
      channel = evict(prependOlder(channel, page, roots), { maxMessages, anchorId: keep });
    } catch (error) {
      if (isAbort(error) || gen !== windowGen) return;
      const failure = normalizeError(error);
      fail(failure, "Could not load older messages", { olderError: failure, error: store.getState().error });
    }
  }

  function loadOlder(): Promise<void> {
    const cursor = channel?.olderCursor ?? null;
    if (!available() || cursor === null) return Promise.resolve();
    if (older) return older.promise;
    older = flight(signal => fetchOlder(cursor, signal), undefined, done => {
      if (older !== done) return;
      older = undefined;
      publish();
    });
    publish({ olderError: null });
    return older.promise;
  }

  function jumpToLatest(): Promise<boolean> {
    if (!available()) return Promise.resolve(false);
    tail?.controller.abort();
    tail = undefined;
    return runTail(fetchLatest);
  }

  // ---- Thread pane ----

  const currentThread = (cache: ThreadCache) => available() && thread === cache && cache.gen === threadGen;
  /** A loaded thread whose parent still exists keeps polling, even when the channel window does not. */
  const threadLive = () => thread?.segment?.live === true && store.getState().thread?.status !== "removed";

  const threadGone = () => store.getState().thread?.status === "removed";

  function threadFailure(failure: ApiError) {
    const removed = failure.status === 404 && failure.code !== "flag_off";
    if (!removed && isTerminal(failure)) { fail(failure, "Could not load replies"); return; }
    // A removed thread stays removed: a later failure must not let it recover to "ready".
    if (threadGone()) return;
    patchThread({ status: removed ? "removed" : "error", error: failure });
    publish({ announcement: removed ? "This thread is no longer available" : "Could not load replies" });
  }

  async function fetchThread(cache: ThreadCache, signal: AbortSignal): Promise<boolean> {
    try {
      const page = await list({ thread: cache.parentId }, signal);
      if (!currentThread(cache)) return false;
      forget(page.removedIds);
      const replies = page.items.filter(item => item.parentId === cache.parentId);
      for (const item of replies) putSnapshot(item);
      cache.segment = evict(segmentFromLatest(page, replies), { maxMessages: maxThreadMessages, anchorId: null });
      publish();
      // The parent's tombstone arrived while the thread was loading: it stays removed.
      if (!threadGone()) patchThread({ status: "ready", error: null });
      return true;
    } catch (error) {
      if (isAbort(error) || !currentThread(cache)) return false;
      threadFailure(normalizeError(error));
      return false;
    }
  }

  function abortThread() {
    threadGen++;
    for (const current of [threadTail, threadOlder, threadPoll]) current?.controller.abort();
    threadTail = undefined;
    threadOlder = undefined;
    threadPoll = undefined;
  }

  function openThread(parentId: Id): Promise<boolean> {
    if (!available()) return Promise.resolve(false);
    const status = store.getState().thread?.status;
    if (thread?.parentId === parentId && (status === "loading" || status === "ready")) {
      return threadTail?.promise ?? Promise.resolve(true);
    }
    abortThread();
    const cache: ThreadCache = { parentId, gen: threadGen, segment: null };
    thread = cache;
    publish({ thread: null }); // a fresh pane, even when reopening the same parent
    threadTail = flight(signal => fetchThread(cache, signal), undefined, done => { if (threadTail === done) threadTail = undefined; });
    return threadTail.promise;
  }

  function closeThread() {
    abortThread();
    thread = null;
    publish();
  }

  async function pollThread(signal: AbortSignal): Promise<boolean> {
    const cache = thread;
    if (!cache?.segment || !threadLive() || threadTail) return false;
    const cursor = cache.segment.sinceCursor;
    const started = ++requestSeq;
    try {
      const page = await list({ since: cursor, thread: cache.parentId }, signal);
      if (!currentThread(cache) || !cache.segment?.live || cache.segment.sinceCursor !== cursor) return false;
      const { changed, fresh, parentRemoved } = applyDelta("thread", page, started);
      publish(announceFresh(fresh, "reply"));
      recoverThread();
      if (parentRemoved) threadRemoved();
      return changed;
    } catch (error) {
      if (isAbort(error) || !currentThread(cache)) return false;
      const failure = normalizeError(error);
      if (!isCursorRejected(failure)) { threadFailure(failure); return false; }
      thread = null;
      return openThread(cache.parentId);
    }
  }

  async function fetchOlderReplies(cache: ThreadCache, cursor: string, signal: AbortSignal): Promise<void> {
    const started = ++requestSeq;
    try {
      const page = await list({ before: cursor, thread: cache.parentId }, signal);
      if (!currentThread(cache) || cache.segment?.olderCursor !== cursor) return;
      forget(page.removedIds);
      const replies = cacheOlder(page.items.filter(item => item.parentId === cache.parentId), cache.segment.live, started);
      const keep = cache.segment.pages[0]?.ids[0] ?? null;
      cache.segment = evict(prependOlder(cache.segment, page, replies), { maxMessages: maxThreadMessages, anchorId: keep });
      recoverThread();
    } catch (error) {
      if (isAbort(error) || !currentThread(cache)) return;
      threadFailure(normalizeError(error));
    }
  }

  function loadOlderReplies(): Promise<void> {
    const cache = thread;
    const cursor = cache?.segment?.olderCursor ?? null;
    if (!available() || !cache || cursor === null) return Promise.resolve();
    if (threadOlder) return threadOlder.promise;
    threadOlder = flight(signal => fetchOlderReplies(cache, cursor, signal), undefined, done => {
      if (threadOlder !== done) return;
      threadOlder = undefined;
      publish();
    });
    publish();
    patchThread({ error: null });
    return threadOlder.promise;
  }

  // ---- Polling: useChannelFeed drives `poll` through useVisibilityPolling ----

  function isPollActive(): boolean {
    return available() && (channel === null || channel.live || threadLive());
  }

  async function poll(signal: AbortSignal): Promise<PollResult> {
    if (!available()) return { changed: false };
    const channelWork = runTail(inner => channel === null ? fetchLatest(inner) : pollChannel(inner), signal);
    let threadWork = Promise.resolve(false);
    if (threadLive()) {
      threadPoll = flight(pollThread, signal, done => { if (threadPoll === done) threadPoll = undefined; });
      threadWork = threadPoll.promise;
    }
    const [channelChanged, threadChanged] = await Promise.all([channelWork, threadWork]);
    return { changed: channelChanged || threadChanged };
  }

  // ---- Read markers ----

  function confirm(sent: ReadKey, read: ChannelRead) {
    const known = entities.get(read.lastReadMessageId);
    // The server never rewinds, so a marker unknown here is at least as new as the one sent.
    const reported = read.lastReadMessageId === sent.id ? sent
      : known ? keyOf(known) : { id: read.lastReadMessageId, position: sent.position };
    const stale = reported.id !== confirmed?.id && !ahead(reported, confirmed);
    if (!stale) {
      confirmed = reported;
      confirmedUnread = read.unreadCount;
    }
    const queued = ahead(target, confirmed);
    patchRead({
      confirmedId: confirmed?.id ?? null, markerId: (queued ? target : confirmed)?.id ?? null,
      // While a newer target waits, keep its optimistic count.
      ...(queued ? {} : { unreadCount: confirmedUnread }),
    });
    if (!stale) onRead?.(read);
  }

  async function drainReads(signal: AbortSignal) {
    while (target && ahead(target, confirmed)) {
      const sent = target;
      target = null;
      try {
        const read = await api.call(ROUTES.markChannelRead, { params: { id: channelId }, body: { messageId: sent.id }, signal });
        lastFailed = null;
        confirm(sent, read);
      } catch (error) {
        if (isAbort(error)) return;
        // Back to server truth. The newest unsent target is what a retry sends.
        lastFailed = ahead(target, sent) ? target : sent;
        target = null;
        patchRead({ markerId: confirmed?.id ?? null, unreadCount: confirmedUnread, error: normalizeError(error) });
        publish({ announcement: "Could not mark messages read" });
        return;
      }
    }
  }

  async function advance(key: ReadKey): Promise<boolean> {
    if (!available()) return false;
    if (!ahead(key, ahead(target, confirmed) ? target : confirmed)) return true;
    target = key;
    const newest = channel?.live ? store.getState().messages.at(-1) : undefined;
    patchRead({ markerId: key.id, pending: true, error: null, ...(newest?.id === key.id ? { unreadCount: 0 } : {}) });
    reads ??= flight(drainReads, undefined, done => {
      if (reads !== done) return;
      reads = undefined;
      patchRead({ pending: false });
    });
    await reads.promise;
    return !ahead(key, confirmed);
  }

  // ---- Lifecycle ----

  function abortAll() {
    windowGen++;
    for (const current of [tail, older, reads]) current?.controller.abort();
    tail = undefined;
    older = undefined;
    reads = undefined;
    if (target) target = null;
    patchRead({ markerId: confirmed?.id ?? null, unreadCount: confirmedUnread, pending: false });
    abortThread();
    // A loaded thread survives (restart or a new owner resumes it); a half-opened one is dropped.
    if (thread?.segment) thread.gen = threadGen;
    else thread = null;
  }

  return {
    ...store,
    channelId,
    enabled,
    poll,
    isPollActive,
    loadOlder,
    jumpToLatest,
    /** Report the message at the reader's viewport; eviction keeps its page. Null means the newest end. */
    setAnchor(id: Id | null) {
      anchorId = id !== null && entities.has(id) ? id : null;
      publish();
    },
    openThread,
    closeThread,
    loadOlderReplies,
    /** Advance the read marker to a cached message of this channel. Older targets are no-ops. */
    markRead(messageId: Id): Promise<boolean> {
      const message = entities.get(messageId);
      if (!message || message.channelId !== channelId) return Promise.resolve(false);
      return advance(keyOf(message));
    },
    retryRead(): Promise<boolean> {
      const failed = lastFailed;
      lastFailed = null;
      return failed ? advance(failed) : Promise.resolve(false);
    },
    /**
     * Merge server-confirmed messages (for example S-2.2's post response) without
     * moving cursors. Polling later returns them again; ids deduplicate. A
     * response to a request that started before this call cannot replace them.
     */
    receive(items: readonly Message[]) {
      if (!available()) return;
      const own = items.filter(item => item.channelId === channelId);
      if (channel) applyDelta("channel", { items: own, removedIds: [], beforeCursor: null, sinceCursor: channel.sinceCursor, thread: null }, "confirmed");
      if (thread?.segment) {
        applyDelta("thread", { items: own, removedIds: [], beforeCursor: null, sinceCursor: thread.segment.sinceCursor, thread: thread.parentId }, "confirmed");
      }
      publish();
    },
    /**
     * Replace cached copies with server-confirmed ones (edit, delete and reaction
     * responses). Unlike `receive`, it never adds a message, so a confirmation
     * cannot bring back one that polling removed.
     */
    update(items: readonly Message[]) {
      if (!available()) return;
      let changed = false;
      for (const item of items) {
        if (item.channelId !== channelId) continue;
        // A confirmed deletion counts even for a message no longer cached (a closed thread).
        rememberDeleted(item);
        if (!entities.has(item.id)) continue;
        confirmWrite(item);
        changed = true;
      }
      if (changed) publish();
    },
    /** The cached server copy, without any overlay. */
    peek(id: Id): Message | undefined { return entities.get(id); },
    /** Show (or with null, clear) unconfirmed changes over a message. */
    setOverlay(id: Id, overlay: MessageOverlay | null) {
      if (overlay === null ? !overlays.delete(id) : overlays.get(id) === overlay) return;
      if (overlay !== null) overlays.set(id, overlay);
      publish();
    },
    /** Reference-counted ownership: hooks retain; the last release aborts all work. */
    retain() {
      retains++;
      stopped = false;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--retains > 0) return;
        stopped = true;
        abortAll();
        publish();
      };
    },
    /** Resume after a terminal error, for example after signing in again. */
    restart() {
      terminal = false;
      publish({ terminal: false, error: null });
    },
    clearAnnouncement() { publish({ announcement: "" }); },
  };
}
export type ChannelStore = ReturnType<typeof createChannelStore>;

/** The first retained root message after the read marker, for a "New" divider. */
export function selectFirstUnread(state: ChannelState): Message | null {
  if (state.read.markerId === null) return null;
  const index = state.messages.findIndex(message => message.id === state.read.markerId);
  return index < 0 ? null : state.messages[index + 1] ?? null;
}
export const selectUnreadCount = (state: ChannelState) => state.read.unreadCount;
/** True while polling should run; useChannelFeed restarts the poller when this turns true. */
export const selectPollable = (state: ChannelState) =>
  !state.terminal && (state.status !== "ready" || state.live || state.thread?.status === "ready");
