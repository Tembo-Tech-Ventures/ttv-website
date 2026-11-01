import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientNonce, type EmbedRef, type Message, type MessageList, type PostMessage } from "../contracts";
import { messages, people, temboAuthor } from "../fixtures";
import { ApiError, createApiClient } from "./apiClient";
import { createChannelStore, type ChannelStore } from "./channel";
import { channelDraftKey, CHANNEL_DRAFT_PREFIX, MAX_STORED_SENDS, type DraftStorage } from "./channel-drafts";
import {
  createComposer, createNonce, describeFailure, MAX_MENTION_PEOPLE, selectBusy, selectDraft, selectMentionPeople, selectOutbox,
  type ComposerOptions,
} from "./composer";
import { createMockTransport, type MockReply } from "./mockTransport";

const CHANNEL = "channel-1";
const VIEWER = "viewer";
const viewer = { ...people.wanjiku, id: VIEWER };
const msg = (n: number, overrides: Partial<Message> = {}): Message => ({
  ...messages.projectPost, id: `m${String(n).padStart(4, "0")}`, channelId: CHANNEL, parentId: null, createdAt: n * 1_000,
  clientNonce: null, author: { ...messages.projectPost.author, id: "author" }, reactions: [], edited: false, ...overrides,
});
const page = (items: Message[], sinceCursor: string, extra: Partial<MessageList> = {}): MessageList =>
  ({ items, beforeCursor: null, sinceCursor, thread: null, removedIds: [], ...extra });
const refusal = (status: number, code: string, retryAfterMs?: number): MockReply =>
  ({ status, data: { error: { code, message: "Synthetic refusal", ...(retryAfterMs === undefined ? {} : { retryAfterMs }) } } });
const flush = () => new Promise(resolve => { setTimeout(resolve, 0); });
const signal = () => new AbortController().signal;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

/** sessionStorage stand-in that records writes. */
function memoryStorage(initial: Record<string, string> = {}): DraftStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

type Next = () => Promise<MockReply>;
type Intercept = (request: { body: unknown; params: Record<string, string> }, next: Next) => MockReply | Promise<MockReply>;

/**
 * A small channel server: posts are idempotent on (author, nonce), edits and
 * deletions change stored messages, reactions are sets. Each route can be
 * intercepted once per queued handler, for example to refuse or to lose a response.
 */
function backend(seed: Message[] = []) {
  const byId = new Map(seed.map(item => [item.id, item]));
  const byNonce = new Map<string, Message>();
  const intercepts: Record<string, Intercept[]> = { post: [], edit: [], delete: [], react: [], list: [] };
  const calls: { route: string; body: unknown }[] = [];
  let sequence = 0;

  async function handle(route: string, request: Request, params: Record<string, string>, base: (body: unknown) => MockReply): Promise<MockReply> {
    const text = await request.text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    calls.push({ route, body });
    const next = async () => base(body);
    const intercept = intercepts[route].shift();
    return intercept ? intercept({ body, params }, next) : next();
  }

  const api = createApiClient({ retry: { maxRetries: 0 }, fetch: createMockTransport([
    { method: "GET", path: "/api/channels/:id/messages", reply: ({ request, params }) =>
      handle("list", request, params, () => ({ data: page([], "s-empty") })) },
    { method: "POST", path: "/api/channels/:id/messages", reply: ({ request, params }) => handle("post", request, params, raw => {
      const body = raw as PostMessage;
      const replay = byNonce.get(body.clientNonce);
      if (replay) return { data: byId.get(replay.id) };
      const message = msg(1_000 + ++sequence, {
        id: `posted-${sequence}`, channelId: params.id, parentId: body.parentId, body: body.body, clientNonce: body.clientNonce,
        author: viewer, embeds: [],
      });
      byNonce.set(body.clientNonce, message);
      byId.set(message.id, message);
      return { data: message };
    }) },
    { method: "PATCH", path: "/api/messages/:id", reply: ({ request, params }) => handle("edit", request, params, raw => {
      const found = byId.get(params.id);
      if (!found) return refusal(404, "not_found");
      const message = { ...found, body: (raw as { body: string }).body, edited: true };
      byId.set(message.id, message);
      return { data: message };
    }) },
    { method: "DELETE", path: "/api/messages/:id", reply: ({ request, params }) => handle("delete", request, params, () => {
      const found = byId.get(params.id);
      if (!found) return refusal(404, "not_found");
      if (found.deleted) return refusal(409, "conflict");
      const message = { ...found, body: "", embeds: [], citations: [], reactions: [], deleted: true };
      byId.set(message.id, message);
      return { data: message };
    }) },
    { method: "POST", path: "/api/messages/:id/reactions", reply: ({ request, params }) => handle("react", request, params, raw => {
      const found = byId.get(params.id);
      if (!found) return refusal(404, "not_found");
      const { kind, active } = raw as { kind: "useful"; active: boolean };
      const others = found.reactions.find(reaction => reaction.kind === kind)?.count ?? 0;
      const mine = found.reactions.find(reaction => reaction.kind === kind)?.mine ?? false;
      const count = others - (mine ? 1 : 0) + (active ? 1 : 0);
      const reactions = [...found.reactions.filter(reaction => reaction.kind !== kind), ...(count > 0 ? [{ kind, count, mine: active }] : [])];
      byId.set(found.id, { ...found, reactions });
      return { data: { messageId: found.id, reactions } };
    }) },
  ]) });
  return {
    api, calls, byId, byNonce,
    intercept(route: keyof typeof intercepts, ...handlers: Intercept[]) { intercepts[route].push(...handlers); },
    count: (route: string) => calls.filter(call => call.route === route).length,
  };
}

