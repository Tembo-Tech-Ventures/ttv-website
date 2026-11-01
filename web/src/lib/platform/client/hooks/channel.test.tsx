// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, Message, MessageList } from "../../contracts";
import { channelList, messages } from "../../fixtures";
import { createApiClient } from "../apiClient";
import { createChannelStore, type ChannelStore } from "../channel";
import { createChannelListStore } from "../channelList";
import { createMockTransport } from "../mockTransport";
import { useChannel, useChannelFeed, useChannelList, useChannelUnread, useSpaceChannels, useSpaceChannelUnread } from "./channel";

const CHANNEL = channelList.items[1].id;
const msg = (n: number): Message => ({ ...messages.projectPost, id: `m${String(n).padStart(4, "0")}`, channelId: CHANNEL, parentId: null, createdAt: n * 1_000 });
const page = (items: Message[], sinceCursor: string, beforeCursor: string | null = null): MessageList =>
  ({ items, beforeCursor, sinceCursor, thread: null, removedIds: [] });

/** Replies `since` polls with an empty delta unless a new message is queued. */
function feed() {
  const queries: URLSearchParams[] = [];
  const signals: AbortSignal[] = [];
  const queued: Message[] = [];
  let checkpoint = 0;
  let hold = false;
  const api = createApiClient({ retry: { maxRetries: 0 }, fetch: createMockTransport([
    { method: "GET", path: "/api/channels/:id/messages", reply: ({ request }) => {
      const query = new URL(request.url).searchParams;
      queries.push(query);
      signals.push(request.signal);
      if (hold) return new Promise<never>(() => {});
      if (!query.has("since")) return { data: page([msg(1), msg(2)], `s${checkpoint}`) };
      return { data: page(queued.splice(0), `s${++checkpoint}`) };
    } },
    { method: "POST", path: "/api/channels/:id/read", reply: async ({ request, params }) => {
      const body = await request.json() as { messageId: string };
      return { data: { channelId: params.id, lastReadMessageId: body.messageId, unreadCount: 0 } };
    } },
  ]) });
  return { api, queries, signals, queued, holdReplies: () => { hold = true; } };
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("channel hooks", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function View({ store }: { store: ChannelStore }) {
    useChannelFeed(store);
    const ids = useChannel(store, state => state.messages.map(item => item.id).join(","));
    const state = useChannel(store);
    return <span data-status={state.status}>{ids}</span>;
  }
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it("loads on mount, polls since every 5 s and backs off to 30 s while nothing changes", async () => {
    const server = feed();
    const store = createChannelStore({ channelId: CHANNEL, enabled: true, api: server.api });
    await act(async () => root.render(<StrictMode><View store={store} /></StrictMode>));
    await advance(0);
    expect(container.textContent).toBe(`${msg(1).id},${msg(2).id}`);
    const firstLoads = server.queries.filter(query => !query.has("since")).length;
    expect(firstLoads).toBe(1);
    const polls = () => server.queries.filter(query => query.has("since")).length;

    await advance(4_999);
    expect(polls()).toBe(0);
    await advance(1);
    expect(polls()).toBe(1);
    // Unchanged: 10 s, 20 s, then capped at 30 s.
    await advance(10_000);
    expect(polls()).toBe(2);
    await advance(20_000);
    expect(polls()).toBe(3);
    await advance(29_999);
    expect(polls()).toBe(3);
    await advance(1);
    expect(polls()).toBe(4);
    // A new message resets the cadence to 5 s.
    server.queued.push(msg(3));
    await advance(30_000);
    expect(container.textContent).toContain(msg(3).id);
    await advance(5_000);
    expect(polls()).toBe(6);
  });

  it("never polls while hidden and resumes immediately when visible", async () => {
    setHidden(true);
    const server = feed();
    const store = createChannelStore({ channelId: CHANNEL, enabled: true, api: server.api });
    await act(async () => root.render(<View store={store} />));
    await advance(120_000);
    expect(server.queries).toHaveLength(0);
    await act(async () => setHidden(false));
    await advance(0);
    expect(server.queries).toHaveLength(1);
    await advance(5_000);
    expect(server.queries).toHaveLength(2);

    await act(async () => setHidden(true));
    await advance(300_000);
    expect(server.queries).toHaveLength(2);
    await act(async () => setHidden(false));
    await advance(0);
    expect(server.queries).toHaveLength(3);
  });

  it("aborts an in-flight poll when the tab hides and when the view unmounts", async () => {
    const server = feed();
    const store = createChannelStore({ channelId: CHANNEL, enabled: true, api: server.api });
    await act(async () => root.render(<View store={store} />));
    await advance(0);
    server.holdReplies();
    await advance(5_000);
    expect(server.signals.at(-1)?.aborted).toBe(false);
    await act(async () => setHidden(true));
    expect(server.signals.at(-1)?.aborted).toBe(true);
    await act(async () => setHidden(false));
    await advance(0);
    const inFlight = server.signals.at(-1)!;
    expect(inFlight.aborted).toBe(false);
    await act(async () => root.render(<span />));
    expect(inFlight.aborted).toBe(true);
    const count = server.queries.length;
    await advance(120_000);
    expect(server.queries).toHaveLength(count);
  });

  it("does not poll when the channels flag is off or the feed is disabled", async () => {
    const server = feed();
    const off = createChannelStore({ channelId: CHANNEL, api: server.api });
    function Disabled({ store }: { store: ChannelStore }) { useChannelFeed(store, { enabled: false }); return null; }
    const on = createChannelStore({ channelId: CHANNEL, enabled: true, api: server.api });
    await act(async () => root.render(<><View store={off} /><Disabled store={on} /></>));
    await advance(60_000);
    expect(server.queries).toHaveLength(0);
  });

  it("wakes the poller when the window becomes live again", async () => {
    const server = feed();
    const initial = page(Array.from({ length: 50 }, (_, i) => msg(i + 1)), "s0", "b1");
    const store = createChannelStore({ channelId: CHANNEL, enabled: true, api: server.api, initial, maxMessages: 50, pageSize: 10 });
    await act(async () => root.render(<View store={store} />));
    await advance(0);
    act(() => store.setAnchor(msg(1).id));
    // New messages push the window over its limit; the anchored page stays and polling stops.
    server.queued.push(...Array.from({ length: 10 }, (_, i) => msg(100 + i)));
    // The mount poll found nothing, so the next one comes after the first backoff step.
    await advance(10_000);
    expect(store.getState().live).toBe(false);
    const stopped = server.queries.length;
    await advance(120_000);
    expect(server.queries).toHaveLength(stopped);
    await act(async () => { await store.jumpToLatest(); });
    await advance(0);
    expect(server.queries.length).toBe(stopped + 2);
    expect(server.queries.at(-1)?.has("since")).toBe(true);
  });

  it("shares channel unread counts with space badges and applies read markers", async () => {
    const server = feed();
    const listApi = createApiClient({ fetch: createMockTransport([{ method: "GET", path: "/api/channels", reply: () => ({ data: channelList }) }]) });
    const list = createChannelListStore({ enabled: true, api: listApi, initial: channelList });
    const target: Channel = channelList.items.find(channel => channel.unreadCount > 0 && channel.kind === "COMMUNITY")!;
    const store = createChannelStore({
      channelId: target.id, enabled: true, api: server.api, onRead: list.applyRead,
      initial: { ...page([msg(1), msg(2)], "s0"), items: [msg(1), msg(2)].map(item => ({ ...item, channelId: target.id })) },
    });
    function Badges() {
      const community = useSpaceChannelUnread(list, "community");
      const cohort = useSpaceChannelUnread(list, "cohort");
      const one = useChannelUnread(list, target.id);
      const names = useSpaceChannels(list, "cohort").map(channel => channel.slug).join(" ");
      const loaded = useChannelList(list, state => state.loaded);
      return <span>{`${community}|${cohort}|${one}|${names}|${loaded}`}</span>;
    }
    const sum = (kind: (channel: Channel) => boolean) => channelList.items.filter(kind).reduce((n, channel) => n + channel.unreadCount, 0);
    const community = sum(channel => channel.kind !== "COHORT");
    await act(async () => root.render(<Badges />));
    expect(container.textContent).toBe(`${community}|${sum(channel => channel.kind === "COHORT")}|${target.unreadCount}|cohort-04 c04-help c04-announcements|true`);
    await act(async () => { await store.markRead(msg(2).id); });
    expect(container.textContent?.startsWith(`${community - target.unreadCount}|`)).toBe(true);
    expect(container.textContent).toContain("|0|");
  });
});
