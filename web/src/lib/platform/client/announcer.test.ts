import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnnouncer } from "./announcer";

describe("bounded aria-live announcement queue", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it("deduplicates by key and expires keys after the dedupe window", async () => {
    const a = createAnnouncer({ throttleMs: 100, dedupeMs: 200 }); const listener = vi.fn(); a.store.subscribe(listener);
    expect(a.announce("New message", "polite", "message-1")).toBe(true);
    expect(a.announce("Changed wording", "polite", "message-1")).toBe(false);
    expect(a.store.getState()).toMatchObject({ message: "New message", priority: "polite" });
    await vi.advanceTimersByTimeAsync(200);
    expect(a.announce("New message", "polite", "message-1")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2); a.dispose();
  });

  it("throttles a burst, prioritizes assertive messages, and leaves text until cleared", async () => {
    const a = createAnnouncer({ throttleMs: 100 }); const messages: string[] = [];
    a.store.subscribe(() => { const value = a.store.getState(); if (value) messages.push(value.message); });
    a.announce("one"); a.announce("two"); a.announce("urgent", "assertive"); a.announce("also urgent", "assertive");
    expect(messages).toEqual(["one"]);
    await vi.advanceTimersByTimeAsync(99); expect(messages).toEqual(["one"]);
    await vi.advanceTimersByTimeAsync(301); expect(messages).toEqual(["one", "urgent", "also urgent", "two"]);
    expect(vi.getTimerCount()).toBe(0); expect(a.store.getState()?.message).toBe("two");
    a.clear(); expect(a.store.getState()).toBeNull(); a.dispose();
  });

  it("bounds memory and cancels pending announcements on dispose", async () => {
    const a = createAnnouncer({ maxQueue: 2, throttleMs: 100 });
    a.announce("one"); a.announce("two"); a.announce("three"); expect(a.announce("four")).toBe(false);
    // Remembered keys are bounded too: an evicted key can be announced again.
    await vi.advanceTimersByTimeAsync(100);
    expect(a.announce("one")).toBe(true);
    await vi.advanceTimersByTimeAsync(100); expect(a.store.getState()?.message).toBe("three");
    a.announce("pending"); a.dispose(); await vi.runAllTimersAsync();
    expect(a.store.getState()).toBeNull(); expect(a.announce("later")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports overflow and permits retrying an unspoken announcement inside the dedupe window", async () => {
    const a = createAnnouncer({ maxQueue: 2, throttleMs: 100, dedupeMs: 10_000 });
    expect(["one", "two", "three", "four"].map(text => a.announce(text, "assertive"))).toEqual([true, true, true, false]);
    await vi.advanceTimersByTimeAsync(100);
    expect(a.announce("four", "assertive")).toBe(true);
    await vi.advanceTimersByTimeAsync(200); expect(a.store.getState()?.message).toBe("four");
    a.dispose();
  });

  it("releases the dedupe key of a polite entry evicted by an urgent announcement", async () => {
    const a = createAnnouncer({ maxQueue: 2, throttleMs: 100 });
    a.announce("now"); a.announce("polite one"); a.announce("polite two");
    expect(a.announce("urgent", "assertive")).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(a.announce("polite two")).toBe(true); a.dispose();
  });

  it("rejects blank text and handles reentrant subscribers", async () => {
    const a = createAnnouncer({ throttleMs: 100 });
    expect(a.announce("  ")).toBe(false);
    const stop = a.store.subscribe(() => { if (a.store.getState()?.message === "one") a.announce("two"); });
    a.announce("one"); expect(a.store.getState()?.message).toBe("one");
    await vi.advanceTimersByTimeAsync(100); expect(a.store.getState()?.message).toBe("two");
    stop(); a.dispose();
  });

  it.each([{ throttleMs: -1 }, { throttleMs: Infinity }, { dedupeMs: NaN }, { maxQueue: 0 }, { maxQueue: 1.5 }])("rejects invalid options %j", options => {
    expect(() => createAnnouncer(options)).toThrow(RangeError);
  });
});