interface Setup { seed?: Message[]; options?: Partial<ComposerOptions>; channel?: Partial<Parameters<typeof createChannelStore>[0]>; retain?: boolean }
function setup({ seed = [msg(1), msg(2)], options = {}, channel: channelOptions = {}, retain = true }: Setup = {}) {
  const server = backend(seed);
  const storage = memoryStorage();
  const channel: ChannelStore = createChannelStore({
    channelId: CHANNEL, enabled: true, api: server.api, viewerId: VIEWER, initial: page(seed, "s0"), ...channelOptions,
  });
  let nonce = 0;
  const composer = createComposer({
    store: channel, me: { user: { id: VIEWER }, flags: { tembo_channels: false } }, api: server.api, storage,
    now: () => 50_000, newNonce: () => `nonce-${++nonce}`, ...options,
  });
  const releaseChannel = channel.retain();
  const release = retain ? composer.retain() : () => {};
  return { server, storage, channel, composer, release, releaseChannel };
}
const stored = (storage: DraftStorage) => JSON.parse(storage.getItem(channelDraftKey(VIEWER, CHANNEL)) ?? "null") as
  { drafts: Record<string, { body: string }>; sends: { clientNonce: string; body: string }[] } | null;
const body = (channel: ChannelStore, id: string) => channel.getState().messages.find(item => item.id === id);

afterEach(() => { vi.unstubAllGlobals(); });

describe("composer drafts", () => {
  it("touches no storage until a hook retains it, and SSR keeps the empty snapshot", () => {
    const storage = memoryStorage({ [channelDraftKey(VIEWER, CHANNEL)]: JSON.stringify({ drafts: { root: { body: "hello", embeds: [], updatedAt: 1 } }, sends: [] }) });
    const getItem = vi.spyOn(storage, "getItem");
    const { composer } = setup({ options: { storage }, retain: false });
    expect(getItem).not.toHaveBeenCalled();
    expect(composer.draft(null).body).toBe("");
    const release = composer.retain();
    expect(composer.draft(null).body).toBe("hello");
    expect(composer.getServerSnapshot().drafts).toEqual({});
    release();
  });

  it("keeps one draft per channel and per thread, bounded, in this user's key", () => {
    const { composer, storage } = setup();
    composer.setDraft(null, { body: "In the channel" });
    composer.setDraft("m0001", { body: "In the thread", embeds: [{ type: "project", journeyId: "j1", version: 1 }] });
    composer.setDraft(null, { body: "x".repeat(10_050) });
    expect(selectDraft(null)(composer.getState()).body).toHaveLength(10_000);
    expect(composer.draft("m0001")).toMatchObject({ body: "In the thread", embeds: [{ journeyId: "j1" }] });
    expect(stored(storage)?.drafts).toMatchObject({ root: { body: "x".repeat(10_000) }, "thread:m0001": { body: "In the thread" } });
    composer.clearDraft("m0001");
    composer.clearDraft("m0001");
    expect(stored(storage)?.drafts).not.toHaveProperty("thread:m0001");
    composer.clearDraft(null);
    expect(storage.data.size).toBe(0);
  });

  it("removes other accounts' drafts when this person's composer loads", () => {
    const other = `${CHANNEL_DRAFT_PREFIX}someone-else:${CHANNEL}`;
    const storage = memoryStorage({ [other]: "{}", unrelated: "keep" });
    setup({ options: { storage } });
    expect(storage.data.has(other)).toBe(false);
    expect(storage.data.get("unrelated")).toBe("keep");
  });

  it("works in memory without storage", async () => {
    const { composer } = setup({ options: { storage: undefined }, retain: false });
    vi.stubGlobal("window", undefined);
    const release = composer.retain();
    composer.setDraft(null, { body: "Only in memory" });
    expect(composer.draft(null).body).toBe("Only in memory");
    await composer.send({ body: "Only in memory", parentId: null, embeds: [] });
    release();
  });

  it("text typed before the drafts loaded wins over stored text", () => {
    const storage = memoryStorage({ [channelDraftKey(VIEWER, CHANNEL)]: JSON.stringify({ drafts: { root: { body: "stored", embeds: [], updatedAt: 1 } }, sends: [] }) });
    const { composer } = setup({ options: { storage }, retain: false });
    composer.setDraft(null, { body: "typed" });
    expect(storage.data.get(channelDraftKey(VIEWER, CHANNEL))).toContain("stored");
    const release = composer.retain();
    expect(composer.draft(null).body).toBe("typed");
    expect(stored(storage)?.drafts.root.body).toBe("typed");
    release();
  });
});

