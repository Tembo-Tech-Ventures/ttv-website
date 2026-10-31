// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionCount, AttentionList } from "../contracts";
import { attention, attentionCount } from "../fixtures";
import { createAttentionMockClient } from "./attention.mock";
import { createAttentionStore, selectAttentionBadge, selectAttentionCount } from "./attention";
import { createApiClient } from "./apiClient";
import { createMockTransport, type MockReply } from "./mockTransport";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const counts = (count = 4): AttentionCount => ({ count, unreadCounts: { ...attentionCount.unreadCounts, cohort: count, community: 0 } });
const page = (items = attention.items, nextCursor: string | null = null): AttentionList => ({ items, nextCursor, snapshotAt: attention.snapshotAt });
const tick = async () => { await vi.advanceTimersByTimeAsync(0); };
const denied = (status = 403): MockReply => ({ status, data: { error: { code: status === 404 ? "flag_off" : "forbidden", message: "Denied" } } });
function harness(options: { initialList?: AttentionList; maxItems?: number; enabled?: boolean; initialCounts?: AttentionCount } = {}) {
  const getCount = vi.fn<() => MockReply | Promise<MockReply>>(() => ({ data: counts() }));
  const getList = vi.fn<(request: Request) => MockReply | Promise<MockReply>>(() => ({ data: page() }));
  const mark = vi.fn<(request: Request) => MockReply | Promise<MockReply>>(() => ({ data: counts(0) }));
  const api = createApiClient({ retry: { maxRetries: 0 }, fetch: createMockTransport([
    { method: "GET", path: "/api/attention/count", reply: () => getCount() },
    { method: "GET", path: "/api/attention", reply: ({ request }) => getList(request) },
    { method: "POST", path: "/api/attention/read", reply: ({ request }) => mark(request) },
  ]) });
  const store = createAttentionStore({ enabled: true, api, initialCounts: attentionCount, ...options });
  return { store, getCount, getList, mark };
}

