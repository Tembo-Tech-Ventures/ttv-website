import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { createSearchStore, SEARCH_GROUP_LIMIT, useSearch } from "../search";
import { searchSelectionReducer } from "../searchKeyboard";
import { boundRecentQueries, readRecentQueries, writeRecentQueries } from "../searchRecent";
import { createSearchMockClient } from "../searchMock";
import { createApiClient, type ApiClient } from "../apiClient";
import { SearchResults } from "../../contracts";
import { searchResults } from "../../fixtures";

const result = (q: string): SearchResults => ({ ...searchResults, query: { q, scope: "all" } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(fetch: typeof globalThis.fetch = vi.fn(async () => Response.json(result("test")))) {
  const store = createSearchStore({ enabled: true, client: createApiClient({ fetch, retry: { maxRetries: 0 } }) });
  const stop = store.connect(); store.setOpen(true); return { store, stop, fetch };
}

describe("search state", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("is SSR safe, starts OFF, and never touches transport/storage or hands off while disabled", async () => {
    const fetch = vi.fn(); const storage = vi.fn(() => { throw new Error("unavailable"); });
    const store = createSearchStore({ client: createApiClient({ fetch }), storage, recentStorageKey: "synthetic-user" });
    function Harness() { return createElement("span", null, useSearch(store).status); }
    expect(renderToString(createElement(Harness))).toBe("<span>idle</span>");
    const stop = store.connect(); store.setOpen(true); store.setQuery("test"); store.key("End");
    await vi.runAllTimersAsync();
    expect(fetch).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
    expect(store.select()).toBeNull(); expect(store.draftForAskTembo()).toBeNull();
    expect(store.getState().open).toBe(false); stop();
  });

  it("debounces, validates query encoding once, exposes every group and strips future messages", async () => {
    const q = "retry & % /? #";
    const fetch = vi.fn(async () => Response.json(result(q)));
    const { store, stop } = setup(fetch);
    store.setQuery("old"); await vi.advanceTimersByTimeAsync(249); expect(fetch).not.toHaveBeenCalled();
    store.setQuery(q); await vi.advanceTimersByTimeAsync(249); expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url, "https://test.invalid").searchParams.get("q")).toBe(q);
    expect(init.method).toBe("GET"); expect(init.credentials).toBe("same-origin");
    expect(store.getState().status).toBe("ready");
    expect(store.getState().results).toMatchObject({ messages: [], people: searchResults.people, projects: searchResults.projects, sessionMoments: searchResults.sessionMoments });
    expect(store.getState().items.map(x => x.group)).toEqual(["people", "projects", "sessionMoments"]);
    expect(store.getState().announcement).toBe("3 search results"); stop();
  });

  it("replaces cohort scope without double-encoding opaque ids and can clear it", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input), "https://test.invalid");
      return Response.json({ ...result("test"), query: Object.fromEntries(url.searchParams) });
    });
    const { store, stop } = setup(fetch); store.setQuery("test"); store.setScope("cohort", "legacy/%2F? #");
    await vi.advanceTimersByTimeAsync(250);
    expect(store.getState().results?.query).toEqual({ q: "test", scope: "cohort", programId: "legacy/%2F? #" });
    store.setScope("all"); expect(store.getState().results).toBeNull(); await vi.advanceTimersByTimeAsync(250);
    expect(store.getState().results?.query).toEqual({ q: "test", scope: "all" }); stop();
  });

  it("rejects late success and failure from a client that ignores cancellation", async () => {
    const old = deferred<SearchResults>();
    const current = deferred<SearchResults>();
    const lateFailure = deferred<SearchResults>();
    const call = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise).mockReturnValueOnce(lateFailure.promise);
    const client: ApiClient = { call };
    const store = createSearchStore({ enabled: true, client });
    const stop = store.connect();
    store.setOpen(true);
    store.setQuery("old");
    await vi.advanceTimersByTimeAsync(250);
    store.setQuery("new");
    await vi.advanceTimersByTimeAsync(250);
    current.resolve(result("new"));
    await vi.advanceTimersByTimeAsync(0);
    old.resolve(result("old"));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState()).toMatchObject({ status: "ready", results: { query: { q: "new" } }, error: null });
    store.setQuery("later");
    await vi.advanceTimersByTimeAsync(250);
    store.setOpen(false);
    // Rejection handlers in the store must also ignore a previous generation.
    // The client promise deliberately ignores AbortSignal.
    lateFailure.reject(new Error("late failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState()).toMatchObject({ status: "idle", results: null, error: null });
    stop();
  });

  it("preserves ready results and selection on repeated enable/open actions", async () => {
    const { store, stop, fetch } = setup();
    store.setQuery("test");
    await vi.advanceTimersByTimeAsync(250);
    store.key("Home");
    const ready = store.getState();
    store.setEnabled(true);
    store.setOpen(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState()).toBe(ready);
    expect(fetch).toHaveBeenCalledTimes(1);
    stop();
  });

  it("clears an old cohort filter when setQuery changes scope", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async input => Response.json({
      ...result("test"), query: Object.fromEntries(new URL(String(input), "https://test.invalid").searchParams),
    }));
    const { store, stop } = setup(fetch);
    store.setScope("cohort", "p1");
    store.setQuery("test", "people");
    await vi.advanceTimersByTimeAsync(250);
    expect(store.getState().results?.query).toEqual({ q: "test", scope: "people" });
    stop();
  });

  it.each([0, 1])("announces %i results grammatically", async count => {
    const fetch = vi.fn(async () => Response.json({ ...result("test"), people: searchResults.people.slice(0, count), projects: [], sessionMoments: [] }));
    const { store, stop } = setup(fetch);
    store.setQuery("test");
    await vi.advanceTimersByTimeAsync(250);
    expect(store.getState().announcement).toBe(count === 0 ? "No results" : "1 search result");
    stop();
  });

  it("aborts immediately on typing and ignores out-of-order responses from a transport ignoring abort", async () => {
    const old = deferred<Response>(); const next = deferred<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { store, stop } = setup(fetch);
    store.setQuery("old"); await vi.advanceTimersByTimeAsync(250);
    const oldSignal = fetch.mock.calls[0][1]!.signal!;
    store.setQuery("new"); expect(oldSignal.aborted).toBe(true); expect(store.getState().results).toBeNull();
    await vi.advanceTimersByTimeAsync(250); next.resolve(Response.json(result("new"))); await vi.advanceTimersByTimeAsync(0);
    old.resolve(Response.json(result("old"))); await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().results?.query.q).toBe("new"); expect(store.getState().error).toBeNull(); stop();
  });

  it.each([401, 403, 404, 500])("surfaces %i with no stale groups and supports explicit retry", async status => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ error: { code: status === 404 ? "flag_off" : "denied", message: "Unavailable" } }, { status }))
      .mockResolvedValueOnce(Response.json(result("test")));
    const { store, stop } = setup(fetch); store.setQuery("test"); await vi.advanceTimersByTimeAsync(250);
    expect(store.getState().error?.status).toBe(status); expect(store.getState().items).toEqual([]);
    expect(store.getState().announcement).toContain("failed"); store.retry(); await vi.advanceTimersByTimeAsync(250);
    expect(store.getState().status).toBe("ready"); stop();
  });

  it.each([{}, { ...result("test"), people: [{}] }, result("wrong query")])("rejects malformed or mismatched successful responses", async data => {
    const { store, stop } = setup(vi.fn(async () => Response.json(data)));
    store.setQuery("test"); await vi.advanceTimersByTimeAsync(250);
    expect(store.getState().status).toBe("error"); expect(store.getState().results).toBeNull(); stop();
  });

  it("handles network failure and validates before sending, including clearing whitespace", async () => {
    const fetch = vi.fn(async () => { throw new TypeError("offline"); }); const { store, stop } = setup(fetch);
    store.setQuery(" "); await vi.runAllTimersAsync(); expect(store.getState().status).toBe("idle");
    store.setQuery("x".repeat(502)); await vi.runAllTimersAsync(); expect(store.getState().error?.code).toBe("validation_error"); expect(fetch).not.toHaveBeenCalled();
    store.setQuery("test"); await vi.advanceTimersByTimeAsync(250); expect(store.getState().error?.code).toBe("network_error");
    store.setQuery(""); expect(store.getState().error).toBeNull(); stop();
  });

  it("bounds and deduplicates result groups, resets selection, and returns selected metadata", async () => {
    const people = Array.from({ length: 80 }, (_, i) => ({ ...searchResults.people[0], person: { ...searchResults.people[0].person, id: `synthetic-${i}` } }));
    const data = { ...result("test"), people: [...people, ...people], projects: [...searchResults.projects, ...searchResults.projects], sessionMoments: [...searchResults.sessionMoments, ...searchResults.sessionMoments] };
    const { store, stop } = setup(vi.fn(async () => Response.json(data))); store.setQuery("test"); await vi.advanceTimersByTimeAsync(250);
    expect(store.getState().results?.people).toHaveLength(SEARCH_GROUP_LIMIT); expect(store.getState().results?.projects).toHaveLength(1);
    expect(store.select()).toBeNull(); store.key("Home"); expect(store.select()).toMatchObject({ group: "people", item: { visibility: searchResults.people[0].visibility } });
    store.key("End"); expect(store.getState().selected).toBe(51); store.key("ArrowDown"); expect(store.getState().selected).toBe(51);
    store.setQuery("other"); expect(store.getState().selected).toBe(-1); expect(store.select()).toBeNull(); stop();
  });

  it("hands off only a local trimmed q without making a request or persisting drafts", () => {
    const fetch = vi.fn(); const { store, stop } = setup(fetch); store.setQuery("  retry webhook  ");
    expect(store.draftForAskTembo()).toEqual({ q: "retry webhook" }); expect(fetch).not.toHaveBeenCalled();
    expect(store.getState().recentQueries).toEqual([]);
    store.key("Escape"); expect(store.draftForAskTembo()).toBeNull(); expect(vi.getTimerCount()).toBe(0); stop();
  });

  it("aborts and clears on close, disconnect and flag disable, then can reconnect", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {})); const { store, stop } = setup(fetch);
    store.setQuery("test"); await vi.advanceTimersByTimeAsync(250);
    store.setOpen(false); expect(fetch.mock.calls[0][1]!.signal!.aborted).toBe(true);
    store.setOpen(true); await vi.advanceTimersByTimeAsync(250); stop(); stop();
    expect(fetch.mock.calls[1][1]!.signal!.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    const disconnect = store.connect(); await vi.advanceTimersByTimeAsync(250); store.setEnabled(false);
    expect(fetch.mock.calls[2][1]!.signal!.aborted).toBe(true); expect(store.getState()).toMatchObject({ open: false, q: "", recentQueries: [], items: [] }); disconnect();
  });

  it("supports explicit contract-validated fixture mode and never falls back to it on errors", async () => {
    const client = createSearchMockClient(); const query = { q: "test", scope: "all" as const };
    const store = createSearchStore({ enabled: true, mock: true }); const stop = store.connect(); store.setOpen(true); store.setQuery(query.q);
    await vi.advanceTimersByTimeAsync(250); // dynamic module resolution may need one event-loop turn
    await vi.waitFor(() => expect(store.getState().status).toBe("ready"));
    expect(SearchResults.safeParse(store.getState().results).success).toBe(true); expect(store.getState().results?.messages).toEqual([]);
    const { ROUTES } = await import("../../contracts");
    expect((await client.call(ROUTES.search, { query: { ...query, scope: "people" } })).sessionMoments).toEqual([]);
    expect((await client.call(ROUTES.search, { query: { ...query, programId: "unrelated" } })).sessionMoments).toEqual([]); stop();
  });
});