describe("optimistic sends", () => {
  it("empties the draft at once, shows the send, and reconciles with the server echo", async () => {
    const { composer, channel, server, storage } = setup();
    composer.setDraft(null, { body: "Habari, I pushed the fix" });
    const sent = composer.send({ body: "Habari, I pushed the fix", parentId: null, embeds: [] });
    expect(composer.draft(null).body).toBe("");
    expect(selectOutbox(null)(composer.getState())).toMatchObject([{ clientNonce: "nonce-1", status: "sending", body: "Habari, I pushed the fix" }]);
    expect(stored(storage)?.sends).toMatchObject([{ clientNonce: "nonce-1" }]);
    const message = await sent;
    expect(message).toMatchObject({ id: "posted-1", clientNonce: "nonce-1" });
    expect(composer.getState().outbox).toEqual([]);
    expect(channel.getState().messages.at(-1)?.id).toBe("posted-1");
    expect(storage.data.size).toBe(0);
    expect(server.calls.at(-1)).toMatchObject({ route: "post", body: { clientNonce: "nonce-1", parentId: null, embeds: [] } });
    expect(composer.getState().announcement).toBe("");
  });

  it("sends a reply into the open thread, with its embeds, and keeps the channel draft", async () => {
    const parent = msg(1, { thread: { replyCount: 0, participantIds: [], lastReplyAt: null } });
    const { composer, channel, server } = setup({ seed: [parent] });
    server.intercept("list", () => ({ data: page([], "t0", { thread: parent.id }) }));
    await channel.openThread(parent.id);
    composer.setDraft(null, { body: "Unrelated channel draft" });
    const embeds: EmbedRef[] = [{ type: "project", journeyId: "j1", version: 2 }];
    const sent = composer.send({ body: "A reply", parentId: parent.id, embeds });
    expect(selectOutbox(parent.id)(composer.getState())).toHaveLength(1);
    expect(selectOutbox(null)(composer.getState())).toHaveLength(0);
    await sent;
    expect(channel.getState().thread?.messages.map(item => item.id)).toEqual(["posted-1"]);
    expect(channel.getState().messages.map(item => item.id)).toEqual([parent.id]);
    expect(composer.draft(null).body).toBe("Unrelated channel draft");
    expect(server.calls.at(-1)?.body).toMatchObject({ parentId: parent.id, embeds });
  });

  it.each([
    ["FLAGGED", "Sent. A person will check it; it stays up until then."],
    ["HIDDEN", "Sent, but hidden while a person reviews it. Only you can see it."],
  ] as const)("keeps a %s echo, with the author's moderation state, and says what happens next", async (state, announcement) => {
    const { composer, channel, server } = setup();
    server.intercept("post", async (_request, next) => {
      const reply = await next();
      return { data: { ...(reply.data as Message), moderation: { state, reasons: ["Contact details"] } } };
    });
    const message = await composer.send({ body: "Call me on 0712 345 678", parentId: null, embeds: [] });
    expect(message.moderation?.state).toBe(state);
    expect(channel.getState().messages.at(-1)?.moderation).toEqual({ state, reasons: ["Contact details"] });
    expect(composer.getState()).toMatchObject({ outbox: [], announcement });
    composer.clearAnnouncement();
    expect(composer.getState().announcement).toBe("");
  });

  it("refused by moderation: fails without retry, and the text can go back into the draft", async () => {
    const { composer, server, storage } = setup();
    server.intercept("post", () => refusal(422, "moderation_rejected"));
    await expect(composer.send({ body: "Refused text", parentId: null, embeds: [] })).rejects.toMatchObject({ code: "moderation_rejected" });
    const [item] = composer.getState().outbox;
    expect(item).toMatchObject({ status: "failed", failure: { reason: "moderation_rejected", retryable: false } });
    expect(composer.getState().announcement).toBe("This can't be posted as written. Change it and send it again.");
    expect(stored(storage)?.sends).toHaveLength(1);
    composer.setDraft(null, { body: "Something new" });
    expect(composer.restore(item.clientNonce)).toBe(false);
    composer.clearDraft(null);
    expect(composer.restore(item.clientNonce)).toBe(true);
    expect(composer.draft(null).body).toBe("Refused text");
    expect(composer.getState().outbox).toEqual([]);
    expect(composer.restore(item.clientNonce)).toBe(false);
  });

  it("rate limited: shows when to try again and retries only when asked, with the same nonce", async () => {
    const { composer, server } = setup();
    server.intercept("post", () => refusal(429, "rate_limited", 12_000));
    await expect(composer.send({ body: "Quick one", parentId: null, embeds: [] })).rejects.toMatchObject({ status: 429 });
    expect(composer.getState().outbox[0].failure).toMatchObject({
      reason: "rate_limited", retryable: true, retryAt: 62_000, message: "You're sending quickly. Try again in 12 seconds.",
    });
    expect(server.count("post")).toBe(1);
    await composer.retry("nonce-1");
    expect(server.calls.filter(call => call.route === "post").map(call => (call.body as PostMessage).clientNonce)).toEqual(["nonce-1", "nonce-1"]);
    expect(composer.getState().outbox).toEqual([]);
  });

  it("conduct not agreed: flags the gate, and the next confirmed write clears it", async () => {
    const { composer, server } = setup();
    server.intercept("post", () => refusal(403, "conduct_required"));
    await expect(composer.send({ body: "First post", parentId: null, embeds: [] })).rejects.toMatchObject({ code: "conduct_required" });
    expect(composer.getState()).toMatchObject({ conductRequired: true, outbox: [{ failure: { reason: "conduct_required", retryable: true } }] });
    await composer.retry("nonce-1");
    expect(composer.getState().conductRequired).toBe(false);
  });

  it("retrying after a lost response stores the message once (nonce dedupe)", async () => {
    const { composer, channel, server } = setup();
    // The server stores the post, but the response never arrives.
    server.intercept("post", async (_request, next) => { await next(); throw new TypeError("connection reset"); });
    await expect(composer.send({ body: "Once only", parentId: null, embeds: [] })).rejects.toMatchObject({ code: "network_error" });
    expect(composer.getState().outbox[0].failure?.reason).toBe("offline");
    expect(server.byNonce.size).toBe(1);
    const first = composer.retry("nonce-1");
    const second = composer.retry("nonce-1");
    expect(second).toBe(first);
    const message = await first;
    expect(server.count("post")).toBe(2);
    expect(server.byNonce.size).toBe(1);
    expect(message.id).toBe("posted-1");
    expect(channel.getState().messages.filter(item => item.clientNonce === "nonce-1")).toHaveLength(1);
    // Polling returns the same message again; ids deduplicate.
    server.intercept("list", () => ({ data: page([message], "s1") }));
    await channel.poll(signal());
    expect(channel.getState().messages.filter(item => item.id === message.id)).toHaveLength(1);
    await expect(composer.retry("nonce-1")).rejects.toMatchObject({ code: "not_found" });
  });

  it("a send whose response is lost is confirmed when polling shows it", async () => {
    const { composer, channel, server } = setup();
    const gate = deferred();
    server.intercept("post", async (_request, next) => {
      await next();
      await gate.promise;
      throw new TypeError("connection reset");
    });
    const sent = composer.send({ body: "Seen by polling", parentId: null, embeds: [] });
    await flush();
    server.intercept("list", () => ({ data: page([server.byNonce.get("nonce-1")!], "s1") }));
    await channel.poll(signal());
    expect(composer.getState().outbox).toEqual([]);
    gate.resolve();
    await expect(sent).resolves.toMatchObject({ clientNonce: "nonce-1" });
    expect(composer.getState().outbox).toEqual([]);
  });

  it("restores unconfirmed sends from an earlier page as not sent, and polling confirms ones that landed", async () => {
    const storage = memoryStorage({
      [channelDraftKey(VIEWER, CHANNEL)]: JSON.stringify({ drafts: {}, sends: [
        { clientNonce: "old-1", parentId: null, body: "Landed before the reload", embeds: [], createdAt: 1 },
        { clientNonce: "old-2", parentId: null, body: "Never arrived", embeds: [], createdAt: 2 },
      ] }),
    });
    const { composer, channel, server } = setup({ options: { storage } });
    expect(composer.getState().outbox).toMatchObject([
      { clientNonce: "old-1", status: "failed", failure: { reason: "interrupted", retryable: true } },
      { clientNonce: "old-2", status: "failed" },
    ]);
    server.intercept("list", () => ({ data: page([msg(3, { clientNonce: "old-1", author: viewer })], "s1") }));
    await channel.poll(signal());
    expect(composer.getState().outbox.map(item => item.clientNonce)).toEqual(["old-2"]);
    // Someone else's message with the same nonce string is not ours.
    server.intercept("list", () => ({ data: page([msg(4, { clientNonce: "old-2" })], "s2") }));
    await channel.poll(signal());
    expect(composer.getState().outbox.map(item => item.clientNonce)).toEqual(["old-2"]);
    expect(composer.discard("old-2")).toBe(true);
    expect(composer.discard("old-2")).toBe(false);
    expect(storage.data.size).toBe(0);
  });

  it("offline: fails without a request, then sends when the browser is back online", async () => {
    const events = new EventTarget();
    vi.stubGlobal("addEventListener", events.addEventListener.bind(events));
    vi.stubGlobal("removeEventListener", events.removeEventListener.bind(events));
    vi.stubGlobal("dispatchEvent", events.dispatchEvent.bind(events));
    const { composer, server, release } = setup();
    vi.stubGlobal("navigator", { onLine: false });
    await expect(composer.send({ body: "On the matatu", parentId: null, embeds: [] })).rejects.toMatchObject({ code: "network_error" });
    expect(server.count("post")).toBe(0);
    expect(composer.getState().outbox[0]).toMatchObject({ status: "failed", failure: { reason: "offline" } });
    expect(composer.discard("missing")).toBe(false);
    vi.stubGlobal("navigator", { onLine: true });
    globalThis.dispatchEvent(new Event("online"));
    expect(composer.getState().outbox[0].status).toBe("sending");
    expect(composer.discard("nonce-1")).toBe(false);
    await vi.waitFor(() => expect(composer.getState().outbox).toEqual([]));
    expect(server.count("post")).toBe(1);
    // After the last release, coming back online does nothing.
    release();
    vi.stubGlobal("navigator", { onLine: false });
    await composer.send({ body: "Later", parentId: null, embeds: [] }).catch(() => {});
    vi.stubGlobal("navigator", { onLine: true });
    globalThis.dispatchEvent(new Event("online"));
    await flush();
    expect(composer.getState().outbox[0].status).toBe("failed");
  });

  it("only offline failures are retried automatically", async () => {
    const { composer, server } = setup();
    server.intercept("post", () => refusal(500, "server"));
    await composer.send({ body: "Server trouble", parentId: null, embeds: [] }).catch(() => {});
    composer.retryOffline();
    expect(server.count("post")).toBe(1);
    expect(composer.getState().outbox[0].failure).toMatchObject({ reason: "server", retryable: true });
  });

  it("validates before anything is shown, bounds the outbox and does nothing while channels are off", async () => {
    const { composer, server } = setup();
    await expect(composer.send({ body: "   ", parentId: null, embeds: [] })).rejects.toMatchObject({ code: "validation_error" });
    await expect(composer.send({ body: "x".repeat(10_001), parentId: null, embeds: [] })).rejects.toMatchObject({ code: "validation_error" });
    expect(composer.getState().outbox).toEqual([]);
    server.intercept("post", ...Array.from({ length: MAX_STORED_SENDS }, () => () => refusal(500, "server")));
    for (let i = 0; i < MAX_STORED_SENDS; i++) await composer.send({ body: `Message ${i}`, parentId: null, embeds: [] }).catch(() => {});
    await expect(composer.send({ body: "One too many", parentId: null, embeds: [] })).rejects.toThrow("Too many messages");

    const off = setup({ channel: { enabled: false } });
    await expect(off.composer.send({ body: "Hi", parentId: null, embeds: [] })).rejects.toMatchObject({ code: "flag_off" });
    await expect(off.composer.retry("nonce-1")).rejects.toMatchObject({ code: "not_found" });
    await expect(off.composer.edit("m0001", "x")).rejects.toMatchObject({ code: "flag_off" });
    expect(off.server.calls).toEqual([]);
  });

  it("retry of a stored send is refused while channels are off", async () => {
    const storage = memoryStorage({
      [channelDraftKey(VIEWER, CHANNEL)]: JSON.stringify({ drafts: {}, sends: [{ clientNonce: "old-1", parentId: null, body: "Stored", embeds: [], createdAt: 1 }] }),
    });
    const { composer, server } = setup({ options: { storage }, channel: { enabled: false } });
    await expect(composer.retry("old-1")).rejects.toMatchObject({ code: "flag_off" });
    expect(server.calls).toEqual([]);
  });
});

