import {
  EditMessage, PostMessage, ROUTES, type AuthorSummary, type EffectiveFlags, type EmbedRef, type Id, type Message,
  type MessageReactions, type ReactionKind,
} from "../contracts";
import { ApiError, createApiClient, type ApiClient } from "./apiClient";
import type { ChannelState, ChannelStore, MessageOverlay } from "./channel";
import {
  channelDraftKey, clearOtherUsersChannelDrafts, draftScope, MAX_STORED_SENDS, readChannelDrafts, writeChannelDrafts,
  type ChannelDraft, type DraftStorage,
} from "./channel-drafts";
import { sessionDraftStorage } from "./onboarding-drafts";
import { createStore } from "./store";

/** Why a send or change did not go through, in terms the composer can act on. */
export type ComposerFailureReason =
  | "offline" | "interrupted" | "rate_limited" | "conduct_required" | "moderation_rejected" | "forbidden"
  | "unavailable" | "signed_out" | "gone" | "invalid" | "server";

export interface ComposerFailure {
  reason: ComposerFailureReason;
  /** Plain words for the person, also announced politely. */
  message: string;
  /** Sending the same thing again could work. A retried send reuses its nonce, so it is never stored twice. */
  retryable: boolean;
  /** Epoch ms before which the server will refuse again (rate limits); null when unknown. */
  retryAt: number | null;
  error: ApiError | null;
}

/** A send the server has not confirmed: shown after the list (or the open thread) until it is. */
export interface OutboxItem {
  clientNonce: string;
  channelId: Id;
  parentId: Id | null;
  body: string;
  embeds: readonly EmbedRef[];
  createdAt: number;
  status: "sending" | "failed";
  failure: ComposerFailure | null;
}

export interface ComposerState {
  /** Unsent text by `draftScope(parentId)`; a missing scope is an empty draft. */
  drafts: Readonly<Record<string, ChannelDraft>>;
  /** Unconfirmed sends, oldest first. */
  outbox: readonly OutboxItem[];
  /** Messages with an edit, deletion or reaction the server has not confirmed. */
  busy: readonly Id[];
  /** The server asked for the code of conduct first. Cleared by the next confirmed write. */
  conductRequired: boolean;
  /** Polite aria-live text: failures and moderation outcomes of the reader's own sends. */
  announcement: string;
}

export interface SendInput {
  body: string;
  parentId: Id | null;
  embeds: readonly EmbedRef[];
}

export interface MentionCandidates {
  /** Offer `@tembo`: only while `tembo_channels` is on for the reader. */
  tembo: boolean;
  /** People in this conversation, the most recently active first; never the reader. */
  people: readonly AuthorSummary[];
}

export interface ComposerOptions {
  /** The channel this composer writes to. */
  store: ChannelStore;
  /** The signed-in person (the safe `Me` DTO is enough): drafts are per user, `@tembo` needs `flags.tembo_channels`. */
  me: { user: { id: Id }; flags: Partial<EffectiveFlags> };
  api?: ApiClient;
  /** Explicit fixture client from `client/channel.mock`. */
  mock?: ApiClient;
  /** Draft storage; defaults to `window.sessionStorage`, first read when a hook retains the composer. */
  storage?: DraftStorage;
  now?: () => number;
  newNonce?: () => string;
}

/** At most this many people are offered for `@`. */
export const MAX_MENTION_PEOPLE = 50;

const EMPTY_DRAFT: ChannelDraft = { body: "", embeds: [], updatedAt: 0 };

const asApiError = (error: unknown) => error instanceof ApiError ? error
  : new ApiError("client_error", 0, "Channel request failed", undefined, { cause: error });

type FailureKind = readonly [reason: ComposerFailureReason, message: string, retryable: boolean];
const OFFLINE: FailureKind = ["offline", "You're offline. It will send when you're back online, or try again.", true];
const INVALID: FailureKind = ["invalid", "Check the message and try again.", false];
const FAILURE_BY_CODE: Readonly<Partial<Record<string, FailureKind>>> = {
  network_error: OFFLINE,
  aborted: OFFLINE,
  validation_error: INVALID,
  conduct_required: ["conduct_required", "Agree to how we talk to each other first, then try again.", true],
  moderation_rejected: ["moderation_rejected", "This can't be posted as written. Change it and send it again.", false],
  flag_off: ["unavailable", "Conversations aren't available here right now.", false],
};

