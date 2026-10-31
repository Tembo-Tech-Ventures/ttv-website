import { afterEach, describe, expect, it, vi } from "vitest";
import { attentionDatabase, allSpaces } from "./test-support";
import { getAttentionCount } from "./count";
import { ATTENTION_PAGE_SIZE, AttentionCursorError, listAttention, markAttentionRead } from "./service";
import { Cursor } from "@/lib/platform/contracts";

afterEach(() => vi.useRealTimers());
const userId = "synthetic-wanjiku";
describe("attention storage", () => {
  it("supports the contract's100 IDs and large cohort scopes within D1's100-parameter limit", async () => {
    const s = attentionDatabase();
    try {
      const ids = Array.from({ length: 100 }, (_, i) => "notice-" + i);
      for (const id of ids) s.seed(id);
      s.queries.length = 0;
      const result = await markAttentionRead(s.db, userId, { ids }, { ...allSpaces, cohortIds: Array.from({ length: 150 }, (_, i) => "cohort-" + i) });
      expect(result.count).toBe(0);
      expect(s.queries).toHaveLength(2);
      for (const query of s.queries) expect(query.match(/\?/g)?.length ?? 0).toBeLessThan(100);
    } finally { s.database.close(); }
  });

  it("keeps cursors within the contract for maximum-length Unicode identities and item IDs", async () => {
    const s = attentionDatabase();
    try {
      const owner = "雪".repeat(255);
      s.database.prepare("INSERT INTO user(id,name,email) VALUES (?,'Wanjiku Njeri','unicode@example.test')").run(owner);
      s.database.prepare("INSERT INTO studentProfile(id,userId,handle) VALUES (?,?,?)").run(owner, owner, "unicode");
      for (let i = 0; i < 31; i++) s.seed("雪".repeat(252) + String(i).padStart(3, "0"), { userId: owner });
      const page = await listAttention(s.db, owner, {}, allSpaces);
      expect(Cursor.safeParse(page.nextCursor).success).toBe(true);
      expect((await listAttention(s.db, owner, { cursor: page.nextCursor! }, allSpaces)).items).toHaveLength(1);
    } finally { s.database.close(); }
  });

  it("handles deleted actors and malformed legacy display metadata without losing the item", async () => {
    const s = attentionDatabase();
    try {
      s.seed("own");
      s.database.exec("UPDATE attention_item SET actorId='synthetic-otieno'; UPDATE user SET name='  ', image='javascript:bad' WHERE id='synthetic-otieno'");
      expect((await listAttention(s.db, userId, {}, allSpaces)).items[0].actor).toMatchObject({ name: "Member", avatarUrl: null });
      s.database.exec("DELETE FROM user WHERE id='synthetic-otieno'");
      expect((await listAttention(s.db, userId, {}, allSpaces)).items[0].actor).toBeNull();
    } finally { s.database.close(); }
  });
  it("counts unread owned items in one indexed query with all six keys", async () => {
    const s = attentionDatabase();
    try {
      s.seed("own", { space: "cohort" }); s.seed("profile", { space: "profile" }); s.seed("read", { readAt: 2000 });
      s.seed("other", { userId: "synthetic-otieno" });
      s.queries.length = 0;
      expect(await getAttentionCount(s.db, userId, allSpaces)).toEqual({ count: 2, unreadCounts: {
        cohort: 1, community: 0, mentoring: 0, discover: 0, admin: 0, profile: 1,
      } });
      expect(s.queries).toHaveLength(1);
      const plan = s.explain(0);
      expect(JSON.stringify(plan)).toContain("INDEX attention_item_unread_idx");
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
      const first = await listAttention(s.db, userId, { filter: "updates" }, allSpaces);
      expect(first.items).toHaveLength(ATTENTION_PAGE_SIZE);
      expect(s.queries).toHaveLength(1);
      const plan = s.explain(0);
      expect(JSON.stringify(plan)).toContain("attention_item_filter_page_idx");
      expect(JSON.stringify(plan)).not.toContain("TEMP B-TREE");
      s.seed("new", { createdAt: 5000 }); vi.setSystemTime(6000);
      const next = await listAttention(s.db, userId, { filter: "updates", cursor: first.nextCursor! }, allSpaces);
      expect(next.snapshotAt).toBe(4999); expect(next.nextCursor).toBeNull();
      expect(new Set([...first.items, ...next.items].map(i => i.id)).size).toBe(33);
      expect(next.items).toHaveLength(3);
      await expect(listAttention(s.db, "synthetic-otieno", { filter: "updates", cursor: first.nextCursor! }, allSpaces)).rejects.toBeInstanceOf(AttentionCursorError);
      await expect(listAttention(s.db, userId, { cursor: first.nextCursor! }, allSpaces)).rejects.toBeInstanceOf(AttentionCursorError);
      await expect(listAttention(s.db, userId, { cursor: "not-json" }, allSpaces)).rejects.toBeInstanceOf(AttentionCursorError);
    } finally { s.database.close(); }
  });

  it("uses the unfiltered paging index and returns only owned rows", async () => {
    const s = attentionDatabase();
    try {
      s.seed("own"); s.seed("other", { userId: "synthetic-otieno" }); s.queries.length = 0;
      const page = await listAttention(s.db, userId, {}, allSpaces);
      expect(page.items.map(i => i.id)).toEqual(["own"]);
      const plan = s.explain(0);
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
      expect((await markAttentionRead(s.db, userId, { ids: ["own /%雪", "other", "missing"] }, allSpaces)).count).toBe(1);
      expect(s.queries).toHaveLength(2);
      vi.setSystemTime(6000);
      expect((await markAttentionRead(s.db, userId, { ids: ["own /%雪"] }, allSpaces)).count).toBe(1);
      expect(s.database.prepare("SELECT readAt FROM attention_item WHERE id=?").get("own /%雪")).toEqual({ readAt: 5000 });
      expect((await getAttentionCount(s.db, "synthetic-otieno", allSpaces)).count).toBe(1);
    } finally { s.database.close(); }
  });

  it("mark-all preserves items arriving at or after the snapshot request", async () => {
    vi.useFakeTimers(); vi.setSystemTime(5000);
    const s = attentionDatabase();
    try {
      s.seed("old"); const page = await listAttention(s.db, userId, {}, allSpaces);
      s.seed("same-ms-arrival", { createdAt: 5000 });
      vi.setSystemTime(6000); s.seed("later", { createdAt: 6000 });
      expect((await markAttentionRead(s.db, userId, { through: page.snapshotAt }, allSpaces)).count).toBe(2);
      expect((await markAttentionRead(s.db, userId, { through: Number.MAX_SAFE_INTEGER }, allSpaces)).count).toBe(1);
    } finally { s.database.close(); }
  });
});
