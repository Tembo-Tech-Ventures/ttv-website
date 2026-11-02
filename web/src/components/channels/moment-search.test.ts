import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionClipEmbed } from "@/lib/platform/contracts";
import { createMomentSearch, MAX_MOMENT_QUERY, MOMENT_SEARCH_DEBOUNCE_MS, type MomentFinder, type MomentSearchState } from "./moment-search";

const clip = (quote: string): SessionClipEmbed => ({
  type: "sessionClip", recordingId: "rec1", title: "Session 4 · Joins", startSeconds: 754, durationSeconds: 60, quote,
});

/** A finder whose answers the test releases by hand, one deferred promise per call. */
function manualFinder() {
  const calls: { query: string; signal: AbortSignal; resolve: (clips: SessionClipEmbed[]) => void; reject: (error: unknown) => void }[] = [];
  const find: MomentFinder = (query, signal) => new Promise((resolve, reject) => {
    calls.push({ query, signal, resolve, reject });
  });
  return { find, calls };
}

describe("moment search (QA2-02)", () => {
  let states: MomentSearchState[];
  const record = (state: MomentSearchState) => void states.push(state);

  beforeEach(() => {
    vi.useFakeTimers();
    states = [];
  });
  afterEach(() => vi.useRealTimers());

  it("asks once per pause in the typing, with the trimmed words", async () => {
    const { find, calls } = manualFinder();
    const search = createMomentSearch(find, record);
    search.search("j");
    search.search("jo");
    search.search(" joins ");
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(MOMENT_SEARCH_DEBOUNCE_MS);
    expect(calls.map((call) => call.query)).toEqual(["joins"]);
    calls[0].resolve([clip("Left joins keep every row on the left.")]);
    await vi.runAllTimersAsync();
    expect(states.at(-1)).toEqual({ status: "found", query: "joins", clips: [clip("Left joins keep every row on the left.")] });
  });

  it("aborts the request in flight when the words change, and ignores its late answer", async () => {
    const { find, calls } = manualFinder();
    const search = createMomentSearch(find, record);
    search.search("joins");
    await vi.advanceTimersByTimeAsync(MOMENT_SEARCH_DEBOUNCE_MS);
    search.search("left joins");
    expect(calls[0].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(MOMENT_SEARCH_DEBOUNCE_MS);
    calls[1].resolve([clip("Left joins keep every row on the left.")]);
    calls[0].resolve([clip("An old answer.")]);
    await vi.runAllTimersAsync();
    expect(states.filter((state) => state.status === "found")).toEqual([
      { status: "found", query: "left joins", clips: [clip("Left joins keep every row on the left.")] },
    ]);
  });

  it("offers the recent sessions again, without asking, once the box is cleared", async () => {
    const { find, calls } = manualFinder();
    const search = createMomentSearch(find, record);
    search.search("joins");
    await vi.advanceTimersByTimeAsync(MOMENT_SEARCH_DEBOUNCE_MS);
    search.search("   ");
    expect(calls).toHaveLength(1);
    expect(calls[0].signal.aborted).toBe(true);
    expect(states.at(-1)).toEqual({ status: "idle" });
  });

  it("says a search failed, and can try the same words again", async () => {
    const { find, calls } = manualFinder();
    const search = createMomentSearch(find, record);
    search.search("joins");
    await vi.advanceTimersByTimeAsync(MOMENT_SEARCH_DEBOUNCE_MS);
    calls[0].reject(new Error("offline"));
    await vi.runAllTimersAsync();
    expect(states.at(-1)).toEqual({ status: "failed", query: "joins" });
    search.retry();
    expect(calls.map((call) => call.query)).toEqual(["joins", "joins"]);
    expect(states.at(-1)).toEqual({ status: "searching", query: "joins" });
  });

  it("stops everything when the finder closes", async () => {
    const { find, calls } = manualFinder();
    const search = createMomentSearch(find, record);
    search.search("joins");
    search.dispose();
    await vi.advanceTimersByTimeAsync(MOMENT_SEARCH_DEBOUNCE_MS);
    expect(calls).toHaveLength(0);
    search.search("retries");
    await vi.advanceTimersByTimeAsync(MOMENT_SEARCH_DEBOUNCE_MS);
    search.dispose();
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("keeps a query within the server's limit", async () => {
    const { find, calls } = manualFinder();
    createMomentSearch(find, record).search("a".repeat(MAX_MOMENT_QUERY + 50));
    await vi.advanceTimersByTimeAsync(MOMENT_SEARCH_DEBOUNCE_MS);
    expect(calls[0].query).toHaveLength(MAX_MOMENT_QUERY);
  });
});