describe("selection boundaries", () => {
  it("clamps across all keys, empty collections and obsolete selection", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Home", "End", "Escape"] as const) expect(searchSelectionReducer(3, key, 0)).toBe(-1);
    expect(searchSelectionReducer(-1, "ArrowUp", 3)).toBe(2);
    expect(searchSelectionReducer(0, "ArrowUp", 3)).toBe(0);
    expect(searchSelectionReducer(-1, "ArrowDown", 3)).toBe(0);
    expect(searchSelectionReducer(100, "ArrowDown", 3)).toBe(2);
    expect(searchSelectionReducer(2, "Home", 3)).toBe(0);
    expect(searchSelectionReducer(0, "End", 3)).toBe(2);
    expect(searchSelectionReducer(2, "Escape", 3)).toBe(-1);
  });
});

describe("recent queries", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("bounds valid strings, trims and deduplicates, tolerates unavailable/corrupt storage", () => {
    expect(boundRecentQueries([" A ", "a", "", null, "x".repeat(501), ...Array.from({ length: 20 }, (_, i) => `q${i}`)])).toEqual(["A", "q0", "q1", "q2", "q3", "q4", "q5", "q6"]);
    for (const raw of ["bad json", "{}", "x".repeat(16_385)]) expect(readRecentQueries({ getItem: () => raw, setItem() {} }, "key")).toEqual([]);
    expect(readRecentQueries(undefined, "key")).toEqual([]);
    const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } };
    expect(readRecentQueries(blocked, "key")).toEqual([]); expect(() => writeRecentQueries(blocked, "key", ["query"])).not.toThrow();
  });

  it("persists only selected searches, never Tembo drafts, and clears per-user recents", async () => {
    const storage = { getItem: vi.fn(() => '["old"]'), setItem: vi.fn() };
    const client = createApiClient({ fetch: vi.fn(async () => Response.json(result("new"))) });
    const store = createSearchStore({ enabled: true, client, storage: () => storage, recentStorageKey: "synthetic-user" });
    expect(storage.getItem).not.toHaveBeenCalled();
    const stop = store.connect();
    store.setOpen(true);
    expect(store.getState().recentQueries).toEqual(["old"]);
    store.setQuery("private Tembo draft");
    expect(store.draftForAskTembo()).toEqual({ q: "private Tembo draft" });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(store.getState().recentQueries).toEqual(["old"]);
    store.setQuery("new");
    await vi.advanceTimersByTimeAsync(250);
    store.key("Home");
    store.select();
    expect(storage.setItem).toHaveBeenLastCalledWith("synthetic-user", '["new","old"]');
    store.clearRecent();
    expect(storage.setItem).toHaveBeenLastCalledWith("synthetic-user", "[]");
    store.setEnabled(false);
    store.setEnabled(true);
    expect(storage.getItem).toHaveBeenCalledTimes(2);
    stop();
  });

  it("survives an unavailable storage getter and invalid debounce configuration", () => {
    const store = createSearchStore({ enabled: true, recentStorageKey: "key", storage: () => { throw new Error("blocked"); } });
    const stop = store.connect(); store.setOpen(true); store.setQuery("new"); expect(store.draftForAskTembo()).toEqual({ q: "new" }); stop();
    for (const debounceMs of [-1, Infinity, NaN, 2_147_483_648]) expect(() => createSearchStore({ debounceMs })).toThrow(RangeError);
  });
});