describe("edits and deletions", () => {
  it("shows an edit at once, confirms it, and marks the message busy meanwhile", async () => {
    const { composer, channel, server } = setup({ seed: [msg(1, { author: viewer })] });
    const gate = deferred();
    server.intercept("edit", async (_request, next) => { await gate.promise; return next(); });
    const editing = composer.edit("m0001", "Fixed typo");
    expect(body(channel, "m0001")).toMatchObject({ body: "Fixed typo", edited: true });
    expect(selectBusy("m0001")(composer.getState())).toBe(true);
    gate.resolve();
    await editing;
    expect(body(channel, "m0001")).toMatchObject({ body: "Fixed typo", edited: true });
    expect(channel.peek("m0001")?.body).toBe("Fixed typo");
    expect(composer.getState().busy).toEqual([]);
  });

  it("rolls a failed edit back to server truth, keeping changes polling brought meanwhile", async () => {
    const { composer, channel, server } = setup({ seed: [msg(1, { author: viewer })] });
    const gate = deferred();
    server.intercept("edit", async () => { await gate.promise; return refusal(409, "conflict"); });
    const editing = composer.edit("m0001", "My edit");
    server.intercept("list", () => ({ data: page([msg(1, { author: viewer, reactions: [{ kind: "thanks", count: 2, mine: false }] })], "s1") }));
    await channel.poll(signal());
    expect(body(channel, "m0001")).toMatchObject({ body: "My edit", reactions: [{ kind: "thanks", count: 2 }] });
    gate.resolve();
    await expect(editing).rejects.toMatchObject({ code: "conflict" });
    expect(body(channel, "m0001")).toMatchObject({ body: messages.projectPost.body, edited: false, reactions: [{ kind: "thanks", count: 2 }] });
    expect(composer.getState().announcement).toBe("Your edit wasn't saved. That message has changed or is no longer here.");
  });

  it("sends an edit then a deletion in order, never overlapping, and ends deleted", async () => {
    const { composer, channel, server } = setup({ seed: [msg(1, { author: viewer })] });
    const gate = deferred();
    let editDone = false;
    server.intercept("edit", async (_request, next) => { await gate.promise; editDone = true; return next(); });
    server.intercept("delete", async (_request, next) => { expect(editDone).toBe(true); return next(); });
    const editing = composer.edit("m0001", "Edited first");
    const deleting = composer.remove("m0001");
    expect(body(channel, "m0001")).toMatchObject({ deleted: true, body: "" });
    await flush();
    expect(server.count("delete")).toBe(0);
    gate.resolve();
    await Promise.all([editing, deleting]);
    expect(server.calls.map(call => call.route)).toEqual(["edit", "delete"]);
    expect(body(channel, "m0001")).toMatchObject({ deleted: true, body: "" });
    expect(composer.getState().busy).toEqual([]);
  });

  it("a poll that started before a deletion was confirmed cannot bring the old copy back", async () => {
    const { composer, channel, server } = setup({ seed: [msg(1, { author: viewer }), msg(2)] });
    const stale = deferred<MockReply>();
    server.intercept("list", () => stale.promise);
    const polling = channel.poll(signal());
    await flush();
    await composer.remove("m0001");
    expect(body(channel, "m0001")?.deleted).toBe(true);
    stale.resolve({ data: page([msg(1, { author: viewer }), msg(2, { body: "Edited by its author" })], "s1") });
    await polling;
    expect(body(channel, "m0001")?.deleted).toBe(true);
    expect(body(channel, "m0002")?.body).toBe("Edited by its author");
    // A poll that starts after the confirmation is server truth again.
    server.intercept("list", () => ({ data: page([msg(1, { author: viewer, body: "", embeds: [], deleted: true, edited: true })], "s2") }));
    await channel.poll(signal());
    expect(body(channel, "m0001")).toMatchObject({ deleted: true, edited: true });
  });

  it("a confirmation never brings back a message polling removed", async () => {
    const { composer, channel, server } = setup({ seed: [msg(1, { author: viewer }), msg(2)] });
    const gate = deferred();
    server.intercept("edit", async (_request, next) => { await gate.promise; return next(); });
    const editing = composer.edit("m0001", "Too late");
    server.intercept("list", () => ({ data: page([], "s1", { removedIds: ["m0001"] }) }));
    await channel.poll(signal());
    expect(body(channel, "m0001")).toBeUndefined();
    gate.resolve();
    await editing;
    expect(body(channel, "m0001")).toBeUndefined();
    expect(channel.peek("m0001")).toBeUndefined();
  });

  it("deleting something already deleted, or not cached, rolls back cleanly", async () => {
    const { composer, channel } = setup({ seed: [msg(1, { author: viewer, deleted: true, body: "", embeds: [] })] });
    await expect(composer.remove("m0001")).rejects.toMatchObject({ status: 409 });
    expect(body(channel, "m0001")?.deleted).toBe(true);
    await expect(composer.remove("missing")).rejects.toMatchObject({ status: 404 });
    expect(composer.getState()).toMatchObject({ busy: [], announcement: "Your message wasn't deleted. That message has changed or is no longer here." });
    await expect(composer.edit("m0001", "  ")).rejects.toMatchObject({ code: "validation_error" });
  });

  it("an edit refused for the code of conduct raises the gate", async () => {
    const { composer, server } = setup({ seed: [msg(1, { author: viewer })] });
    server.intercept("edit", () => refusal(403, "conduct_required"));
    await expect(composer.edit("m0001", "Changed")).rejects.toMatchObject({ code: "conduct_required" });
    expect(composer.getState().conductRequired).toBe(true);
    await composer.edit("m0001", "Changed");
    expect(composer.getState().conductRequired).toBe(false);
  });
});

