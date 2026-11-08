// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { isSearchShortcut, onShellOverlay, requestShellOverlay, SHELL_OVERLAY_EVENT, UNCLAIMED_REQUEST_MS } from "./overlays";

const key = (overrides: Partial<KeyboardEventInit> = {}) =>
  new KeyboardEvent("keydown", { key: "k", ctrlKey: true, ...overrides });

describe("isSearchShortcut", () => {
  it("accepts Ctrl K and ⌘ K, in either case", () => {
    expect(isSearchShortcut(key())).toBe(true);
    expect(isSearchShortcut(key({ ctrlKey: false, metaKey: true }))).toBe(true);
    expect(isSearchShortcut(key({ key: "K" }))).toBe(true);
  });

  it("ignores a bare K, other modifiers and keys mid-composition", () => {
    expect(isSearchShortcut(key({ ctrlKey: false }))).toBe(false);
    expect(isSearchShortcut(key({ altKey: true }))).toBe(false);
    expect(isSearchShortcut(key({ shiftKey: true }))).toBe(false);
    expect(isSearchShortcut(key({ key: "j" }))).toBe(false);
    expect(isSearchShortcut({ ...key(), key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: true })).toBe(false);
  });
});

describe("overlay requests", () => {
  it("reach only the overlay they name, with the trigger and how it was asked", () => {
    const search = vi.fn();
    const attention = vi.fn();
    const stopSearch = onShellOverlay("search", search);
    const stopAttention = onShellOverlay("attention", attention);
    const trigger = document.createElement("button");

    requestShellOverlay({ overlay: "search", trigger, via: "shortcut" });
    expect(search).toHaveBeenCalledWith({ overlay: "search", trigger, via: "shortcut" });
    expect(attention).not.toHaveBeenCalled();

    stopSearch();
    requestShellOverlay({ overlay: "search", trigger: null, via: "click" });
    expect(search).toHaveBeenCalledTimes(1);
    stopAttention();
  });

  it("ignores unrelated events on the same name", () => {
    const handler = vi.fn();
    const stop = onShellOverlay("attention", handler);
    window.dispatchEvent(new CustomEvent(SHELL_OVERLAY_EVENT));
    window.dispatchEvent(new CustomEvent(SHELL_OVERLAY_EVENT, { detail: { overlay: "elsewhere" } }));
    expect(handler).not.toHaveBeenCalled();
    stop();
  });
});

describe("live attention counts", () => {
  const counts = (cohort: number) => ({ cohort, community: 0, mentoring: 0, discover: 0, admin: 0, profile: 0 });

  it("reach every subscriber, once per real change, and the latest is kept for late readers", async () => {
    const { latestAttentionCounts, publishAttentionCounts, subscribeAttentionCounts } = await import("./overlays");
    const listener = vi.fn();
    const stop = subscribeAttentionCounts(listener);
    publishAttentionCounts(counts(3));
    publishAttentionCounts(counts(3));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(latestAttentionCounts()?.cohort).toBe(3);
    publishAttentionCounts(counts(1));
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    publishAttentionCounts(counts(0));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(latestAttentionCounts()?.cohort).toBe(0);
  });
});

describe("a request made before its overlay listens (client:idle)", () => {
  /** Drops anything an earlier test left unclaimed, by letting it expire. */
  function freshStart() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + UNCLAIMED_REQUEST_MS + 1);
    onShellOverlay("search", () => {})();
    onShellOverlay("attention", () => {})();
  }
  const flush = () => new Promise<void>((resolve) => { queueMicrotask(resolve); });

  it("reaches the first listener that subscribes within a few seconds, once, with its trigger", async () => {
    freshStart();
    const trigger = document.createElement("button");
    requestShellOverlay({ overlay: "search", trigger, via: "shortcut" });
    vi.setSystemTime(Date.now() + UNCLAIMED_REQUEST_MS - 1);
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onShellOverlay("search", first);
    const stopSecond = onShellOverlay("search", second);
    await flush();
    expect(first).toHaveBeenCalledExactlyOnceWith({ overlay: "search", trigger, via: "shortcut" });
    expect(second).not.toHaveBeenCalled();
    stopFirst(); stopSecond();
    vi.useRealTimers();
  });

  it("is dropped once it is older than a person would expect it to open", async () => {
    freshStart();
    requestShellOverlay({ overlay: "attention", trigger: null, via: "click" });
    vi.setSystemTime(Date.now() + UNCLAIMED_REQUEST_MS + 1);
    const late = vi.fn();
    const stop = onShellOverlay("attention", late);
    await flush();
    expect(late).not.toHaveBeenCalled();
    stop();
    vi.useRealTimers();
  });

  it("is not held when its overlay is listening, nor handed to another overlay", async () => {
    freshStart();
    const listening = vi.fn();
    const stop = onShellOverlay("search", listening);
    requestShellOverlay({ overlay: "search", trigger: null, via: "click" });
    expect(listening).toHaveBeenCalledTimes(1);
    stop();
    const later = vi.fn();
    const stopLater = onShellOverlay("search", later);
    requestShellOverlay({ overlay: "attention", trigger: null, via: "click" });
    const other = vi.fn();
    const stopOther = onShellOverlay("search", other);
    await flush();
    expect(later).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    stopLater(); stopOther();
    vi.useRealTimers();
  });
});
