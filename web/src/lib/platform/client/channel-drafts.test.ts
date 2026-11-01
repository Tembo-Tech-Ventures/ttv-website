import { describe, expect, it, vi } from "vitest";
import {
  boundRecord, CHANNEL_DRAFT_PREFIX, channelDraftKey, clearChannelDrafts, clearOtherUsersChannelDrafts, draftScope,
  EMPTY_RECORD, MAX_DRAFT_SCOPES, MAX_STORED_SENDS, readChannelDrafts, writeChannelDrafts, type ChannelDraftRecord,
  type DraftStorage,
} from "./channel-drafts";

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
const throwing = (): DraftStorage => ({
  length: 1, key: () => { throw new Error("blocked"); }, getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); },
});
const KEY = channelDraftKey("user-1", "channel-1");
const draft = (body: string, updatedAt = 1) => ({ body, embeds: [], updatedAt });
const send = (n: number) => ({ clientNonce: `nonce-${n}`, parentId: null, body: `Message ${n}`, embeds: [], createdAt: n });

describe("channel drafts storage", () => {
  it("keys drafts by user and channel, and scopes by thread", () => {
    expect(KEY).toBe(`${CHANNEL_DRAFT_PREFIX}user-1:channel-1`);
    expect(channelDraftKey("a:b", "c")).toBe(`${CHANNEL_DRAFT_PREFIX}a%3Ab:c`);
    expect(draftScope(null)).toBe("root");
    expect(draftScope("m1")).toBe("thread:m1");
  });

  it("round-trips a record and removes the key once nothing is left", () => {
    const storage = memoryStorage();
    const record: ChannelDraftRecord = {
      drafts: { root: { body: "Habari", embeds: [{ type: "project", journeyId: "j1", version: 2 }], updatedAt: 5 } },
      sends: [send(1)],
    };
    expect(writeChannelDrafts(storage, KEY, record)).toBe(true);
    expect(readChannelDrafts(storage, KEY)).toEqual(record);
    expect(writeChannelDrafts(storage, KEY, EMPTY_RECORD)).toBe(true);
    expect(storage.data.size).toBe(0);
    expect(readChannelDrafts(storage, KEY)).toBe(EMPTY_RECORD);
  });

  it("drops corrupt, oversized or unexpected data", () => {
    for (const raw of ["{not json", JSON.stringify({ drafts: { "bad scope": draft("x") }, sends: [] }), "x".repeat(300_000)]) {
      const storage = memoryStorage({ [KEY]: raw });
      expect(readChannelDrafts(storage, KEY)).toBe(EMPTY_RECORD);
      expect(storage.data.size).toBe(0);
    }
    const extra = memoryStorage({ [KEY]: JSON.stringify({ drafts: { root: { ...draft("hi"), secret: 1 } }, sends: [], other: true }) });
    expect(readChannelDrafts(extra, KEY)).toEqual({ drafts: { root: draft("hi") }, sends: [] });
  });

  it("keeps the newest thread drafts and sends, and leaves out empty drafts", () => {
    const drafts = Object.fromEntries(Array.from({ length: MAX_DRAFT_SCOPES + 5 }, (_, i) => [draftScope(`m${i}`), draft(`reply ${i}`, i)]));
    const bounded = boundRecord({
      drafts: { ...drafts, root: draft("", 99), [draftScope("empty")]: draft("", 100) },
      sends: Array.from({ length: MAX_STORED_SENDS + 3 }, (_, i) => send(i)),
    });
    expect(Object.keys(bounded.drafts)).toHaveLength(MAX_DRAFT_SCOPES);
    expect(bounded.drafts).not.toHaveProperty("thread:m0");
    expect(bounded.drafts).toHaveProperty(`thread:m${MAX_DRAFT_SCOPES + 4}`);
    expect(bounded.sends.map(item => item.createdAt)[0]).toBe(3);
    expect(boundRecord({ drafts: { root: draft("kept", 0), ...drafts }, sends: [] }).drafts).toHaveProperty("root");
  });

  it("refuses records it could not read back, and survives blocked storage", () => {
    const storage = memoryStorage({ [KEY]: "old" });
    const huge = { drafts: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [draftScope(`m${i}`), draft("x".repeat(10_000), i)])), sends: [] };
    const sends = Array.from({ length: 20 }, (_, i) => ({ ...send(i), body: "y".repeat(10_000) }));
    expect(writeChannelDrafts(storage, KEY, { ...huge, sends })).toBe(false);
    expect(storage.data.size).toBe(0);
    expect(writeChannelDrafts(storage, KEY, { drafts: {}, sends: [{ ...send(1), clientNonce: "not a nonce!" }] })).toBe(false);
    expect(writeChannelDrafts(undefined, KEY, EMPTY_RECORD)).toBe(false);
    expect(writeChannelDrafts(throwing(), KEY, { drafts: { root: draft("x") }, sends: [] })).toBe(false);
    expect(readChannelDrafts(undefined, KEY)).toBe(EMPTY_RECORD);
    expect(readChannelDrafts(throwing(), KEY)).toBe(EMPTY_RECORD);
  });

  it("clears every user's channel drafts on sign-out, and only channel drafts", () => {
    const storage = memoryStorage({ [KEY]: "{}", [channelDraftKey("user-2", "c")]: "{}", "ttv-onboarding-drafts:user-1": "{}" });
    clearChannelDrafts(storage);
    expect([...storage.data.keys()]).toEqual(["ttv-onboarding-drafts:user-1"]);
    expect(() => clearChannelDrafts(throwing())).not.toThrow();
    expect(() => clearChannelDrafts(undefined)).not.toThrow();
  });

  it("defaults to this tab's sessionStorage, and does nothing without a window", () => {
    const storage = memoryStorage({ [KEY]: "{}" });
    vi.stubGlobal("window", { sessionStorage: storage });
    clearChannelDrafts();
    expect(storage.data.size).toBe(0);
    vi.stubGlobal("window", undefined);
    expect(() => clearChannelDrafts()).not.toThrow();
    vi.unstubAllGlobals();
  });

  it("removes other accounts' drafts but keeps this person's", () => {
    const mine = channelDraftKey("user-1", "c2");
    const storage = memoryStorage({ [KEY]: "{}", [mine]: "{}", [channelDraftKey("user-10", "c")]: "{}", other: "x" });
    clearOtherUsersChannelDrafts(storage, "user-1");
    expect([...storage.data.keys()].toSorted()).toEqual([KEY, mine, "other"].toSorted());
    expect(() => clearOtherUsersChannelDrafts(throwing(), "user-1")).not.toThrow();
    expect(() => clearOtherUsersChannelDrafts(undefined, "user-1")).not.toThrow();
  });
});