describe("attention state", () => {
  beforeEach(() => { vi.useFakeTimers(); Object.defineProperty(document, "hidden", { configurable: true, value: false }); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("defaults OFF, makes no requests and zero-fills all badges", async () => {
    const fetch = vi.fn(); const store = createAttentionStore({ api: createApiClient({ fetch }) });
    store.start(); await store.refresh(); await store.loadMore(); await store.refreshCounts();
    expect(await store.markRead({ through: 999 })).toBe(false); expect(fetch).not.toHaveBeenCalled();
    expect(store.getState().counts).toEqual({ count: 0, unreadCounts: { cohort: 0, community: 0, mentoring: 0, discover: 0, admin: 0, profile: 0 } });
    expect(selectAttentionCount(store.getState())).toBe(0); expect(selectAttentionBadge("admin")(store.getState())).toBe(0);
    store.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it("polls at 30s, backs off idle counts, resumes focus and pauses hidden tabs", async () => {
    const { store, getCount } = harness({ initialCounts: undefined }); store.start(); await tick(); expect(getCount).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000); expect(getCount).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(59_999); expect(getCount).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(getCount).toHaveBeenCalledTimes(3);
    Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(600_000); expect(getCount).toHaveBeenCalledTimes(3);
    Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange"));
    await tick(); expect(getCount).toHaveBeenCalledTimes(4); window.dispatchEvent(new Event("focus")); await tick(); expect(getCount).toHaveBeenCalledTimes(5);
    store.stop(); await vi.advanceTimersByTimeAsync(600_000); expect(getCount).toHaveBeenCalledTimes(5);
  });

  it("does not overlap slow counts and discards hidden responses across restart", async () => {
    const { store, getCount } = harness({ initialCounts: undefined }); const slow = deferred<MockReply>(); getCount.mockReturnValueOnce(slow.promise);
    store.start(); await tick(); window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(90_000); expect(getCount).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); await tick();
    slow.resolve({ data: counts(999) }); await tick(); expect(store.getState().counts.count).toBe(0);
    store.stop(); Object.defineProperty(document, "hidden", { configurable: true, value: false }); store.start(); await tick();
    expect(getCount).toHaveBeenCalledTimes(2); expect(store.getState().counts.count).toBe(4); store.stop();
  });

  it("deduplicates/reorders/bounds pages and sends an opaque cursor once", async () => {
    const items = attention.items; const { store, getList } = harness({ maxItems: 4 });
    getList.mockReturnValueOnce({ data: page([items[2], items[0], items[0]], "older/+%?=") }); await store.refresh();
    getList.mockReturnValueOnce({ data: page([items[1], { ...items[0], summary: "Updated" }, ...items.slice(3)], "older/+%?=") });
    await Promise.all([store.loadMore(), store.loadMore()]); expect(getList).toHaveBeenCalledTimes(2);
    expect(new URL(getList.mock.calls[1][0].url).searchParams.get("cursor")).toBe("older/+%?=");
    expect(store.getState().items.map(item => item.id)).toEqual(items.slice(0, 4).map(item => item.id));
    expect(store.getState().items[0].summary).toBe("Updated"); expect(store.getState().nextCursor).toBeNull();
    await store.loadMore(); expect(getList).toHaveBeenCalledTimes(2); store.stop();
  });

  it("ignores stale filter responses and resets cursor for a new filter", async () => {
    const { store, getList } = harness(); const slow = deferred<MockReply>(); getList.mockReturnValueOnce(slow.promise);
    const old = store.refresh(); await tick(); getList.mockReturnValueOnce({ data: page([attention.items[1]]) }); await store.setFilter("mentions");
    slow.resolve({ data: page() }); await old; expect(store.getState().filter).toBe("mentions"); expect(store.getState().items).toHaveLength(1);
    const query = new URL(getList.mock.calls[1][0].url).searchParams;
    expect(query.get("filter")).toBe("mentions"); expect(query.has("cursor")).toBe(false);
    await store.setFilter("mentions"); expect(getList).toHaveBeenCalledTimes(2); store.stop();
  });

  it.each([401, 403, 404, 500])("surfaces HTTP %s and preserves the page for retry", async status => {
    const { store, getList } = harness({ initialList: page([attention.items[0]], "page2") }); getList.mockReturnValueOnce(denied(status));
    await store.loadMore(); expect(store.getState().listError?.status).toBe(status);
    expect(store.getState().items).toHaveLength(1); expect(store.getState().nextCursor).toBe("page2");
    await store.loadMore(); expect(store.getState().listError).toBeNull(); store.stop();
  });

  it("rejects malformed list/count responses without clearing counts", async () => {
    const { store, getCount, getList } = harness(); getCount.mockReturnValueOnce({ data: { count: 1 } });
    await expect(store.refreshCounts()).rejects.toMatchObject({ code: "invalid_response" });
    expect(store.getState().countError?.code).toBe("invalid_response"); expect(store.getState().counts).toEqual(attentionCount);
    getList.mockReturnValueOnce({ data: { items: [] } }); await store.refresh(); expect(store.getState().listError?.code).toBe("invalid_response"); store.stop();
  });

  it("marks duplicated IDs once, rolls back failure and retries to server truth", async () => {
    const { store, mark } = harness({ initialList: attention }); const slow = deferred<MockReply>(); mark.mockReturnValueOnce(slow.promise);
    const pending = store.markRead({ ids: [attention.items[0].id, attention.items[0].id] }); await tick();
    expect(store.getState().counts.count).toBe(3); expect(store.getState().counts.unreadCounts.community).toBe(1); expect(store.getState().items[0].readAt).not.toBeNull();
    slow.resolve(denied()); expect(await pending).toBe(false); expect(store.getState().items[0].readAt).toBeNull(); expect(store.getState().counts).toEqual(attentionCount);
    const failed = store.getState().failed[0]; expect(failed.error.status).toBe(403);
    mark.mockReturnValueOnce({ data: counts(17) }); expect(await store.retry(failed.id)).toBe(true);
    expect(store.getState().counts).toEqual(counts(17)); expect(store.getState().failed).toHaveLength(0); expect(await store.retry(-1)).toBe(false); store.stop();
  });

  it("serializes overlapping writes and rolls back only the failed overlay", async () => {
    const { store, mark } = harness({ initialList: attention }); const one = deferred<MockReply>(); const two = deferred<MockReply>();
    mark.mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise);
    const a = store.markRead({ ids: [attention.items[0].id, attention.items[1].id] });
    const b = store.markRead({ ids: [attention.items[0].id, attention.items[2].id] }); await tick();
    expect(mark).toHaveBeenCalledTimes(1); expect(store.getState().counts.count).toBe(1);
    one.resolve(denied(500)); await a; await tick(); expect(mark).toHaveBeenCalledTimes(2); expect(store.getState().counts.count).toBe(2);
    expect(store.getState().items[1].readAt).toBeNull(); expect(store.getState().items[0].readAt).not.toBeNull();
    two.resolve({ data: counts(9) }); await b; expect(store.getState().counts).toEqual(counts(9)); expect(store.getState().items[2].readAt).not.toBeNull(); store.stop();
  });

  it("reconciles a successful write under another overlay without double subtraction", async () => {
    const { store, mark } = harness({ initialList: attention }); const one = deferred<MockReply>(); const two = deferred<MockReply>(); mark.mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise);
    const a = store.markRead({ ids: [attention.items[0].id] }); const b = store.markRead({ ids: [attention.items[0].id, attention.items[1].id] }); await tick();
    one.resolve({ data: { count: 3, unreadCounts: { ...attentionCount.unreadCounts, community: 1 } } }); await a;
    expect(store.getState().counts.count).toBe(2); expect(store.getState().counts.unreadCounts.community).toBe(1);
    two.resolve({ data: counts(8) }); await b; expect(store.getState().counts.count).toBe(8); store.stop();
  });

  it("leaves post-snapshot arrivals unread even when loaded during mark-all", async () => {
    const first = attention.items[0]; const old = attention.items[1]; const { store, mark, getList } = harness({ initialList: page([old]) });
    const slow = deferred<MockReply>(); mark.mockReturnValueOnce(slow.promise); const pending = store.markRead({ through: old.createdAt });
    getList.mockReturnValueOnce({ data: page([first, old]) }); await store.refresh();
    expect(store.getState().items[0].readAt).toBeNull(); expect(store.getState().items[1].readAt).not.toBeNull();
    slow.resolve({ data: counts(1) }); await pending; expect(store.getState().items[0].readAt).toBeNull(); expect(store.getState().items[1].readAt).not.toBeNull(); store.stop();
  });

  it("discards stale counts, retries invalidated pages and preserves acknowledged state", async () => {
    const { store, getCount, getList } = harness({ initialList: attention }); const slow = deferred<MockReply>(); const list = deferred<MockReply>();
    getCount.mockReturnValueOnce(slow.promise); getList.mockReturnValueOnce(list.promise);
    const countRun = store.refreshCounts().catch(() => false); const listRun = store.refresh(); await tick(); await store.markRead({ ids: [attention.items[0].id] });
    slow.resolve({ data: counts(99) }); list.resolve({ data: page() }); await Promise.all([countRun, listRun]);
    expect(store.getState().counts.count).toBe(0); expect(store.getState().items[0].readAt).not.toBeNull();
    getList.mockReturnValueOnce({ data: page() }); await store.refresh(); expect(store.getState().items[0].readAt).not.toBeNull(); store.stop();
  });

  it("aborts reads/writes, rolls back overlays, skips queued writes and restarts", async () => {
    const { store, getList, mark } = harness({ initialList: attention }); const slow = deferred<MockReply>(); const list = deferred<MockReply>();
    mark.mockReturnValueOnce(slow.promise); getList.mockReturnValueOnce(list.promise);
    const a = store.markRead({ ids: [attention.items[0].id] }); const b = store.markRead({ ids: [attention.items[1].id] }); const c = store.refresh(); await tick();
    store.stop(); expect(mark.mock.calls[0][0].signal.aborted).toBe(true); expect(getList.mock.calls[0][0].signal.aborted).toBe(true);
    expect(store.getState().counts).toEqual(attentionCount); expect(store.getState().pending).toHaveLength(0);
    slow.resolve({ data: counts(99) }); list.resolve({ data: page([]) }); await Promise.all([a, b, c]); expect(mark).toHaveBeenCalledTimes(1); expect(store.getState().items).toHaveLength(6);
    store.start(); await tick(); expect(await store.markRead({ through: attention.snapshotAt })).toBe(true); expect(store.getState().counts.count).toBe(0); store.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds failure history and validates input without mutating fixtures", async () => {
    const original = JSON.stringify(attention); const { store, mark } = harness({ initialList: attention }); mark.mockReturnValue(denied());
    for (let i = 0; i < 25; i++) await store.markRead({ through: attention.snapshotAt }); expect(store.getState().failed).toHaveLength(20);
    store.dismissFailure(store.getState().failed[0].id); expect(store.getState().failed).toHaveLength(19); expect(() => store.markRead({ ids: [] })).toThrow(/Too small/);
    expect(JSON.stringify(attention)).toBe(original); store.stop(); expect(() => createAttentionStore({ maxItems: 0 })).toThrow(RangeError);
    expect(createAttentionStore({ initialList: attention, maxItems: 2 }).getState().truncated).toBe(true);
  });

  it("provides isolated fixture mocks with filtering and read reconciliation", async () => {
    const a = createAttentionStore({ enabled: true, mock: createAttentionMockClient() }); const b = createAttentionStore({ enabled: true, mock: createAttentionMockClient() });
    await a.refresh(); await a.refreshCounts(); expect(a.getState().counts).toEqual(attentionCount); await a.markRead({ through: attention.snapshotAt }); expect(a.getState().counts.count).toBe(0);
    await a.setFilter("mentions"); expect(a.getState().items.every(item => ["mention", "reply", "tembo_answer"].includes(item.kind))).toBe(true);
    await b.refreshCounts(); expect(b.getState().counts.count).toBe(4); a.stop(); b.stop();
  });
  it("preserves optimistic badge deltas through filter eviction and rollback", async () => {
    const { store, mark, getList } = harness({ initialList: attention }); const slow = deferred<MockReply>();
    mark.mockReturnValueOnce(slow.promise); const pending = store.markRead({ ids: [attention.items[0].id] });
    getList.mockReturnValueOnce({ data: page([attention.items[1]]) }); await store.setFilter("mentions");
    expect(store.getState().counts.count).toBe(3); expect(store.getState().counts.unreadCounts.community).toBe(1);
    slow.resolve(denied()); await pending; expect(store.getState().counts).toEqual(attentionCount); store.stop();
  });

  it("bounds queued writes and cancels them without issuing requests after teardown", async () => {
    const { store, mark } = harness({ initialList: attention }); const slow = deferred<MockReply>(); mark.mockReturnValueOnce(slow.promise);
    const requests = Array.from({ length: 100 }, () => store.markRead({ ids: [attention.items[0].id] }));
    expect(await store.markRead({ through: attention.snapshotAt })).toBe(false); expect(store.getState().pending).toHaveLength(100);
    await tick(); store.stop(); await Promise.all(requests); expect(mark).toHaveBeenCalledTimes(1);
    slow.resolve({ data: counts(0) });
  });

  it("backs off polling failures and does not start hidden", async () => {
    const { store, getCount } = harness({ initialCounts: undefined }); getCount.mockReturnValueOnce(denied(500));
    Object.defineProperty(document, "hidden", { configurable: true, value: true }); store.start(); await tick(); expect(getCount).not.toHaveBeenCalled();
    Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); await tick();
    expect(store.getState().countError?.status).toBe(500); expect(store.getState().counts.count).toBe(0);
    await vi.advanceTimersByTimeAsync(59_999); expect(getCount).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(getCount).toHaveBeenCalledTimes(2); expect(store.getState().countError).toBeNull(); store.stop();
  });

  it("forwards cancellation and never encodes opaque body IDs", async () => {
    const id = "synthetic/member%2Fid/+?="; const item = { ...attention.items[0], id };
    const { store, mark, getCount } = harness({ initialList: page([item]) });
    await store.markRead({ ids: [id] }); expect(await mark.mock.calls[0][0].json()).toEqual({ ids: [id] });
    const slow = deferred<MockReply>(); getCount.mockReturnValueOnce(slow.promise); const controller = new AbortController();
    const pending = store.refreshCounts(controller.signal); await tick(); controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" }); expect(store.getState().countError).toBeNull();
    slow.resolve({ data: counts(99) }); store.stop();
  });

  it("preserves the first-page mark-all snapshot while loading older pages", async () => {
    const { store, getList } = harness();
    getList.mockReturnValueOnce({ data: page([attention.items[0]], "older") }); await store.refresh();
    getList.mockReturnValueOnce({ data: { ...page([attention.items[1]]), snapshotAt: attention.snapshotAt + 1000 } }); await store.loadMore();
    expect(store.getState().snapshotAt).toBe(attention.snapshotAt);
    getList.mockReturnValueOnce({ data: { ...page([]), snapshotAt: attention.snapshotAt + 2000 } }); await store.refresh();
    expect(store.getState().snapshotAt).toBe(attention.snapshotAt + 2000); expect(store.getState().items).toHaveLength(0); store.stop();
  });

  it("aborts a shared manual count flight when its polling owner becomes hidden", async () => {
    const { store, getCount } = harness({ initialCounts: undefined }); const slow = deferred<MockReply>(); getCount.mockReturnValueOnce(slow.promise);
    const manual = store.refreshCounts().catch(error => error); await tick(); store.start(); await tick(); expect(getCount).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange"));
    expect(await manual).toMatchObject({ code: "aborted" }); expect(store.getState().countError).toBeNull(); store.stop(); slow.resolve({ data: counts(99) });
  });

  it.each([false, true])("retries an in-flight page invalidated by mark-read (older=%s)", async older => {
    const first = attention.items[0]; const second = attention.items[1];
    const { store, getList } = harness({ initialList: older ? page([first], "p2") : undefined });
    const slow = deferred<MockReply>();
    const target = older ? second : first;
    getList.mockReturnValueOnce(slow.promise).mockReturnValueOnce({ data: page([{ ...target, readAt: 123 }], "p3") });
    const loading = older ? store.loadMore() : store.refresh(); await tick();
    await store.markRead({ ids: [target.id] }); slow.resolve({ data: page([target], "p3") }); await loading;
    expect(getList).toHaveBeenCalledTimes(2); expect(store.getState().loaded).toBe(true); expect(store.getState().listError).toBeNull();
    expect(store.getState().items.find(item => item.id === target.id)?.readAt).toBe(123); expect(store.getState().nextCursor).toBe("p3");
    const queries = getList.mock.calls.map(([request]) => new URL(request.url).searchParams.get("cursor"));
    expect(queries).toEqual(older ? ["p2", "p2"] : [null, null]); store.stop();
  });

  it("bounds page retries under repeated mutations and exposes a retryable error", async () => {
    const { store, getList } = harness();
    const pending = Array.from({ length: 3 }, () => deferred<MockReply>());
    pending.forEach(response => getList.mockReturnValueOnce(response.promise));
    const loading = store.refresh(); await tick();
    for (let i = 0; i < 3; i++) {
      await store.markRead({ ids: [attention.items[0].id] }); pending[i].resolve({ data: page() }); await tick();
    }
    await loading; expect(getList).toHaveBeenCalledTimes(3); expect(store.getState().listError?.code).toBe("stale_page");
    expect(store.getState().loaded).toBe(false); expect(store.getState().loading).toBe(false);
    await store.refresh(); expect(store.getState().loaded).toBe(true); expect(store.getState().listError).toBeNull(); store.stop();
  });

  it("defers a hydrated first count by 30s, retains focus refresh, and cleans up warmup", async () => {
    const { store, getCount } = harness(); store.start(); store.start(); await tick(); expect(getCount).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(29_999); expect(getCount).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1); expect(getCount).toHaveBeenCalledTimes(1); store.stop();
    const next = harness(); next.store.start(); window.dispatchEvent(new Event("focus")); await tick(); expect(next.getCount).toHaveBeenCalledTimes(1); next.store.stop();
    const cancelled = harness(); cancelled.store.start(); cancelled.store.stop(); await vi.advanceTimersByTimeAsync(30_000); expect(cancelled.getCount).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([401, 403, 404])("pauses terminal HTTP %s polling until an explicit resume", async status => {
    const { store, getCount } = harness({ initialCounts: undefined }); getCount.mockReturnValueOnce(denied(status)); store.start(); await tick();
    expect(store.getState().countError?.status).toBe(status);
    window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(3_600_000); expect(getCount).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    await store.refreshCounts(); expect(getCount).toHaveBeenCalledTimes(2); expect(store.getState().countError).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000); expect(getCount).toHaveBeenCalledTimes(3); store.stop();
    getCount.mockReturnValueOnce(denied(status)); store.start(); await tick();
    await vi.advanceTimersByTimeAsync(3_600_000); expect(getCount).toHaveBeenCalledTimes(4);
    store.start(); await tick(); expect(getCount).toHaveBeenCalledTimes(5); store.stop();
  });

  it("stops pagination at the memory window and exposes truncation", async () => {
    const { store, getList } = harness({ maxItems: 2 });
    getList.mockReturnValueOnce({ data: page([attention.items[0]], "p2") }); await store.refresh();
    getList.mockReturnValueOnce({ data: page([attention.items[1]], "p3") }); await store.loadMore();
    expect(store.getState().truncated).toBe(true); expect(store.getState().nextCursor).toBeNull();
    await store.loadMore(); expect(getList).toHaveBeenCalledTimes(2); expect(store.getState().items).toHaveLength(2); store.stop();
  });

  it("keeps array/count selectors stable and announces only later arrivals with correct grammar", async () => {
    const { store, getCount } = harness({ initialCounts: undefined, initialList: attention });
    const items = store.getState().items; await store.refreshCounts(); const originalCounts = store.getState().counts;
    expect(store.getState().items).toBe(items); expect(store.getState().announcement).toBe("");
    await store.refreshCounts(); expect(store.getState().counts).toBe(originalCounts); expect(store.getState().items).toBe(items);
    getCount.mockReturnValueOnce({ data: counts(5) }); await store.refreshCounts(); expect(store.getState().announcement).toBe("1 new attention item");
    getCount.mockReturnValueOnce(denied(500)); await expect(store.refreshCounts()).rejects.toMatchObject({ status: 500 });
    getCount.mockReturnValueOnce({ data: counts(5) }); await store.refreshCounts(); expect(store.getState().announcement).toBe(""); store.stop();
  });

  it("keeps the 30s active cadence while writes are pending", async () => {
    const { store, getCount, mark } = harness({ initialList: attention }); const slow = deferred<MockReply>(); mark.mockReturnValueOnce(slow.promise);
    store.start(); const pending = store.markRead({ ids: [attention.items[0].id] }); await tick();
    await vi.advanceTimersByTimeAsync(90_000); expect(getCount).not.toHaveBeenCalled();
    slow.resolve({ data: counts(3) }); await pending;
    await vi.advanceTimersByTimeAsync(30_000); expect(getCount).toHaveBeenCalledTimes(1); store.stop();
  });

});
