// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, ChannelList } from "../contracts";
import { channelList, channels } from "../fixtures";
import { createApiClient } from "./apiClient";
import {
  channelSpace, createChannelListStore, selectChannelUnread, selectChannelUnreadTotal, selectSpaceChannels,
  selectSpaceChannelUnread,
} from "./channelList";
import { createMockTransport, type MockReply } from "./mockTransport";

const withUnread = (channel: Channel, unreadCount: number): Channel => ({ ...channel, unreadCount });

function server(...replies: (MockReply | (() => Promise<MockReply>))[]) {
  const signals: AbortSignal[] = [];
  const api = createApiClient({ retry: { maxRetries: 0 }, fetch: createMockTransport([{ method: "GET", path: "/api/channels", reply: ({ request }) => {
    signals.push(request.signal);
    const next = replies.shift() ?? { data: channelList };
    return typeof next === "function" ? next() : next;
  } }]) });
  return { api, signals };
}
const list = (items: Channel[]): MockReply => ({ data: { items } satisfies ChannelList });

describe("channel list store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });
  afterEach(() => { vi.useRealTimers(); });

  it("groups unread by space: cohort channels to Cohort, community channels and conversations to Community", () => {
    const store = createChannelListStore({ initial: channelList });
    const state = store.getState();
    expect(channelSpace(channels.cohort04)).toBe("cohort");
    expect(channelSpace(channels.davidConversation)).toBe("community");
    expect(selectSpaceChannelUnread("cohort")(state)).toBe(2);
    expect(selectSpaceChannelUnread("community")(state)).toBe(3 + 12 + 1);
    expect(selectSpaceChannelUnread("mentoring")(state)).toBe(0);
    expect(selectChannelUnreadTotal(state)).toBe(18);
    expect(selectChannelUnread(channels.help.id)(state)).toBe(3);
    expect(selectChannelUnread("unknown")(state)).toBe(0);
    expect(selectSpaceChannels("cohort")(state).map(channel => channel.slug)).toEqual(["cohort-04", "c04-help", "c04-announcements"]);
    expect(store.getServerSnapshot().loaded).toBe(true);
  });

  it("does nothing while disabled", async () => {
    const fake = server();
    const store = createChannelListStore({ api: fake.api });
    const release = store.retain();
    expect(await store.refresh()).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fake.signals).toHaveLength(0);
    release();
  });

  it("polls every 30 s, backs off when unchanged and pauses while hidden", async () => {
    const fake = server(list(channelList.items), list(channelList.items), list(channelList.items),
      list([withUnread(channels.help, 4), ...channelList.items.slice(1)]));
    const store = createChannelListStore({ enabled: true, api: fake.api });
    const release = store.retain();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.signals).toHaveLength(1);
    expect(store.getState()).toMatchObject({ loaded: true, loading: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.signals).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fake.signals).toHaveLength(3);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fake.signals).toHaveLength(3);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.signals).toHaveLength(4);
    release();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fake.signals).toHaveLength(4);
  });

  it("waits one interval before polling when hydrated", async () => {
    const fake = server();
    const store = createChannelListStore({ enabled: true, api: fake.api, initial: channelList });
    const release = store.retain();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fake.signals).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.signals).toHaveLength(1);
    release();
    const again = store.retain();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.signals).toHaveLength(2);
    again();
    // Released before the warm-up ends: nothing starts.
    const late = createChannelListStore({ enabled: true, api: fake.api, initial: channelList });
    late.retain()();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.signals).toHaveLength(2);
  });

  it("keeps a read marker over an older list response that was already in flight", async () => {
    let resolve!: (reply: MockReply) => void;
    const fake = server(() => new Promise(r => { resolve = r; }), list(channelList.items.map(channel => withUnread(channel, 0))));
    const store = createChannelListStore({ enabled: true, api: fake.api, initial: channelList });
    const refreshing = store.refresh();
    await vi.advanceTimersByTimeAsync(0);
    store.applyRead({ channelId: channels.help.id, lastReadMessageId: "m1", unreadCount: 0 });
    store.applyRead({ channelId: "unknown", lastReadMessageId: "m1", unreadCount: 0 });
    const before = store.getState();
    store.applyRead({ channelId: channels.help.id, lastReadMessageId: "m1", unreadCount: 0 });
    expect(store.getState()).toBe(before);
    resolve(list(channelList.items));
    expect(await refreshing).toBe(false);
    expect(selectChannelUnread(channels.help.id)(store.getState())).toBe(0);
    expect(selectChannelUnread(channels.opportunities.id)(store.getState())).toBe(12);
    // A list requested after the read is authoritative again.
    expect(await store.refresh()).toBe(true);
    expect(selectChannelUnreadTotal(store.getState())).toBe(0);
  });

  it("shares one request and stops polling on access or flag failures until a refresh succeeds", async () => {
    const fake = server({ status: 503, data: { error: { code: "server", message: "Down" } } },
      { status: 404, data: { error: { code: "flag_off", message: "Off" } } });
    const store = createChannelListStore({ enabled: true, api: fake.api });
    const first = store.refresh();
    expect(store.refresh()).toBe(first);
    await expect(first).rejects.toMatchObject({ code: "server" });
    expect(store.getState()).toMatchObject({ terminal: false, loading: false });
    const release = store.retain();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState()).toMatchObject({ terminal: true });
    expect(store.getState().error?.code).toBe("flag_off");
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fake.signals).toHaveLength(2);
    expect(await store.refresh()).toBe(true);
    expect(store.getState()).toMatchObject({ terminal: false, error: null });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fake.signals.length).toBeGreaterThan(3);
    release();
  });

  it("aborts its request when released and when the caller's signal aborts", async () => {
    const fake = server(() => new Promise<never>(() => {}), () => new Promise<never>(() => {}));
    const store = createChannelListStore({ enabled: true, api: fake.api });
    const release = store.retain();
    await vi.advanceTimersByTimeAsync(0);
    release();
    expect(fake.signals[0].aborted).toBe(true);
    expect(store.getState().loading).toBe(false);
    const other = createChannelListStore({ enabled: true, api: fake.api });
    const controller = new AbortController();
    controller.abort();
    await expect(other.refresh(controller.signal)).rejects.toMatchObject({ code: "aborted" });
    expect(other.getState().error).toBeNull();
  });
});
