// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSearchStore, useSearch } from "../search";
import { createApiClient } from "../apiClient";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("aborts on hidden/unmount, cancels hidden debounce and resumes visible", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
  const store = createSearchStore({ enabled: true, client: createApiClient({ fetch }) });
  const remove = vi.spyOn(document, "removeEventListener");
  function Harness() { return <span>{useSearch(store).status}</span>; }
  await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
  await act(async () => { store.setOpen(true); store.setQuery("test"); await vi.advanceTimersByTimeAsync(250); });
  expect(container.textContent).toBe("loading"); const first = fetch.mock.calls[0][1]!.signal!;
  await act(async () => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  expect(first.aborted).toBe(true); expect(store.getState().results).toBeNull();
  await act(async () => { store.setQuery("new"); await vi.advanceTimersByTimeAsync(1000); }); expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(250); });
  expect(fetch).toHaveBeenCalledTimes(2); const second = fetch.mock.calls[1][1]!.signal!;
  await act(async () => root.unmount()); expect(second.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(1000); expect(fetch).toHaveBeenCalledTimes(2);
  root = createRoot(container); remove.mockRestore();
});
it("keeps a shared store connected until the last consumer unmounts", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
  const store = createSearchStore({ enabled: true, client: createApiClient({ fetch }) });
  function Harness() { useSearch(store); return null; }
  await act(async () => root.render(<><Harness key="one" /><Harness key="two" /></>));
  await act(async () => { store.setOpen(true); store.setQuery("test"); await vi.advanceTimersByTimeAsync(250); });
  const signal = fetch.mock.calls[0][1]!.signal!;
  await act(async () => root.render(<Harness key="one" />)); expect(signal.aborted).toBe(false);
  await act(async () => root.unmount()); expect(signal.aborted).toBe(true); root = createRoot(container);
});

it("preserves completed results and selection across hidden/visible without refetching", async () => {
  const { searchResults } = await import("../../fixtures");
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ...searchResults, query: { q: "test", scope: "all" } }));
  const store = createSearchStore({ enabled: true, client: createApiClient({ fetch }) });
  function Harness() { useSearch(store); return null; }
  await act(async () => root.render(<Harness />));
  await act(async () => {
    store.setOpen(true);
    store.setQuery("test");
    await vi.advanceTimersByTimeAsync(250);
    store.key("Home");
  });
  const ready = store.getState();
  for (const hidden of [true, false]) {
    await act(async () => {
      Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
  expect(store.getState()).toBe(ready);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("cancels a pending debounce on hidden and restarts it when visible", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
  const store = createSearchStore({ enabled: true, client: createApiClient({ fetch }) });
  function Harness() { useSearch(store); return null; }
  await act(async () => root.render(<Harness />));
  await act(async () => {
    store.setOpen(true);
    store.setQuery("test");
    await vi.advanceTimersByTimeAsync(249);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