describe("reactions", () => {
  it("is optimistic, sets rather than toggles, and takes the server's counts", async () => {
    const { composer, channel, server } = setup({ seed: [msg(1, { reactions: [{ kind: "useful", count: 2, mine: false }] })] });
    const reacting = composer.react("m0001", "useful", true);
    expect(body(channel, "m0001")?.reactions).toEqual([{ kind: "useful", count: 3, mine: true }]);
    await reacting;
    expect(server.calls.at(-1)?.body).toEqual({ kind: "useful", active: true });
    expect(channel.peek("m0001")?.reactions).toEqual([{ kind: "useful", count: 3, mine: true }]);
    await composer.react("m0001", "useful", false);
    expect(body(channel, "m0001")?.reactions).toEqual([{ kind: "useful", count: 2, mine: false }]);
    await composer.react("m0001", "thanks", true);
    expect(body(channel, "m0001")?.reactions).toContainEqual({ kind: "thanks", count: 1, mine: true });
  });

  it("rolls back only the failed reaction", async () => {
    const { composer, channel, server } = setup({ seed: [msg(1)] });
    const gate = deferred();
    server.intercept("react", async () => { await gate.promise; return refusal(429, "rate_limited"); });
    const failing = composer.react("m0001", "useful", true);
    const succeeding = composer.react("m0001", "learned", true);
    expect(body(channel, "m0001")?.reactions).toEqual([{ kind: "useful", count: 1, mine: true }, { kind: "learned", count: 1, mine: true }]);
    gate.resolve();
    await expect(failing).rejects.toMatchObject({ status: 429 });
    await succeeding;
    expect(body(channel, "m0001")?.reactions).toEqual([{ kind: "learned", count: 1, mine: true }]);
    expect(composer.getState().announcement).toBe("Your reaction wasn't saved. You're sending quickly. Try again in a moment.");
  });

  it("quick on-off-on reaches the server in order and ends on", async () => {
    const { composer, channel, server } = setup({ seed: [msg(1)] });
    await Promise.all([
      composer.react("m0001", "agree", true), composer.react("m0001", "agree", false), composer.react("m0001", "agree", true),
    ]);
    expect(server.calls.filter(call => call.route === "react").map(call => (call.body as { active: boolean }).active)).toEqual([true, false, true]);
    expect(body(channel, "m0001")?.reactions).toEqual([{ kind: "agree", count: 1, mine: true }]);
  });

  it("a reaction to a message that left the cache is confirmed without restoring it", async () => {
    const { composer, channel, server } = setup({ seed: [msg(1), msg(2)] });
    server.intercept("react", async (_request, next) => {
      server.intercept("list", () => ({ data: page([], "s1", { removedIds: ["m0001"] }) }));
      await channel.poll(signal());
      return next();
    });
    await composer.react("m0001", "useful", true);
    expect(body(channel, "m0001")).toBeUndefined();
  });
});

