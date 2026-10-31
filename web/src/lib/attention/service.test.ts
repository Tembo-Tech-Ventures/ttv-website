import { afterEach, describe, expect, it, vi } from "vitest";
import { attentionDatabase } from "./test-support";
import { getAttentionCount } from "./count";
import { ATTENTION_PAGE_SIZE, AttentionCursorError, listAttention, markAttentionRead } from "./service";

afterEach(() => vi.useRealTimers());
const userId = "synthetic-wanjiku";
describe("attention storage", () => {
  it("counts unread owned items in one indexed query with all six keys", async () => {
    const s = attentionDatabase();
    try {
      s.seed("own"); s.seed("profile", { space: "profile" }); s.seed("read", { readAt: 2000 });
      s.seed("other", { userId: "synthetic-otieno" });
      s.queries.length = 0;
      expect(await getAttentionCount(s.db, userId)).toEqual({ count: 2, unreadCounts: {
        cohort: 1, community: 0, mentoring: 0, discover: 0, admin: 0, profile: 1,
      } });
      expect(s.queries).toHaveLength(1);
      const plan = s.database.prepare("EXPLAIN QUERY PLAN " + s.queries[0]).all(userId);
      expect(JSON.stringify(plan)).toContain("COVERING INDEX attention_item_unread_idx");
      expect(JSON.stringify(plan)).not.toContain("TEMP B-TREE");
    } finally { s.database.close(); }
  });

  it("pages same-timestamp opaque IDs once, keeping the original snapshot and filter", async () => {
    vi.useFakeTimers(); vi.setSystemTime(5000);
    const s = attentionDatabase();
    try {
      for (let i = 0; i < ATTENTION_PAGE_SIZE + 3; i++) s.seed(`legacy /%雪-${i}`);
      s.seed("mention", { category: "mentions" }); s.seed("other", { userId: "synthetic-otieno" });
      s.queries.length = 0;
      const first = await listAttention(s.db, userId, { filter: "updates" });
      expect(first.items).toHaveLength(ATTENTION_PAGE_SIZE);
      expect(s.queries).toHaveLength(1);
      const plan = s.database.prepare("EXPLAIN QUERY PLAN " + s.queries[0]).all(userId, first.snapshotAt, "updates", 31);
      expect(JSON.stringify(plan)).toContain("attention_item_filter_page_idx");
      expect(JSON.stringify(plan)).not.toContain("TEMP B-TREE");
      s.seed("new", { createdAt: 5000 }); vi.setSystemTime(6000);
      const next = await listAttention(s.db, userId, { filter: "updates", cursor: first.nextCursor! });
      expect(next.snapshotAt).toBe(4999); expect(next.nextCursor).toBeNull();
      expect(new Set([...first.items, ...next.items].map(i => i.id)).size).toBe(33);
      expect(next.items).toHaveLength(3);
      await expect(listAttention(s.db, "synthetic-otieno", { filter: "updates", cursor: first.nextCursor! })).rejects.toBeInstanceOf(AttentionCursorError);
      await expect(listAttention(s.db, userId, { cursor: first.nextCursor! })).rejects.toBeInstanceOf(AttentionCursorError);
      await expect(listAttention(s.db, userId, { cursor: "not-json" })).rejects.toBeInstanceOf(AttentionCursorError);
    } finally { s.database.close(); }
  });

  it("uses the unfiltered paging index and returns only owned rows", async () => {
    const s = attentionDatabase();
    try {
      s.seed("own"); s.seed("other", { userId: "synthetic-otieno" }); s.queries.length = 0;
      const page = await listAttention(s.db, userId, {});
      expect(page.items.map(i => i.id)).toEqual(["own"]);
      const plan = s.database.prepare("EXPLAIN QUERY PLAN " + s.queries[0]).all(userId, page.snapshotAt, 31);
      expect(JSON.stringify(plan)).toContain("attention_item_page_idx");
      expect(JSON.stringify(plan)).not.toContain("TEMP B-TREE");
    } finally { s.database.close(); }
  });

  it("marks own IDs idempotently and returns the authoritative count", async () => {
    vi.useFakeTimers(); vi.setSystemTime(5000);
    const s = attentionDatabase();
    try {
      s.seed("own /%雪"); s.seed("remaining"); s.seed("other", { userId: "synthetic-otieno" });
      s.queries.length = 0;
      expect((await markAttentionRead(s.db, userId, { ids: ["own /%雪", "other", "missing"] })).count).toBe(1);
      expect(s.queries).toHaveLength(2);
      vi.setSystemTime(6000);
      expect((await markAttentionRead(s.db, userId, { ids: ["own /%雪"] })).count).toBe(1);
      expect(s.database.prepare("SELECT readAt FROM attention_item WHERE id=?").get("own /%雪")).toEqual({ readAt: 5000 });
      expect((await getAttentionCount(s.db, "synthetic-otieno")).count).toBe(1);
    } finally { s.database.close(); }
  });

  it("mark-all preserves items arriving at or after the snapshot request", async () => {
    vi.useFakeTimers(); vi.setSystemTime(5000);
    const s = attentionDatabase();
    try {
      s.seed("old"); const page = await listAttention(s.db, userId, {});
      s.seed("same-ms-arrival", { createdAt: 5000 });
      vi.setSystemTime(6000); s.seed("later", { createdAt: 6000 });
      expect((await markAttentionRead(s.db, userId, { through: page.snapshotAt })).count).toBe(2);
      expect((await markAttentionRead(s.db, userId, { through: Number.MAX_SAFE_INTEGER })).count).toBe(1);
    } finally { s.database.close(); }
  });
});
