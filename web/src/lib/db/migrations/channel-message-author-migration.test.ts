import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

const migration = readMigration("0030_channel_message_author.sql");

describe("channel message author index migration", () => {
  it("chains metadata with only the one index addition", () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
    const before = read("./meta/0029_snapshot.json");
    const after = read("./meta/0030_snapshot.json");
    expect(after.prevId).toBe(before.id);
    expect(after.tables.channel_message.indexes.channel_message_author_idx).toEqual({
      name: "channel_message_author_idx", columns: ["authorId", "createdAt"], isUnique: false,
      where: "\"channel_message\".\"authorId\" IS NOT NULL",
    });
    delete after.tables.channel_message.indexes.channel_message_author_idx;
    expect(after.tables).toEqual(before.tables);
    expect(after.views).toEqual(before.views);
    expect(read("./meta/_journal.json").entries.find((entry: { idx: number }) => entry.idx === 30))
      .toMatchObject({ tag: "0030_channel_message_author" });
  });

  it("applies to a populated schema, preserves data, reapplies safely and serves the rate-limit counts", () => {
    const { database } = createSqliteD1();
    try {
      for (const file of readdirSync(new URL("./", import.meta.url)).filter((n) => n.endsWith(".sql") && n < "0030").toSorted()) {
        database.exec(readMigration(file));
      }
      database.exec(`INSERT INTO "user"(id,name,email) VALUES ('wanjiku','Wanjiku Kamau','wanjiku@example.test');
        INSERT INTO channel_message(id, channelId, seq, changeSeq, authorId, body, createdAt)
          SELECT 'm1', id, 1, 1, 'wanjiku', 'Habari', 100 FROM channel WHERE slug = 'help';
        INSERT INTO channel_message(id, channelId, parentId, seq, changeSeq, authorKind, authorId, body, createdAt)
          SELECT 't1', id, 'm1', 2, 2, 'TEMBO', NULL, 'An answer', 200 FROM channel WHERE slug = 'help';`);
      const snapshot = () => database.prepare("SELECT * FROM channel_message ORDER BY id").all();
      const existing = snapshot();
      database.exec(migration);
      database.exec(migration);
      expect(snapshot()).toEqual(existing);

      const plan = (sql: string, ...values: (string | number)[]) => database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values)
        .map((row) => String(row.detail)).join("\n");
      expect(plan("SELECT COUNT(*) FROM channel_message WHERE authorId = ? AND createdAt > ?", "wanjiku", 0))
        .toContain("channel_message_author_idx (authorId=? AND createdAt>?)");
      expect(plan("SELECT COUNT(*) FROM channel_message WHERE authorId = ? AND createdAt > ? AND channelId = ?", "wanjiku", 0, "channel"))
        .toContain("channel_message_author_idx (authorId=? AND createdAt>?)");
      // Tembo's answers have no author and are left out of the partial index.
      expect(database.prepare("SELECT COUNT(*) AS n FROM channel_message INDEXED BY channel_message_author_idx WHERE authorId IS NOT NULL").get())
        .toEqual({ n: 1 });
    } finally { database.close(); }
  });
});