describe("mention candidates", () => {
  const tembo = { ...messages.communityAnswer, channelId: CHANNEL, id: "t1", parentId: null, createdAt: 9_000, author: temboAuthor };
  const seed = [
    msg(1, { author: people.david }), msg(2, { author: people.achieng }), msg(3, { author: viewer }),
    msg(4, { author: { ...people.brian, id: null } }), msg(5, { author: people.david }), tembo,
  ];

  it("offers people in the conversation, newest first, never the reader, Tembo or deleted accounts", () => {
    const { composer } = setup({ seed });
    expect(composer.mentionCandidates(CHANNEL)).toEqual({ tembo: false, people: [people.david, people.achieng] });
    expect(composer.mentionCandidates("another-channel")).toEqual({ tembo: false, people: [] });
  });

  it("offers @tembo only while tembo_channels is on", () => {
    const on = setup({ seed, options: { me: { user: { id: VIEWER }, flags: { tembo_channels: true } } } });
    expect(on.composer.mentionCandidates(CHANNEL).tembo).toBe(true);
    expect(on.composer.mentionCandidates("another-channel").tembo).toBe(true);
    const missing = setup({ seed, options: { me: { user: { id: VIEWER }, flags: {} } } });
    expect(missing.composer.mentionCandidates(CHANNEL).tembo).toBe(false);
  });

  it("puts the open thread's repliers and author first", async () => {
    const parent = msg(1, { author: people.joseph });
    const { composer, channel, server } = setup({ seed: [parent, msg(2, { author: people.david })] });
    server.intercept("list", () => ({ data: page([msg(10, { parentId: parent.id, author: people.kevin })], "t1", { thread: parent.id }) }));
    await channel.openThread(parent.id);
    expect(composer.mentionCandidates(CHANNEL, parent.id).people).toEqual([people.kevin, people.joseph, people.david]);
    expect(composer.mentionCandidates(CHANNEL, "other-thread").people).toEqual([people.david, people.joseph]);
  });
});

