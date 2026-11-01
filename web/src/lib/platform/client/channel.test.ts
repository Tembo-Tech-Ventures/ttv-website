import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelRead, Message, MessageList } from "../contracts";
import { messages } from "../fixtures";
import { createApiClient } from "./apiClient";
import { applyOverlay, createChannelStore, selectFirstUnread, selectPollable, selectUnreadCount, type ChannelOptions } from "./channel";
import { createMockTransport, type MockReply } from "./mockTransport";

const CHANNEL = "channel-1";
const msg = (n: number, overrides: Partial<Message> = {}): Message => ({
  ...messages.projectPost, id: `m${String(n).padStart(4, "0")}`, channelId: CHANNEL, parentId: null,
  createdAt: n * 1_000, clientNonce: null, author: { ...messages.projectPost.author, id: "author" }, ...overrides,
});
const reply = (n: number, parentId: string, overrides: Partial<Message> = {}) => msg(n, { parentId, ...overrides });
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));
const page = (items: Message[], beforeCursor: string | null, sinceCursor: string, extra: Partial<MessageList> = {}): MessageList =>
  ({ items, beforeCursor, sinceCursor, thread: null, removedIds: [], ...extra });
const error = (status: number, code: string): MockReply => ({ status, data: { error: { code, message: "Synthetic failure" } } });
const ids = (list: readonly Message[]) => list.map(item => Number(item.id.slice(1)));
const never = () => new Promise<never>(() => {});
const signal = () => new AbortController().signal;

interface Request { query: URLSearchParams; body: unknown; signal: AbortSignal }
type Handler = (request: Request) => MockReply | Promise<MockReply>;