function failureByStatus(status: number, change: boolean): FailureKind {
  if (status === 401) return ["signed_out", "Your session ended. Sign in again, then try again.", true];
  if (change && (status === 404 || status === 409)) return ["gone", "That message has changed or is no longer here.", false];
  if (status === 404) return ["unavailable", "This channel isn't available.", false];
  if (status === 403) return ["forbidden", "You can't post here.", false];
  if (status >= 400 && status < 500) return INVALID;
  return ["server", "Something went wrong on our side. Try again.", true];
}

/** Turn a refused write into what the composer shows. `change` covers edits, deletions and reactions. */
export function describeFailure(error: unknown, now: number, change = false): ComposerFailure {
  const failure = asApiError(error);
  if (failure.status === 429 || failure.code === "rate_limited") {
    const wait = failure.retryAfterMs;
    const seconds = wait === undefined ? null : Math.max(1, Math.ceil(wait / 1_000));
    const message = seconds === null ? "You're sending quickly. Try again in a moment."
      : `You're sending quickly. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
    return { reason: "rate_limited", message, retryable: true, retryAt: wait === undefined ? null : now + wait, error: failure };
  }
  const [reason, message, retryable] = FAILURE_BY_CODE[failure.code] ?? failureByStatus(failure.status, change);
  return { reason, message, retryable, retryAt: null, error: failure };
}

const INTERRUPTED: ComposerFailure = {
  reason: "interrupted", message: "Not sent yet. Send it again?", retryable: true, retryAt: null, error: null,
};

/**
 * People the reader can `@` here, from what the channel store holds: the thread's
 * repliers and its author first (when `threadId` is the open thread), then the
 * channel's authors, newest first. Tembo, deleted accounts and the reader are left out.
 */
export function selectMentionPeople(state: ChannelState, threadId: Id | null, viewerId: Id | null): AuthorSummary[] {
  const sources: Message[] = [];
  if (threadId !== null && state.thread?.parentId === threadId) {
    sources.push(...state.thread.messages.toReversed());
    if (state.thread.parent) sources.push(state.thread.parent);
  }
  sources.push(...state.messages.toReversed());
  const people: AuthorSummary[] = [];
  const seen = new Set<Id>();
  for (const message of sources) {
    const { author } = message;
    if (message.authorKind !== "USER" || author.id === null || author.id === viewerId || seen.has(author.id)) continue;
    seen.add(author.id);
    people.push(author);
    if (people.length === MAX_MENTION_PEOPLE) break;
  }
  return people;
}

let nonceCounter = 0;
/** A client nonce, unique per author, so a retried send is stored once. */
export function createNonce(): string {
  nonceCounter += 1;
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "") ?? Math.random().toString(36).slice(2);
  return `c${Date.now().toString(36)}${nonceCounter.toString(36)}${random}`.slice(0, 64);
}

type Change =
  | { kind: "edit"; body: string }
  | { kind: "delete" }
  | { kind: "react"; reaction: ReactionKind; active: boolean };

/**
 * Composer state for one channel view: drafts, optimistic sends, and edits,
 * deletions and reactions over the channel store. Construction performs no
 * network, storage, timer or browser work; drafts load when a hook retains it.
 */
export function createComposer(options: ComposerOptions) {
  const { store: channel, me } = options;
  const { channelId } = channel;
  const viewerId = me.user.id;
  const api = options.api ?? options.mock ?? createApiClient();
  const now = options.now ?? Date.now;
  const newNonce = options.newNonce ?? createNonce;
  const storageKey = channelDraftKey(viewerId, channelId);
  const offersTembo = me.flags.tembo_channels === true;

  const store = createStore<ComposerState>({ drafts: {}, outbox: [], busy: [], conductRequired: false, announcement: "" });
  const sending = new Map<string, Promise<Message>>();
  const changes = new Map<Id, Change[]>();
  const queues = new Map<Id, Promise<void>>();
  let storage: DraftStorage | undefined;
  let hydrated = false;
  let retains = 0;
  let unsubscribe: (() => void) | undefined;

  const patch = (update: Partial<ComposerState>) => store.setState(state => ({ ...state, ...update }));
  const findItem = (nonce: string) => store.getState().outbox.find(item => item.clientNonce === nonce);
  const notEnabled = () => new ApiError("flag_off", 404, "Conversations aren't available here right now.");

  function persist() {
    if (!hydrated) return;
    const { drafts, outbox } = store.getState();
    const sends = outbox.map(({ clientNonce, parentId, body, embeds, createdAt }) => ({ clientNonce, parentId, body, embeds, createdAt }));
    writeChannelDrafts(storage, storageKey, { drafts, sends });
  }

  function setOutbox(update: (outbox: readonly OutboxItem[]) => readonly OutboxItem[], extra: Partial<ComposerState> = {}) {
    store.setState(state => ({ ...state, ...extra, outbox: update(state.outbox) }));
    persist();
  }

  /** Read storage once, in the browser. Text typed before hydration wins over stored text. */
  function hydrate() {
    if (hydrated) return;
    hydrated = true;
    storage = options.storage ?? sessionDraftStorage();
    clearOtherUsersChannelDrafts(storage, viewerId);
    const record = readChannelDrafts(storage, storageKey);
    store.setState(state => {
      const known = new Set(state.outbox.map(item => item.clientNonce));
      // A send stored by an earlier page may have landed: retrying reuses its nonce, so it can't post twice.
      const restored = record.sends.filter(stored => !known.has(stored.clientNonce)).map((stored): OutboxItem => ({
        ...stored, channelId, status: "failed", failure: INTERRUPTED,
      }));
      return { ...state, drafts: { ...record.drafts, ...state.drafts }, outbox: [...restored, ...state.outbox] };
    });
    persist();
    reconcile(channel.getState());
  }

  /** A send whose response was lost is confirmed when the channel shows the reader's message with its nonce. */
  function reconcile(state: ChannelState) {
    const { outbox } = store.getState();
    if (outbox.length === 0) return;
    const landed = new Set<string>();
    for (const message of [...state.messages, ...(state.thread?.messages ?? [])]) {
      if (message.clientNonce !== null && message.author.id === viewerId) landed.add(message.clientNonce);
    }
    if (outbox.some(item => landed.has(item.clientNonce))) setOutbox(items => items.filter(item => !landed.has(item.clientNonce)));
  }

  function findLanded(nonce: string): Message | undefined {
    const state = channel.getState();
    return [...state.messages, ...(state.thread?.messages ?? [])]
      .find(message => message.clientNonce === nonce && message.author.id === viewerId);
  }

  function announceModeration(message: Message): string {
    if (message.moderation?.state === "HIDDEN") return "Sent, but hidden while a person reviews it. Only you can see it.";
    if (message.moderation?.state === "FLAGGED") return "Sent. A person will check it; it stays up until then.";
    return "";
  }

  // ---- Drafts ----

  function draftFor(parentId: Id | null): ChannelDraft {
    return store.getState().drafts[draftScope(parentId)] ?? EMPTY_DRAFT;
  }

  function setDraft(parentId: Id | null, update: { body?: string; embeds?: readonly EmbedRef[] }) {
    const scope = draftScope(parentId);
    const current = draftFor(parentId);
    const draft: ChannelDraft = {
      body: (update.body ?? current.body).slice(0, 10_000),
      embeds: (update.embeds ?? current.embeds).slice(0, 5),
      updatedAt: now(),
    };
    store.setState(state => ({ ...state, drafts: { ...state.drafts, [scope]: draft } }));
    persist();
  }

  function clearDraft(parentId: Id | null) {
    const scope = draftScope(parentId);
    if (!(scope in store.getState().drafts)) return;
    store.setState(state => {
      const { [scope]: _removed, ...drafts } = state.drafts;
      return { ...state, drafts };
    });
    persist();
  }

  // ---- Sends ----

  async function post(item: OutboxItem): Promise<Message> {
    const { clientNonce } = item;
    try {
      if (globalThis.navigator?.onLine === false) throw new ApiError("network_error", 0, "The browser is offline");
      const message = await api.call(ROUTES.postMessage, {
        params: { id: channelId }, body: { body: item.body, clientNonce, parentId: item.parentId, embeds: [...item.embeds] },
      });
      channel.receive([message]);
      setOutbox(items => items.filter(entry => entry.clientNonce !== clientNonce), {
        conductRequired: false, announcement: announceModeration(message),
      });
      return message;
    } catch (error) {
      // Polling may already have shown the message this request carried.
      const landed = findLanded(clientNonce);
      if (landed) return landed;
      const failure = describeFailure(error, now());
      if (findItem(clientNonce)) {
        setOutbox(items => items.map(entry => entry.clientNonce === clientNonce ? { ...entry, status: "failed", failure } : entry), {
          announcement: failure.message, ...(failure.reason === "conduct_required" ? { conductRequired: true } : {}),
        });
      }
      throw asApiError(error);
    }
  }

  /** One request per nonce at a time; a retry while it is in flight joins it. */
  function dispatch(item: OutboxItem): Promise<Message> {
    const request = post(item);
    sending.set(item.clientNonce, request);
    const settle = () => { if (sending.get(item.clientNonce) === request) sending.delete(item.clientNonce); };
    request.then(settle, settle);
    return request;
  }

  /**
   * Post optimistically: the draft for this scope empties at once and the text
   * waits in the outbox, sending, until the server confirms it. Resolves with
   * the server's message; rejects with the API error, leaving a failed outbox
   * item to retry, restore or discard.
   */
  function send(input: SendInput): Promise<Message> {
    if (!channel.enabled) return Promise.reject(notEnabled());
    const clientNonce = newNonce();
    const parsed = PostMessage.safeParse({ body: input.body, clientNonce, parentId: input.parentId, embeds: [...input.embeds] });
    if (!parsed.success) {
      return Promise.reject(new ApiError("validation_error", 0, "Write a message of up to 10,000 characters, with at most 5 attachments.", undefined, { cause: parsed.error }));
    }
    if (store.getState().outbox.length >= MAX_STORED_SENDS) {
      return Promise.reject(new ApiError("validation_error", 0, "Too many messages are waiting to send. Send or discard some first."));
    }
    const item: OutboxItem = {
      clientNonce, channelId, parentId: parsed.data.parentId, body: parsed.data.body, embeds: parsed.data.embeds,
      createdAt: now(), status: "sending", failure: null,
    };
    const scope = draftScope(item.parentId);
    store.setState(state => {
      const { [scope]: _sent, ...drafts } = state.drafts;
      return { ...state, drafts, outbox: [...state.outbox, item], announcement: "" };
    });
    persist();
    return dispatch(item);
  }

  /** Send a failed item again with the same nonce. A send already in flight is joined, not repeated. */
  function retry(clientNonce: string): Promise<Message> {
    const item = findItem(clientNonce);
    // A failed item's request has finished, even if its promise settles a moment later.
    const inFlight = sending.get(clientNonce);
    if (inFlight && item?.status !== "failed") return inFlight;
    if (!item) return Promise.reject(new ApiError("not_found", 0, "That message is no longer waiting to send."));
    if (!channel.enabled) return Promise.reject(notEnabled());
    setOutbox(items => items.map(entry => entry.clientNonce === clientNonce ? { ...entry, status: "sending", failure: null } : entry));
    return dispatch({ ...item, status: "sending", failure: null });
  }

  /** Sends that failed only because the browser was offline go again when it is back. */
  function retryOffline(): void {
    for (const item of store.getState().outbox) {
      if (item.status === "failed" && item.failure?.reason === "offline") retry(item.clientNonce).catch(() => {});
    }
  }

  /** Drop a failed send. One still sending stays (it may already be stored). */
  function discard(clientNonce: string): boolean {
    const item = findItem(clientNonce);
    if (!item || item.status === "sending") return false;
    setOutbox(items => items.filter(entry => entry.clientNonce !== clientNonce));
    return true;
  }

  /** Put a failed send back in its (empty) draft, for example to change what moderation refused. */
  function restore(clientNonce: string): boolean {
    const item = findItem(clientNonce);
    const current = item && draftFor(item.parentId);
    if (!item || item.status === "sending" || current?.body !== "" || current.embeds.length > 0) return false;
    store.setState(state => ({
      ...state,
      drafts: { ...state.drafts, [draftScope(item.parentId)]: { body: item.body, embeds: item.embeds, updatedAt: now() } },
      outbox: state.outbox.filter(entry => entry.clientNonce !== clientNonce),
    }));
    persist();
    return true;
  }

  // ---- Edits, deletions and reactions ----

  function overlayFor(messageId: Id): MessageOverlay | null {
    const pending = changes.get(messageId);
    if (!pending?.length) return null;
    const overlay: MessageOverlay = {};
    for (const item of pending) {
      if (item.kind === "edit") overlay.body = item.body;
      else if (item.kind === "delete") overlay.deleted = true;
      else overlay.reactions = { ...overlay.reactions, [item.reaction]: item.active };
    }
    return overlay;
  }

  function showChanges(messageId: Id) {
    channel.setOverlay(messageId, overlayFor(messageId));
    const busy = [...changes.keys()];
    const previous = store.getState().busy;
    if (busy.length !== previous.length || busy.some((id, i) => id !== previous[i])) patch({ busy });
  }

  /**
   * Show a change at once and send it after earlier changes to the same message,
   * so the server applies them in the order the reader made them. On success the
   * server's copy replaces the cached one; on failure only this change is undone.
   */
  function change<T>(messageId: Id, entry: Change, request: () => Promise<T>, confirm: (result: T) => void, noun: string): Promise<T> {
    if (!channel.enabled) return Promise.reject(notEnabled());
    changes.set(messageId, [...changes.get(messageId) ?? [], entry]);
    showChanges(messageId);
    const run = (queues.get(messageId) ?? Promise.resolve()).then(request).then(
      result => {
        confirm(result);
        if (store.getState().conductRequired) patch({ conductRequired: false });
        return result;
      },
      (error: unknown) => {
        const failure = describeFailure(error, now(), true);
        patch({
          announcement: `${noun} ${failure.message}`,
          ...(failure.reason === "conduct_required" ? { conductRequired: true } : {}),
        });
        throw asApiError(error);
      },
    ).finally(() => {
      const remaining = (changes.get(messageId) ?? []).filter(pending => pending !== entry);
      if (remaining.length > 0) changes.set(messageId, remaining);
      else changes.delete(messageId);
      showChanges(messageId);
    });
    const settled = run.then(() => undefined, () => undefined);
    queues.set(messageId, settled);
    void settled.finally(() => { if (queues.get(messageId) === settled) queues.delete(messageId); });
    return run;
  }

  function edit(messageId: Id, body: string): Promise<Message> {
    const parsed = EditMessage.safeParse({ body });
    if (!parsed.success) {
      return Promise.reject(new ApiError("validation_error", 0, "Write a message of up to 10,000 characters.", undefined, { cause: parsed.error }));
    }
    return change(messageId, { kind: "edit", body: parsed.data.body },
      () => api.call(ROUTES.editMessage, { params: { id: messageId }, body: parsed.data }),
      message => channel.update([message]), "Your edit wasn't saved.");
  }

  function remove(messageId: Id): Promise<Message> {
    return change(messageId, { kind: "delete" },
      () => api.call(ROUTES.deleteMessage, { params: { id: messageId } }),
      message => channel.update([message]), "Your message wasn't deleted.");
  }

  /** Set (never toggle) the reader's reaction, so a retried request cannot reverse it. */
  async function react(messageId: Id, kind: ReactionKind, active: boolean): Promise<void> {
    await change(messageId, { kind: "react", reaction: kind, active },
      () => api.call(ROUTES.reactToMessage, { params: { id: messageId }, body: { kind, active } }),
      ({ reactions }: MessageReactions) => {
        const cached = channel.peek(messageId);
        if (cached) channel.update([{ ...cached, reactions }]);
      }, "Your reaction wasn't saved.");
  }

  // ---- Lifecycle ----

  const onOnline = () => retryOffline();

  return {
    ...store,
    channelId,
    /** The channel store this composer writes to. */
    channel,
    viewerId,
    /** `@tembo` is offered only while `tembo_channels` is on for the reader. */
    offersTembo,
    send,
    retry,
    retryOffline,
    discard,
    restore,
    edit,
    remove,
    react,
    setDraft,
    clearDraft,
    draft: draftFor,
    /** Who `@` can reach in this channel, or in one of its threads. */
    mentionCandidates(forChannel: Id, threadId: Id | null = null): MentionCandidates {
      if (forChannel !== channelId) return { tembo: offersTembo, people: [] };
      return { tembo: offersTembo, people: selectMentionPeople(channel.getState(), threadId, viewerId) };
    },
    /**
     * Reference-counted, from hooks: the first retain loads drafts and starts
     * matching polled messages to unconfirmed sends. Sends in flight are not
     * aborted on release; their nonce makes them safe to finish.
     */
    retain() {
      if (retains++ === 0) {
        hydrate();
        unsubscribe = channel.subscribe(() => reconcile(channel.getState()));
        globalThis.addEventListener?.("online", onOnline);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--retains > 0) return;
        unsubscribe?.();
        unsubscribe = undefined;
        globalThis.removeEventListener?.("online", onOnline);
      };
    },
    clearAnnouncement() { patch({ announcement: "" }); },
  };
}
export type Composer = ReturnType<typeof createComposer>;

/** Unconfirmed sends for the channel (`parentId` null) or one thread. */
export const selectOutbox = (parentId: Id | null) => (state: ComposerState) =>
  state.outbox.filter(item => item.parentId === parentId);
export const selectDraft = (parentId: Id | null) => (state: ComposerState) =>
  state.drafts[draftScope(parentId)] ?? EMPTY_DRAFT;
export const selectBusy = (messageId: Id) => (state: ComposerState) => state.busy.includes(messageId);