describe("describeFailure", () => {
  const at = (status: number, code: string, change = false, retryAfterMs?: number) =>
    describeFailure(new ApiError(code, status, "x", retryAfterMs), 1_000, change);

  it.each([
    [0, "network_error", false, "offline", true],
    [0, "aborted", false, "offline", true],
    [0, "validation_error", false, "invalid", false],
    [400, "validation", false, "invalid", false],
    [401, "unauthorized", false, "signed_out", true],
    [403, "forbidden", false, "forbidden", false],
    [403, "conduct_required", false, "conduct_required", true],
    [404, "flag_off", true, "unavailable", false],
    [404, "not_found", false, "unavailable", false],
    [404, "not_found", true, "gone", false],
    [409, "conflict", true, "gone", false],
    [409, "conflict", false, "invalid", false],
    [422, "moderation_rejected", false, "moderation_rejected", false],
    [500, "server", false, "server", true],
    [200, "invalid_response", false, "server", true],
  ] as const)("%i %s (change: %s) is %s", (status, code, change, reason, retryable) => {
    expect(at(status, code, change)).toMatchObject({ reason, retryable, retryAt: null });
  });

  it("words rate limits with and without a wait, and wraps unknown errors", () => {
    expect(at(429, "rate_limited", false, 1_000)).toMatchObject({ retryAt: 2_000, message: "You're sending quickly. Try again in 1 second." });
    expect(at(429, "rate_limited", false, 200)).toMatchObject({ message: "You're sending quickly. Try again in 1 second." });
    expect(at(429, "rate_limited")).toMatchObject({ retryAt: null, message: "You're sending quickly. Try again in a moment." });
    expect(describeFailure(new TypeError("boom"), 0)).toMatchObject({ reason: "server", error: { code: "client_error" } });
  });
});