/** A scripted server: each test queues the replies it expects, in order. */
function server() {
  const lists: Handler[] = [];
  const reads: Handler[] = [];
  const seen: Request[] = [];
  const readBodies: unknown[] = [];
  const api = createApiClient({ retry: { maxRetries: 0 }, fetch: createMockTransport([
    { method: "GET", path: "/api/channels/:id/messages", reply: ({ request }) => {
      const entry = { query: new URL(request.url).searchParams, body: undefined, signal: request.signal };
      seen.push(entry);
      const next = lists.shift();
      if (!next) throw new Error(`Unexpected list request ${entry.query}`);
      return next(entry);
    } },
    { method: "POST", path: "/api/channels/:id/read", reply: async ({ request }) => {
      const body = await request.json();
      readBodies.push(body);
      const next = reads.shift();
      if (!next) throw new Error("Unexpected read request");
      return next({ query: new URLSearchParams(), body, signal: request.signal });
    } },
  ]) });
  return {
    api, seen, readBodies,
    list(...handlers: (Handler | MessageList)[]) {
      for (const handler of handlers) lists.push(typeof handler === "function" ? handler : () => ({ data: handler }));
    },
    read(...handlers: (Handler | ChannelRead)[]) {
      for (const handler of handlers) reads.push(typeof handler === "function" ? handler : () => ({ data: handler }));
    },
    pending: () => lists.length,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function setup(options: Partial<ChannelOptions> = {}) {
  const fake = server();
  const store = createChannelStore({ channelId: CHANNEL, enabled: true, api: fake.api, maxMessages: 50, ...options });
  return { fake, store };
}

afterEach(() => { vi.useRealTimers(); });

describe("channel store", () => {
  it("validates limits and performs no work while disabled or before use", async () => {
    expect(() => createChannelStore({ channelId: CHANNEL, maxMessages: 10 })).toThrow(RangeError);
    expect(() => createChannelStore({ channelId: CHANNEL, maxThreadMessages: 20_000 })).toThrow(RangeError);
    expect(() => createChannelStore({ channelId: CHANNEL, maxMessages: 50, pageSize: 51 })).toThrow(RangeError);
    const fake = server();
    const store = createChannelStore({ channelId: CHANNEL, api: fake.api });
    expect(await store.poll(signal())).toEqual({ changed: false });
    expect(store.isPollActive()).toBe(false);
    await store.loadOlder();
    expect(await store.jumpToLatest()).toBe(false);
    expect(await store.openThread("m0001")).toBe(false);
    expect(fake.seen).toHaveLength(0);
    expect(store.getState().status).toBe("idle");
  });

  it("hydrates from a server page, and SSR uses that snapshot", () => {
    const { store } = setup({ initial: page(range(1, 3), "b1", "s0"), initialRead: { lastReadMessageId: msg(2).id, unreadCount: 1 } });
    expect(ids(store.getState().messages)).toEqual([1, 2, 3]);
    expect(store.getServerSnapshot()).toBe(store.getState());
    expect(store.getState()).toMatchObject({ status: "ready", live: true, hasOlder: true });
    expect(selectFirstUnread(store.getState())?.id).toBe(msg(3).id);
    expect(selectUnreadCount(store.getState())).toBe(1);
  });

  it("loads the latest page on the first poll, then polls since the checkpoint", async () => {
    const { fake, store } = setup();
    fake.list(page(range(1, 3), null, "s1"), page([msg(4)], null, "s2"));
    expect(await store.poll(signal())).toEqual({ changed: true });
    expect(fake.seen[0].query.toString()).toBe("");
    expect(await store.poll(signal())).toEqual({ changed: true });
    expect(fake.seen[1].query.get("since")).toBe("s1");
    expect(ids(store.getState().messages)).toEqual([1, 2, 3, 4]);
    expect(store.getState().announcement).toBe("1 new message");
    fake.list(page([], null, "s3"));
    expect(await store.poll(signal())).toEqual({ changed: false });
    expect(fake.seen[2].query.get("since")).toBe("s2");
  });

  it("merges duplicates, edits, reordering and tombstones from polled deltas", async () => {
    const { fake, store } = setup({ initial: page(range(1, 3), null, "s1"), viewerId: "me" });
    const edited = msg(2, { body: "Edited", edited: true });
    const late = msg(5, { createdAt: 2_500 }); // created between 2 and 3, delivered late
    const own = msg(6, { author: { ...messages.projectPost.author, id: "me" } });
    fake.list(page([msg(7), edited, late, msg(3), own, msg(7)], null, "s2", { removedIds: [msg(1).id] }));
    await store.poll(signal());
    expect(ids(store.getState().messages)).toEqual([2, 5, 3, 6, 7]);
    expect(store.getState().messages[0].body).toBe("Edited");
    // The viewer's own message is not announced.
    expect(store.getState().announcement).toBe("2 new messages");
  });

  it("never fills a gap with polled messages older than unloaded history", async () => {
    const { fake, store } = setup({ initial: page(range(10, 12), "b10", "s1") });
    fake.list(page([msg(3, { body: "edited long ago" }), msg(13)], null, "s2"));
    await store.poll(signal());
    expect(ids(store.getState().messages)).toEqual([10, 11, 12, 13]);
    fake.list(page(range(5, 9), "b5", "x"));
    await store.loadOlder();
    expect(fake.seen[1].query.get("before")).toBe("b10");
    expect(ids(store.getState().messages)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("drops duplicates from shifted older pages and keeps the polled copy", async () => {
    const { fake, store } = setup({ initial: page(range(10, 12), "b10", "s1") });
    fake.list(page([msg(10, { body: "polled" })], null, "s2"), page([msg(8), msg(9), msg(10, { body: "older copy" })], null, "x"));
    await store.poll(signal());
    await store.loadOlder();
    expect(ids(store.getState().messages)).toEqual([8, 9, 10, 11, 12]);
    expect(store.getState().messages[2].body).toBe("polled");
    expect(store.getState().hasOlder).toBe(false);
    await store.loadOlder();
    expect(fake.seen).toHaveLength(2);
  });

  it("shares one older-page request and reports its failure separately", async () => {
    const { fake, store } = setup({ initial: page(range(10, 12), "b10", "s1") });
    const gate = deferred<MockReply>();
    fake.list(() => gate.promise, () => error(500, "server"));
    const first = store.loadOlder();
    const second = store.loadOlder();
    expect(store.getState().loadingOlder).toBe(true);
    gate.resolve({ data: page([msg(9)], "b9", "x") });
    await Promise.all([first, second]);
    expect(fake.seen).toHaveLength(1);
    await store.loadOlder();
    expect(store.getState()).toMatchObject({ loadingOlder: false, error: null, announcement: "Could not load older messages" });
    expect(store.getState().olderError?.code).toBe("server");
  });

  describe("out-of-order responses", () => {
    it("discards an older page that resolves after a jump to latest", async () => {
      const { fake, store } = setup({ initial: page(range(10, 12), "b10", "s1") });
      const gate = deferred<MockReply>();
      fake.list(() => gate.promise, page(range(20, 22), "b20", "s9"));
      const older = store.loadOlder();
      await store.jumpToLatest();
      gate.resolve({ data: page(range(5, 9), null, "x") });
      await older;
      expect(ids(store.getState().messages)).toEqual([20, 21, 22]);
      expect(store.getState().hasOlder).toBe(true);
    });

    it("discards a since response that resolves after the window was reset", async () => {
      const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
      const gate = deferred<MockReply>();
      fake.list(() => gate.promise, page(range(30, 31), "b30", "s9"));
      const polling = store.poll(signal());
      const jump = store.jumpToLatest();
      gate.resolve({ data: page([msg(4)], null, "s2") });
      await Promise.all([polling, jump]);
      expect(ids(store.getState().messages)).toEqual([30, 31]);
      fake.list(page([], null, "s10"));
      await store.poll(signal());
      expect(fake.seen.at(-1)?.query.get("since")).toBe("s9");
    });

    it("discards a reply page for a thread that is no longer open", async () => {
      const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
      const gate = deferred<MockReply>();
      fake.list(() => gate.promise, page([reply(10, msg(2).id)], null, "t2", { thread: msg(2).id }));
      const first = store.openThread(msg(1).id);
      const second = store.openThread(msg(2).id);
      gate.resolve({ data: page([reply(9, msg(1).id)], null, "t1", { thread: msg(1).id }) });
      expect(await first).toBe(false);
      expect(await second).toBe(true);
      expect(store.getState().thread).toMatchObject({ parentId: msg(2).id, status: "ready" });
      expect(ids(store.getState().thread!.messages)).toEqual([10]);
    });

    it("aborts in-flight work when the last owner releases the store", async () => {
      const { fake, store } = setup();
      fake.list(never);
      const release = store.retain();
      const polling = store.poll(signal());
      await vi.waitFor(() => expect(fake.seen).toHaveLength(1));
      release();
      expect(fake.seen[0].signal.aborted).toBe(true);
      expect(await polling).toEqual({ changed: false });
      expect(store.getState().status).toBe("loading");
      expect(store.isPollActive()).toBe(false);
      store.retain();
      expect(store.isPollActive()).toBe(true);
    });

    it("aborts its own request when the poller's signal aborts", async () => {
      const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
      fake.list(never);
      const controller = new AbortController();
      const polling = store.poll(controller.signal);
      await vi.waitFor(() => expect(fake.seen).toHaveLength(1));
      controller.abort();
      expect(await polling).toEqual({ changed: false });
      expect(fake.seen[0].signal.aborted).toBe(true);
      expect(store.getState().error).toBeNull();
    });
  });

  describe("memory limit", () => {
    it("evicts far pages while scrolling back, keeps the anchor, and ends live polling", async () => {
      const { fake, store } = setup({ initial: page(range(91, 100), "b91", "s1") });
      for (let start = 81; start >= 1; start -= 10) fake.list(page(range(start, start + 9), start === 1 ? null : `b${start}`, "x"));
      for (let i = 0; i < 9; i++) {
        await store.loadOlder();
        expect(store.getState().messages.length).toBeLessThanOrEqual(50);
      }
      // Without an anchor the store keeps the top of the window: the reader is scrolling back.
      expect(ids(store.getState().messages)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
      expect(store.getState()).toMatchObject({ live: false, hasOlder: false });
      expect(store.isPollActive()).toBe(false);
      expect(selectPollable(store.getState())).toBe(false);
      expect(await store.poll(signal())).toEqual({ changed: false });
      fake.list(page(range(95, 100), "b95", "s2"));
      await store.jumpToLatest();
      expect(ids(store.getState().messages)).toEqual([95, 96, 97, 98, 99, 100]);
      expect(store.getState()).toMatchObject({ live: true, anchorId: null });
    });

    it("keeps the anchor's page when new messages push the window over the limit", async () => {
      const { fake, store } = setup({ initial: page(range(1, 50), "b1", "s1"), pageSize: 10 });
      store.setAnchor(msg(5).id);
      store.setAnchor("not-cached");
      expect(store.getState().anchorId).toBeNull();
      store.setAnchor(msg(5).id);
      fake.list(page(range(51, 60), "b51", "s2"));
      await store.poll(signal());
      expect(ids(store.getState().messages)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
      expect(store.getState().live).toBe(false);
      store.setAnchor(null);
      fake.list(page(range(41, 60), "b41", "s3"));
      await store.jumpToLatest();
      fake.list(page(range(61, 100), "b61", "s4"));
      await store.poll(signal());
      expect(store.getState().messages).toHaveLength(40);
      expect(store.getState()).toMatchObject({ live: true, hasOlder: true });
    });
  });

  describe("errors", () => {
    it("takes a fresh snapshot when the server rejects the since cursor", async () => {
      const { fake, store } = setup({ initial: page(range(1, 3), null, "s-expired") });
      fake.list(() => error(410, "not_found"), page(range(40, 41), "b40", "s1"));
      expect(await store.poll(signal())).toEqual({ changed: true });
      expect(ids(store.getState().messages)).toEqual([40, 41]);
      fake.list(() => error(400, "validation"), page(range(50, 51), "b50", "s2"));
      await store.poll(signal());
      expect(ids(store.getState().messages)).toEqual([50, 51]);
    });

    it("keeps polling through transient failures and stops on flag or access failures", async () => {
      const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
      fake.list(() => error(503, "server"));
      expect(await store.poll(signal())).toEqual({ changed: false });
      expect(store.getState()).toMatchObject({ terminal: false, announcement: "Could not update messages" });
      expect(store.isPollActive()).toBe(true);
      fake.list(() => error(404, "flag_off"));
      await store.poll(signal());
      expect(store.getState()).toMatchObject({ terminal: true });
      expect(store.isPollActive()).toBe(false);
      expect(selectPollable(store.getState())).toBe(false);
      expect(await store.poll(signal())).toEqual({ changed: false });
      store.restart();
      expect(store.getState()).toMatchObject({ terminal: false, error: null });
      expect(selectPollable(store.getState())).toBe(true);
    });

    it("reports a failed first load and retries it on the next poll", async () => {
      const { fake, store } = setup();
      fake.list(() => error(500, "server"), page([msg(1)], null, "s1"));
      await store.poll(signal());
      expect(store.getState().status).toBe("error");
      expect(store.isPollActive()).toBe(true);
      await store.poll(signal());
      expect(store.getState()).toMatchObject({ status: "ready", error: null });
    });
  });

  describe("thread pane", () => {
    const parent = msg(2);
    it("opens, polls, pages and closes a thread without touching the channel window", async () => {
      const { fake, store } = setup({ initial: page(range(1, 3), null, "s1"), maxThreadMessages: 50 });
      fake.list(page([reply(11, parent.id), reply(12, parent.id)], "tb11", "t1", { thread: parent.id }));
      const opening = store.openThread(parent.id);
      expect(store.getState().thread).toMatchObject({ parentId: parent.id, status: "loading" });
      expect(store.openThread(parent.id)).toBe(opening);
      await opening;
      expect(fake.seen[0].query.get("thread")).toBe(parent.id);
      expect(store.getState().thread).toMatchObject({ status: "ready", hasOlder: true, parent: { id: parent.id } });
      expect(await store.openThread(parent.id)).toBe(true);

      // One poll tick checks the channel and the open thread; replies in the channel feed are left to the thread.
      fake.list(
        page([reply(13, parent.id)], null, "s2"),
        page([reply(13, parent.id), reply(14, msg(1).id)], null, "t2", { thread: parent.id }),
      );
      expect(await store.poll(signal())).toEqual({ changed: true });
      expect(ids(store.getState().messages)).toEqual([1, 2, 3]);
      expect(ids(store.getState().thread!.messages)).toEqual([11, 12, 13]);
      expect(store.getState().announcement).toBe("1 new reply");
      const threadPoll = fake.seen.find(entry => entry.query.get("since") === "t1");
      expect(threadPoll?.query.get("thread")).toBe(parent.id);

      fake.list(page([reply(10, parent.id)], null, "x", { thread: parent.id }));
      await store.loadOlderReplies();
      expect(fake.seen.at(-1)?.query.get("before")).toBe("tb11");
      expect(ids(store.getState().thread!.messages)).toEqual([10, 11, 12, 13]);
      expect(store.getState().thread!.hasOlder).toBe(false);
      await store.loadOlderReplies();

      store.closeThread();
      expect(store.getState().thread).toBeNull();
      expect(store.isPollActive()).toBe(true);
    });

    it("keeps a thread live when the channel window is not, and shows removal of its parent", async () => {
      const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
      fake.list(page([], null, "t1", { thread: parent.id }));
      await store.openThread(parent.id);
      fake.list(page([], null, "s2", { removedIds: [parent.id] }), page([], null, "t1", { thread: parent.id }));
      await store.poll(signal());
      expect(ids(store.getState().messages)).toEqual([1, 3]);
      expect(store.getState().thread).toMatchObject({ status: "removed", parent: null });
      expect(store.getState().announcement).toBe("This thread is no longer available");
    });

    it("distinguishes unavailable threads, failures and expired thread cursors", async () => {
      const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
      fake.list(() => error(404, "not_found"));
      expect(await store.openThread(parent.id)).toBe(false);
      expect(store.getState().thread).toMatchObject({ status: "removed" });
      expect(store.getState().announcement).toBe("This thread is no longer available");
      expect(store.getState().terminal).toBe(false);

      fake.list(() => error(500, "server"), page([], null, "t1", { thread: parent.id }));
      await store.openThread(msg(3).id);
      expect(store.getState().thread).toMatchObject({ status: "error", parentId: msg(3).id });
      expect(await store.openThread(msg(3).id)).toBe(true);
      expect(store.getState().thread?.status).toBe("ready");

      fake.list(page([], null, "s2"), () => error(410, "not_found"), page([reply(20, msg(3).id)], null, "t2", { thread: msg(3).id }));
      await store.poll(signal());
      expect(ids(store.getState().thread!.messages)).toEqual([20]);

      fake.list(page([], null, "s3"), () => error(500, "server"));
      await store.poll(signal());
      expect(store.getState().thread?.status).toBe("error");
      fake.list(() => error(403, "forbidden"));
      await store.openThread(parent.id);
      expect(store.getState().terminal).toBe(true);
    });

    it("bounds the open thread and ignores a reply page after closing", async () => {
      const { fake, store } = setup({ initial: page(range(1, 3), null, "s1"), maxThreadMessages: 50 });
      const replies = Array.from({ length: 60 }, (_, i) => reply(100 + i, parent.id));
      fake.list(page(replies, "tb", "t1", { thread: parent.id }));
      await store.openThread(parent.id);
      expect(store.getState().thread!.messages).toHaveLength(50);
      expect(store.getState().thread!.hasOlder).toBe(false);
      const gate = deferred<MockReply>();
      fake.list(page([], null, "s2"), () => gate.promise);
      const polling = store.poll(signal());
      await vi.waitFor(() => expect(fake.pending()).toBe(0));
      store.closeThread();
      gate.resolve({ data: page([reply(200, parent.id)], null, "t2", { thread: parent.id }) });
      await polling;
      expect(store.getState().thread).toBeNull();
    });
  });

  describe("read markers", () => {
    const read = (n: number, unreadCount = 0): ChannelRead => ({ channelId: CHANNEL, lastReadMessageId: msg(n).id, unreadCount });

    it("advances monotonically, coalesces bursts and ignores older targets", async () => {
      const onRead = vi.fn();
      const { fake, store } = setup({ initial: page(range(1, 5), null, "s1"), initialRead: { lastReadMessageId: msg(1).id, unreadCount: 4 }, onRead });
      const gate = deferred<MockReply>();
      fake.read(() => gate.promise, read(5, 0));
      const first = store.markRead(msg(2).id);
      expect(store.getState().read).toMatchObject({ markerId: msg(2).id, confirmedId: msg(1).id, pending: true });
      const second = store.markRead(msg(4).id);
      const third = store.markRead(msg(5).id);
      expect(await store.markRead(msg(3).id)).toBe(true);
      expect(await store.markRead(msg(1).id)).toBe(true);
      expect(store.getState().read).toMatchObject({ markerId: msg(5).id, unreadCount: 0 });
      gate.resolve({ data: read(2, 3) });
      expect(await Promise.all([first, second, third])).toEqual([true, true, true]);
      // Only the first and the newest target were sent.
      expect(fake.readBodies).toEqual([{ messageId: msg(2).id }, { messageId: msg(5).id }]);
      expect(store.getState().read).toMatchObject({ markerId: msg(5).id, confirmedId: msg(5).id, unreadCount: 0, pending: false });
      expect(onRead).toHaveBeenCalledTimes(2);
      expect(selectFirstUnread(store.getState())).toBeNull();
    });

    it("ignores a response that would move the confirmed marker backwards", async () => {
      const onRead = vi.fn();
      const { fake, store } = setup({ initial: page(range(1, 5), null, "s1"), initialRead: { lastReadMessageId: msg(3).id, unreadCount: 2 }, onRead });
      fake.read(read(2, 3));
      expect(await store.markRead(msg(4).id)).toBe(false);
      expect(store.getState().read).toMatchObject({ confirmedId: msg(3).id, markerId: msg(3).id, unreadCount: 2 });
      expect(onRead).not.toHaveBeenCalled();
    });

    it("adopts a newer marker from another tab and an unknown marker as at least the one sent", async () => {
      const { fake, store } = setup({ initial: page(range(1, 5), null, "s1") });
      fake.read(read(5, 0), { channelId: CHANNEL, lastReadMessageId: "elsewhere", unreadCount: 7 });
      expect(await store.markRead(msg(2).id)).toBe(true);
      expect(store.getState().read.confirmedId).toBe(msg(5).id);
      expect(await store.markRead(msg(4).id)).toBe(true);
      expect(fake.readBodies).toHaveLength(1);
      const { fake: other, store: second } = setup({ initial: page(range(1, 5), null, "s1") });
      other.read({ channelId: CHANNEL, lastReadMessageId: "elsewhere", unreadCount: 7 });
      expect(await second.markRead(msg(3).id)).toBe(true);
      expect(second.getState().read).toMatchObject({ confirmedId: "elsewhere", unreadCount: 7 });
      expect(await second.markRead(msg(2).id)).toBe(true);
    });

    it("rolls back on failure and retries the newest target", async () => {
      const { fake, store } = setup({ initial: page(range(1, 5), null, "s1"), initialRead: { lastReadMessageId: null, unreadCount: 5 } });
      const gate = deferred<MockReply>();
      fake.read(() => gate.promise, read(5, 0));
      const first = store.markRead(msg(3).id);
      const second = store.markRead(msg(5).id);
      expect(store.getState().read.unreadCount).toBe(0);
      gate.resolve(error(503, "server"));
      expect(await Promise.all([first, second])).toEqual([false, false]);
      expect(store.getState().read).toMatchObject({ markerId: null, unreadCount: 5, pending: false });
      expect(store.getState().read.error?.code).toBe("server");
      expect(store.getState().announcement).toBe("Could not mark messages read");
      expect(await store.retryRead()).toBe(true);
      expect(fake.readBodies.at(-1)).toEqual({ messageId: msg(5).id });
      expect(await store.retryRead()).toBe(false);
    });

    it("only marks cached messages of this channel and rolls back when released", async () => {
      const { fake, store } = setup({ initial: page(range(1, 5), null, "s1") });
      expect(await store.markRead("unknown")).toBe(false);
      expect(await store.markRead(msg(9).id)).toBe(false);
      fake.read(never);
      const release = store.retain();
      const pending = store.markRead(msg(4).id);
      await vi.waitFor(() => expect(fake.readBodies).toHaveLength(1));
      release();
      expect(await pending).toBe(false);
      expect(store.getState().read).toMatchObject({ markerId: null, pending: false });
      expect(await store.markRead(msg(4).id)).toBe(false);
    });
  });

  it("receives posted messages without moving cursors and ignores other channels", async () => {
    const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
    fake.list(page([reply(10, msg(1).id)], null, "t1", { thread: msg(1).id }));
    await store.openThread(msg(1).id);
    store.receive([msg(4), reply(11, msg(1).id), msg(5, { channelId: "other" })]);
    expect(ids(store.getState().messages)).toEqual([1, 2, 3, 4]);
    expect(ids(store.getState().thread!.messages)).toEqual([10, 11]);
    fake.list(page([msg(4)], null, "s2"), page([], null, "t2", { thread: msg(1).id }));
    await store.poll(signal());
    expect(fake.seen.find(entry => entry.query.get("since") === "s1")).toBeDefined();
    expect(ids(store.getState().messages)).toEqual([1, 2, 3, 4]);
    const disabled = createChannelStore({ channelId: CHANNEL, initial: page(range(1, 3), null, "s1") });
    disabled.receive([msg(4)]);
    expect(disabled.getState().messages).toHaveLength(3);
  });

  it("treats an uncached initial marker as older than everything retained", async () => {
    const { fake, store } = setup({ initial: page(range(10, 12), "b10", "s1"), initialRead: { lastReadMessageId: "m0003", unreadCount: 3 } });
    expect(selectFirstUnread(store.getState())).toBeNull();
    fake.read({ channelId: CHANNEL, lastReadMessageId: msg(10).id, unreadCount: 2 });
    expect(await store.markRead(msg(10).id)).toBe(true);
    expect(selectFirstUnread(store.getState())?.id).toBe(msg(11).id);
    expect(selectFirstUnread({ ...store.getState(), read: { ...store.getState().read, markerId: null } })).toBeNull();
  });

  it("does not assume an empty unread count while the newest messages are evicted", async () => {
    const { fake, store } = setup({ initial: page(range(1, 50), "b1", "s1"), initialRead: { lastReadMessageId: null, unreadCount: 9 }, pageSize: 10 });
    store.setAnchor(msg(1).id);
    fake.list(page(range(51, 60), "b51", "s2"));
    await store.poll(signal());
    expect(store.getState().live).toBe(false);
    fake.read(never);
    void store.markRead(msg(50).id);
    expect(store.getState().read).toMatchObject({ markerId: msg(50).id, unreadCount: 9, pending: true });
  });

  it("forgets a removed anchor and keeps a failed refresh from blanking the window", async () => {
    const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
    store.setAnchor(msg(2).id);
    fake.list(page([], null, "s2", { removedIds: [msg(2).id, "never-seen"] }), () => error(500, "server"));
    await store.poll(signal());
    expect(store.getState().anchorId).toBeNull();
    expect(await store.jumpToLatest()).toBe(false);
    expect(store.getState()).toMatchObject({ status: "ready", announcement: "Could not load messages" });
    expect(ids(store.getState().messages)).toEqual([1, 3]);
  });

  it("aborts at once when the poller's signal is already aborted, and releases idempotently", async () => {
    const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
    fake.list(page([msg(4)], null, "s2"));
    const controller = new AbortController();
    controller.abort();
    expect(await store.poll(controller.signal)).toEqual({ changed: false });
    const release = store.retain();
    const other = store.retain();
    release();
    release();
    expect(store.isPollActive()).toBe(true);
    other();
    expect(store.isPollActive()).toBe(false);
  });

  it("drops a queued read target when released and reports the sent one after a failure", async () => {
    const { fake, store } = setup({ initial: page(range(1, 5), null, "s1") });
    fake.read(never);
    const release = store.retain();
    const first = store.markRead(msg(2).id);
    const second = store.markRead(msg(3).id);
    release();
    expect(await Promise.all([first, second])).toEqual([false, false]);
    expect(store.getState().read).toMatchObject({ markerId: null, pending: false });
    store.retain();
    fake.read(() => error(500, "server"), { channelId: CHANNEL, lastReadMessageId: msg(4).id, unreadCount: 1 });
    expect(await store.markRead(msg(4).id)).toBe(false);
    expect(await store.retryRead()).toBe(true);
    expect(fake.readBodies.at(-1)).toEqual({ messageId: msg(4).id });
  });

  it("ignores received messages before the first load", () => {
    const { store } = setup();
    store.receive([msg(1)]);
    expect(store.getState().messages).toEqual([]);
  });

  it("shows a thread whose parent is removed by the thread feed", async () => {
    const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
    fake.list(page([], null, "t1", { thread: msg(2).id }));
    await store.openThread(msg(2).id);
    fake.list(page([], null, "s2"), page([], null, "t2", { thread: msg(2).id, removedIds: [msg(2).id] }));
    await store.poll(signal());
    expect(store.getState().thread?.status).toBe("removed");
    // The removed thread is no longer polled; the channel still is.
    fake.list(page([], null, "s3"));
    await store.poll(signal());
    expect(fake.seen.at(-1)?.query.get("thread")).toBeNull();
    expect(fake.pending()).toBe(0);
  });

  it("never leaves an older-page request marked loading after a reset or a thread switch", async () => {
    const { fake, store } = setup({ initial: page(range(10, 12), "b10", "s1") });
    fake.list(never, page(range(20, 21), "b20", "s2"));
    void store.loadOlder();
    expect(store.getState().loadingOlder).toBe(true);
    await store.jumpToLatest();
    await vi.waitFor(() => expect(store.getState().loadingOlder).toBe(false));
    fake.list(page([reply(30, msg(20).id)], "tb", "t1", { thread: msg(20).id }), never,
      page([reply(40, msg(21).id)], "tc", "t2", { thread: msg(21).id }), never);
    await store.openThread(msg(20).id);
    void store.loadOlderReplies();
    expect(store.getState().thread?.loadingOlder).toBe(true);
    await store.openThread(msg(21).id);
    void store.loadOlderReplies();
    expect(store.getState().thread).toMatchObject({ parentId: msg(21).id, loadingOlder: true });
    await Promise.resolve();
    expect(store.getState().thread?.loadingOlder).toBe(true);
    store.closeThread();
    expect(store.getState().thread).toBeNull();
  });

  it("keeps an open thread's parent in the window when its older page is reloaded", async () => {
    const { fake, store } = setup({ initial: page(range(1, 50), null, "s1"), maxMessages: 600 });
    fake.list(page([reply(1001, msg(10).id)], null, "t1", { thread: msg(10).id }));
    await store.openThread(msg(10).id);
    fake.list(page(range(51, 100), "b51", "s2"));
    await store.jumpToLatest();
    expect(store.getState().thread?.parent?.id).toBe(msg(10).id);
    fake.list(page(range(1, 50), null, "x"));
    await store.loadOlder();
    expect(ids(store.getState().messages)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  it("resumes a loaded thread pane after a terminal error and restart, and after release and retain", async () => {
    const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
    const thread = (items: Message[], since: string) => page(items, null, since, { thread: msg(2).id });
    store.retain();
    fake.list(thread([reply(1001, msg(2).id)], "t1"));
    await store.openThread(msg(2).id);
    fake.list(() => error(401, "unauthorized"), () => error(401, "unauthorized"));
    await store.poll(signal());
    expect(store.getState().terminal).toBe(true);
    store.restart();
    expect(await store.openThread(msg(2).id)).toBe(true);
    fake.list(page([], null, "s2"), thread([reply(1002, msg(2).id)], "t2"));
    await store.poll(signal());
    expect(ids(store.getState().thread!.messages)).toEqual([1001, 1002]);

    const release = store.retain();
    release();
    store.retain();
    fake.list(page([], null, "s3"), thread([reply(1003, msg(2).id)], "t3"));
    await store.poll(signal());
    expect(ids(store.getState().thread!.messages)).toEqual([1001, 1002, 1003]);
    expect(fake.pending()).toBe(0);
  });

  it("aborts an in-flight thread poll when the pane closes", async () => {
    const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
    fake.list(page([], null, "t1", { thread: msg(2).id }));
    await store.openThread(msg(2).id);
    fake.list(page([], null, "s2"), never);
    const polling = store.poll(signal());
    await vi.waitFor(() => expect(fake.seen).toHaveLength(3));
    store.closeThread();
    expect(fake.seen[2].signal.aborted).toBe(true);
    expect(await polling).toEqual({ changed: false });
  });

  it("recovers the thread pane after a failed poll or a failed older-replies request", async () => {
    const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
    const thread = (items: Message[], since: string, before: string | null = null) => page(items, before, since, { thread: msg(2).id });
    fake.list(thread([reply(11, msg(2).id)], "t1", "tb11"));
    await store.openThread(msg(2).id);
    fake.list(page([], null, "s2"), () => error(500, "server"));
    await store.poll(signal());
    expect(store.getState().thread).toMatchObject({ status: "error", error: { status: 500 } });
    fake.list(page([], null, "s3"), thread([reply(12, msg(2).id)], "t2"));
    await store.poll(signal());
    expect(store.getState().thread).toMatchObject({ status: "ready", error: null });
    expect(ids(store.getState().thread!.messages)).toEqual([11, 12]);

    fake.list(() => error(500, "server"), thread([reply(10, msg(2).id)], "x"));
    await store.loadOlderReplies();
    expect(store.getState().thread).toMatchObject({ status: "error", hasOlder: true });
    await store.loadOlderReplies();
    expect(store.getState().thread).toMatchObject({ status: "ready", error: null, hasOlder: false });
    expect(ids(store.getState().thread!.messages)).toEqual([10, 11, 12]);
  });

  it("prefers an older page's copy of a cached message when the window is not live", async () => {
    const { fake, store } = setup({ initial: page(range(41, 50), "b41", "s1"), pageSize: 10 });
    fake.list(page(range(31, 40), "b31", "x"), page(range(21, 30), "b21", "x"), page(range(11, 20), "b11", "x"), page(range(1, 10), null, "x"));
    for (let i = 0; i < 4; i++) await store.loadOlder();
    fake.list(page([], null, "t1", { thread: msg(5).id }));
    await store.openThread(msg(5).id);
    store.setAnchor(msg(35).id);
    // Reading the middle: first the oldest page (holding the thread parent) is evicted, then the newest.
    fake.list(page(range(51, 60), "b51", "s2"), page([], null, "t2", { thread: msg(5).id }));
    await store.poll(signal());
    expect(store.getState().hasOlder).toBe(true);
    fake.list(page(range(61, 70), "b61", "s3"), page([], null, "t3", { thread: msg(5).id }));
    await store.poll(signal());
    expect(store.getState().live).toBe(false);
    expect(store.getState().thread?.parent?.body).toBe(msg(5).body);
    // Nothing polls the parent while the window isn't live, so the reloaded page's copy is the newer one.
    fake.list(page([msg(5, { body: "Edited while away", edited: true }), ...range(1, 4), ...range(6, 10)], null, "x"));
    await store.loadOlder();
    expect(store.getState().thread?.parent?.body).toBe("Edited while away");
  });

  it("clears announcements on request", async () => {
    const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
    fake.list(page([msg(4), msg(5)], null, "s2"));
    await store.poll(signal());
    expect(store.getState().announcement).toBe("2 new messages");
    store.clearAnnouncement();
    expect(store.getState().announcement).toBe("");
  });
});

describe("optimistic layer for the composer (S-2.2)", () => {
  it("shows overlays over the window, the thread and its parent, and clears them", async () => {
    const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
    fake.list(page([reply(11, msg(2).id)], null, "t1", { thread: msg(2).id }));
    await store.openThread(msg(2).id);
    const listener = vi.fn();
    store.subscribe(listener);
    const overlay = { body: "Edited here" };
    store.setOverlay(msg(1).id, overlay);
    store.setOverlay(msg(2).id, { reactions: { thanks: true } });
    store.setOverlay(msg(11).id, { deleted: true });
    const state = store.getState();
    expect(state.messages[0]).toMatchObject({ body: "Edited here", edited: true });
    expect(state.thread?.parent?.reactions).toContainEqual({ kind: "thanks", count: 1, mine: true });
    expect(state.thread?.messages[0]).toMatchObject({ deleted: true, body: "", embeds: [] });
    expect(store.peek(msg(1).id)?.body).toBe(msg(1).body);
    // The overlaid copy stays the same object while nothing changes, so selectors stay stable.
    store.setOverlay(msg(3).id, { body: msg(3).body });
    expect(store.getState().messages[0]).toBe(state.messages[0]);
    expect(store.getState().messages[2]).toBe(state.messages[2]);
    const calls = listener.mock.calls.length;
    store.setOverlay(msg(1).id, overlay);
    store.setOverlay("not-overlaid", null);
    expect(listener).toHaveBeenCalledTimes(calls);
    store.setOverlay(msg(1).id, null);
    expect(store.getState().messages[0]).toBe(store.peek(msg(1).id));
    expect(store.peek("missing")).toBeUndefined();
  });

  it("applies an overlay without inventing changes", () => {
    const base = msg(1, { reactions: [{ kind: "useful", count: 1, mine: true }] });
    expect(applyOverlay(base, {})).toBe(base);
    expect(applyOverlay(base, { body: base.body, reactions: { useful: true } })).toBe(base);
    expect(applyOverlay(base, { reactions: { useful: false } }).reactions).toEqual([]);
    const deleted = msg(2, { deleted: true, body: "", embeds: [] });
    expect(applyOverlay(deleted, { body: "Too late", deleted: true })).toBe(deleted);
    expect(applyOverlay(deleted, { reactions: { thanks: true } })).toBe(deleted);
    expect(applyOverlay(base, { deleted: true, body: "ignored" })).toMatchObject({ deleted: true, body: "", reactions: [] });
  });

  it("update replaces only cached copies of this channel, and a request already in flight cannot undo it", async () => {
    const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
    const listener = vi.fn();
    store.subscribe(listener);
    store.update([msg(9), msg(1, { channelId: "elsewhere", body: "Other channel" })]);
    expect(listener).not.toHaveBeenCalled();
    expect(ids(store.getState().messages)).toEqual([1, 2, 3]);

    const stale = deferred<MockReply>();
    fake.list(() => stale.promise);
    const polling = store.poll(signal());
    await vi.waitFor(() => expect(fake.seen).toHaveLength(1));
    store.update([msg(1, { body: "Confirmed edit", edited: true })]);
    stale.resolve({ data: page([msg(1), msg(2, { body: "Someone else's edit", edited: true })], null, "s2") });
    await polling;
    expect(store.getState().messages.map(item => item.body)).toEqual(["Confirmed edit", "Someone else's edit", msg(3).body]);
    // A request that starts after the confirmation is server truth again.
    fake.list(page([msg(1, { body: "Edited again", edited: true })], null, "s3"));
    await store.poll(signal());
    expect(store.getState().messages[0].body).toBe("Edited again");
    // A pinned message that polling removes is forgotten with its pin.
    store.update([msg(2, { body: "Pinned" })]);
    fake.list(page([], null, "s4", { removedIds: [msg(2).id] }));
    await store.poll(signal());
    expect(store.peek(msg(2).id)).toBeUndefined();
  });

  it("pins a received post against a latest page or thread page that was already in flight", async () => {
    const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
    const latest = deferred<MockReply>();
    fake.list(() => latest.promise);
    const jumping = store.jumpToLatest();
    await vi.waitFor(() => expect(fake.seen).toHaveLength(1));
    store.update([msg(3, { reactions: [{ kind: "agree", count: 1, mine: true }] })]);
    latest.resolve({ data: page(range(1, 3), null, "s2") });
    await jumping;
    expect(store.getState().messages[2].reactions).toEqual([{ kind: "agree", count: 1, mine: true }]);

    fake.list(page([reply(11, msg(2).id)], null, "t1", { thread: msg(2).id }));
    await store.openThread(msg(2).id);
    const replies = deferred<MockReply>();
    fake.list(page([], null, "s3"), () => replies.promise);
    const polling = store.poll(signal());
    await vi.waitFor(() => expect(fake.seen).toHaveLength(4));
    store.receive([reply(11, msg(2).id, { body: "Confirmed reply edit", edited: true })]);
    replies.resolve({ data: page([reply(11, msg(2).id)], null, "t2", { thread: msg(2).id }) });
    await polling;
    expect(store.getState().thread?.messages[0].body).toBe("Confirmed reply edit");
  });

  it("keeps a thread removed when its reply poll fails in the same tick (S-2.1 follow-up 1)", async () => {
    const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
    fake.list(page([reply(11, msg(2).id)], null, "t1", { thread: msg(2).id }));
    await store.openThread(msg(2).id);
    fake.list(page([], null, "s2", { removedIds: [msg(2).id] }), () => error(500, "server"));
    await store.poll(signal());
    expect(store.getState().thread).toMatchObject({ status: "removed", parent: null });
    expect(store.getState().announcement).toBe("This thread is no longer available");
    fake.list(page([], null, "s3"));
    await store.poll(signal());
    expect(store.getState().thread?.status).toBe("removed");
  });

  it("keeps a thread removed when its parent's tombstone arrives while it loads (S-2.1 follow-up 2)", async () => {
    const { fake, store } = setup({ initial: page(range(1, 3), null, "s1") });
    const loading = deferred<MockReply>();
    fake.list(() => loading.promise);
    const opening = store.openThread(msg(2).id);
    await vi.waitFor(() => expect(fake.seen).toHaveLength(1));
    fake.list(page([], null, "s2", { removedIds: [msg(2).id] }));
    await store.poll(signal());
    expect(store.getState().thread?.status).toBe("removed");
    loading.resolve({ data: page([reply(11, msg(2).id)], null, "t1", { thread: msg(2).id }) });
    await opening;
    expect(store.getState().thread).toMatchObject({ status: "removed", parent: null });
  });
});
