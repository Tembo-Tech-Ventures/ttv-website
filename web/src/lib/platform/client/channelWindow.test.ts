import { describe, expect, it } from "vitest";
import type { Message, MessageList } from "../contracts";
import { messages } from "../fixtures";
import {
  acceptsNew, appendNewer, compareMessages, evict, prependOlder, removeIds, segmentFromLatest, segmentIds,
  segmentMessages, segmentSize, type Segment,
} from "./channelWindow";

const msg = (n: number, createdAt = n * 1_000): Message =>
  ({ ...messages.projectPost, id: `m${String(n).padStart(4, "0")}`, createdAt, parentId: null });
const page = (items: Message[], beforeCursor: string | null, sinceCursor = "since"): MessageList =>
  ({ items, beforeCursor, sinceCursor, thread: null, removedIds: [] });
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));
const entitiesOf = (...lists: Message[][]) => new Map(lists.flat().map(item => [item.id, item]));
const ids = (segment: Segment) => segmentIds(segment).map(id => Number(id.slice(1)));

describe("channel window", () => {
  it("orders by creation time then id, independent of server page order", () => {
    const tie = { ...msg(2), id: "m0001b", createdAt: msg(2).createdAt };
    const shuffled = [msg(3), tie, msg(1), msg(2)];
    const segment = segmentFromLatest(page(shuffled, null), shuffled);
    expect(segmentMessages(segment, entitiesOf(shuffled)).map(item => item.id)).toEqual(["m0001", "m0001b", "m0002", "m0003"]);
    expect(compareMessages(msg(1), msg(1))).toBe(0);
  });

  it("drops duplicates within a page and across retained pages", () => {
    const latest = range(11, 20);
    const segment = segmentFromLatest(page([...latest, msg(20)], "b11"), latest);
    expect(segmentSize(segment)).toBe(10);
    const older = prependOlder(segment, page([...range(5, 10), msg(11), msg(12)], "b5"), [...range(5, 10), msg(11), msg(12)]);
    expect(ids(older)).toEqual([5, 6, 7, 8, 9, 10, ...Array.from({ length: 10 }, (_, i) => 11 + i)]);
    expect(older.olderCursor).toBe("b5");
    const newer = appendNewer(older, page([msg(20), msg(21)], null, "s2"), [msg(20), msg(21)], 50);
    expect(ids(newer).filter(n => n >= 20)).toEqual([20, 21]);
    expect(newer.sinceCursor).toBe("s2");
  });

  it("keeps the cursor of an empty older page and stops at the start of history", () => {
    const segment = segmentFromLatest(page(range(1, 3), "b1"), range(1, 3));
    const start = prependOlder(segment, page([], null), []);
    expect(start.pages).toBe(segment.pages);
    expect(start.olderCursor).toBeNull();
  });

  it("joins small deltas to the newest page and splits full ones that carry their own cursor", () => {
    let segment = segmentFromLatest(page(range(1, 3), "b1"), range(1, 3));
    segment = appendNewer(segment, page([msg(4)], "b4", "s1"), [msg(4)], 4);
    expect(segment.pages.map(p => p.ids.length)).toEqual([4]);
    segment = appendNewer(segment, page([msg(5)], "b5", "s2"), [msg(5)], 4);
    expect(segment.pages.map(p => p.before)).toEqual(["b1", "b5"]);
    // Without its own cursor a delta cannot be evicted on its own, so it joins the newest page.
    segment = appendNewer(segment, page(range(6, 9), null, "s3"), range(6, 9), 4);
    expect(segment.pages.map(p => p.ids.length)).toEqual([4, 5]);
    // An empty delta only advances the checkpoint.
    const empty = appendNewer(segment, page([], null, "s4"), [], 4);
    expect(empty.pages).toEqual(segment.pages);
    expect(empty.sinceCursor).toBe("s4");
    const fromEmpty = appendNewer(segmentFromLatest(page([], null), []), page([msg(1)], null, "s5"), [msg(1)], 4);
    expect(ids(fromEmpty)).toEqual([1]);
  });

  it("rejects polled messages that would open a gap before unloaded history", () => {
    const retained = range(10, 12);
    const entities = entitiesOf(retained);
    const partial = segmentFromLatest(page(retained, "b10"), retained);
    expect(acceptsNew(partial, entities, msg(5))).toBe(false);
    expect(acceptsNew(partial, entities, msg(11, 11_500))).toBe(true);
    expect(acceptsNew(partial, entities, msg(13))).toBe(true);
    const complete = segmentFromLatest(page(retained, null), retained);
    expect(acceptsNew(complete, entities, msg(5))).toBe(true);
    expect(acceptsNew(segmentFromLatest(page([], "b0"), []), entities, msg(5))).toBe(true);
    expect(acceptsNew({ ...partial, olderCursor: null, olderTrimmed: true }, entities, msg(5))).toBe(false);
    expect(acceptsNew(partial, new Map(), msg(5))).toBe(true);
  });

  it("removes tombstoned ids, dropping emptied pages but keeping cursors", () => {
    let segment = segmentFromLatest(page(range(3, 4), "b3"), range(3, 4));
    segment = prependOlder(segment, page(range(1, 2), "b1"), range(1, 2));
    expect(removeIds(segment, new Set(["zzz"]))).toBe(segment);
    expect(removeIds(segment, new Set())).toBe(segment);
    const removed = removeIds(segment, new Set([msg(1).id, msg(2).id, msg(4).id]));
    expect(ids(removed)).toEqual([3]);
    expect(removed.pages).toHaveLength(1);
    expect(removed.olderCursor).toBe("b1");
  });

  describe("eviction", () => {
    function long(pages: number, size = 10) {
      let segment = segmentFromLatest(page(range((pages - 1) * size + 1, pages * size), `b${(pages - 1) * size + 1}`),
        range((pages - 1) * size + 1, pages * size));
      for (let p = pages - 2; p >= 0; p--) {
        const items = range(p * size + 1, (p + 1) * size);
        segment = prependOlder(segment, page(items, p === 0 ? null : `b${p * size + 1}`), items);
      }
      return segment;
    }

    it("leaves a segment within the limit untouched", () => {
      const segment = long(3);
      expect(evict(segment, { maxMessages: 30, anchorId: null })).toBe(segment);
    });

    it("drops the oldest pages when reading the newest messages, keeping a cursor back to them", () => {
      const evicted = evict(long(5), { maxMessages: 25, anchorId: null });
      expect(ids(evicted)).toEqual(range(31, 50).map(m => Number(m.id.slice(1))));
      expect(evicted.olderCursor).toBe("b31");
      expect(evicted.live).toBe(true);
    });

    it("drops the newest pages when the anchor is far back, ending live polling", () => {
      const evicted = evict(long(5), { maxMessages: 25, anchorId: msg(5).id });
      expect(ids(evicted)).toEqual(range(1, 20).map(m => Number(m.id.slice(1))));
      expect(evicted.live).toBe(false);
      expect(evicted.olderCursor).toBeNull();
    });

    it("trims from the farther end around a middle anchor", () => {
      const evicted = evict(long(5), { maxMessages: 30, anchorId: msg(35).id });
      expect(ids(evicted)[0]).toBe(21);
      expect(ids(evicted).at(-1)).toBe(50);
      expect(segmentIds(evicted)).toContain(msg(35).id);
      const unknown = evict(long(5), { maxMessages: 25, anchorId: "missing" });
      expect(ids(unknown)[0]).toBe(31);
    });

    it("trims inside a single oversized page as a last resort, marking history unreachable", () => {
      const big = segmentFromLatest(page(range(1, 100), "b1"), range(1, 100));
      const newest = evict(big, { maxMessages: 60, anchorId: null });
      expect(ids(newest)[0]).toBe(41);
      expect(newest).toMatchObject({ olderCursor: null, olderTrimmed: true, live: true });
      const anchored = evict(big, { maxMessages: 60, anchorId: msg(10).id });
      expect(ids(anchored)).toEqual(range(10, 69).map(m => Number(m.id.slice(1))));
      expect(anchored).toMatchObject({ olderTrimmed: true, live: false });
      const nearEnd = evict(big, { maxMessages: 60, anchorId: msg(90).id });
      expect(ids(nearEnd)[0]).toBe(41);
      expect(nearEnd.live).toBe(true);
      const fromStart = evict(segmentFromLatest(page(range(1, 100), null), range(1, 100)), { maxMessages: 60, anchorId: msg(1).id });
      expect(fromStart).toMatchObject({ olderCursor: null, olderTrimmed: false, live: false });
    });

    it("restores a reachable cursor once a trimmed page is itself evicted", () => {
      let segment = evict(segmentFromLatest(page(range(1, 100), "b1"), range(1, 100)), { maxMessages: 60, anchorId: null });
      segment = appendNewer(segment, page(range(101, 160), "b101", "s"), range(101, 160), 50);
      const evicted = evict(segment, { maxMessages: 60, anchorId: null });
      expect(evicted).toMatchObject({ olderCursor: "b101", olderTrimmed: false });
      expect(segmentSize(evicted)).toBe(60);
    });
  });
});