describe("composer lifecycle and edges", () => {
  it("a retry made the moment a send fails starts a new request instead of joining the failed one", async () => {
    const { composer, server } = setup();
    server.intercept("post", () => refusal(500, "server"));
    let retried: Promise<Message> | undefined;
    const unsubscribe = composer.subscribe(() => {
      const [item] = composer.getState().outbox;
      if (item?.status === "failed" && !retried) retried = composer.retry(item.clientNonce);
    });
    await expect(composer.send({ body: "Try twice", parentId: null, embeds: [] })).rejects.toMatchObject({ status: 500 });
    unsubscribe();
    await expect(retried).resolves.toMatchObject({ clientNonce: "nonce-1" });
    expect(server.count("post")).toBe(2);
  });

  it("confirms sends before any hook retained it, without writing storage", async () => {
    const { composer, channel, storage } = setup({ retain: false });
    composer.setDraft(null, { embeds: [{ type: "project", journeyId: "j1", version: 1 }] });
    expect(composer.draft(null)).toMatchObject({ body: "", embeds: [{ journeyId: "j1" }] });
    await composer.send({ body: "Early", parentId: null, embeds: [] });
    expect(channel.getState().messages.at(-1)?.body).toBe("Early");
    expect(composer.getState().outbox).toEqual([]);
    expect(storage.data.size).toBe(0);
  });

  it("loads storage once, keeps sends made before loading, and releases idempotently", async () => {
    const storage = memoryStorage({
      [channelDraftKey(VIEWER, CHANNEL)]: JSON.stringify({ drafts: {}, sends: [{ clientNonce: "old-1", parentId: null, body: "Stored", embeds: [], createdAt: 1 }] }),
    });
    const { composer, server } = setup({ options: { storage }, retain: false });
    server.intercept("post", () => refusal(500, "server"));
    await composer.send({ body: "Before loading", parentId: null, embeds: [] }).catch(() => {});
    const getItem = vi.spyOn(storage, "getItem");
    const release = composer.retain();
    expect(composer.getState().outbox.map(item => item.clientNonce)).toEqual(["old-1", "nonce-1"]);
    release();
    release();
    composer.retain()();
    expect(getItem).toHaveBeenCalledTimes(1);
    // Retrying one item leaves the others as they are.
    await composer.retry("nonce-1");
    expect(composer.getState().outbox.map(item => item.clientNonce)).toEqual(["old-1"]);
  });

  it("retries only offline failures when back online, leaving sends in flight alone", async () => {
    const { composer, server } = setup();
    vi.stubGlobal("navigator", { onLine: false });
    await composer.send({ body: "Offline", parentId: null, embeds: [] }).catch(() => {});
    vi.stubGlobal("navigator", { onLine: true });
    const gate = deferred();
    server.intercept("post", async (_request, next) => { await gate.promise; return next(); });
    const pending = composer.send({ body: "In flight", parentId: null, embeds: [] });
    composer.retryOffline();
    composer.retryOffline();
    gate.resolve();
    await pending;
    await vi.waitFor(() => expect(composer.getState().outbox).toEqual([]));
    expect(server.count("post")).toBe(2);
  });

  it("a failure for a send polling showed and then removed leaves no failed item", async () => {
    const { composer, channel, server } = setup();
    const gate = deferred();
    server.intercept("post", async (_request, next) => { await next(); await gate.promise; throw new TypeError("reset"); });
    const sent = composer.send({ body: "Shown, then removed", parentId: null, embeds: [] });
    await flush();
    server.intercept("list",
      () => ({ data: page([server.byNonce.get("nonce-1")!], "s1") }),
      () => ({ data: page([], "s2", { removedIds: [server.byNonce.get("nonce-1")!.id] }) }));
    await channel.poll(signal());
    await channel.poll(signal());
    gate.resolve();
    await expect(sent).rejects.toMatchObject({ code: "network_error" });
    expect(composer.getState()).toMatchObject({ outbox: [], announcement: "" });
  });

  it("makes valid, distinct nonces, with or without crypto.randomUUID", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(ClientNonce.safeParse(nonce).success).toBe(true);
    vi.stubGlobal("crypto", undefined);
    expect(ClientNonce.safeParse(createNonce()).success).toBe(true);
  });

  it("constructs with the default API client without any request", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const channel = createChannelStore({ channelId: CHANNEL, enabled: true });
    const composer = createComposer({ store: channel, me: { user: { id: VIEWER }, flags: {} } });
    expect(composer.getState().outbox).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds mention people and copes with a thread whose parent is gone", () => {
    const authors = Array.from({ length: MAX_MENTION_PEOPLE + 10 }, (_, i) => msg(i + 1, { author: { ...people.kevin, id: `p${i}` } }));
    const state = createChannelStore({ channelId: CHANNEL, initial: page(authors, "s0") }).getState();
    expect(selectMentionPeople(state, null, VIEWER)).toHaveLength(MAX_MENTION_PEOPLE);
    const orphan = { ...state, messages: [], thread: { parentId: "gone", status: "removed" as const, messages: [msg(1, { parentId: "gone" })], parent: null, hasOlder: false, loadingOlder: false, error: null } };
    expect(selectMentionPeople(orphan, "gone", VIEWER).map(person => person.id)).toEqual(["author"]);
  });
});
