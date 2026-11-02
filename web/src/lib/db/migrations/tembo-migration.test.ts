import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

const migration = readMigration("0035_tembo.sql");

describe("Tembo migration", () => {
  it("chains metadata with only the three new tables", () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
    const before = read("./meta/0034_snapshot.json");
    const after = read("./meta/0035_snapshot.json");
    expect(after.prevId).toBe(before.id);
    expect(Object.keys(after.tables.tembo_usage.columns)).toEqual(["userId", "day", "count"]);
    expect(Object.keys(after.tables.tembo_ask.columns)).toEqual(
      ["messageId", "channelId", "userId", "day", "status", "claim", "answerId", "claimedAt", "createdAt", "updatedAt"]);
    expect(Object.keys(after.tables.tembo_feedback.columns)).toEqual(["messageId", "userId", "kind", "createdAt", "updatedAt"]);
    for (const table of ["tembo_usage", "tembo_ask", "tembo_feedback"]) delete after.tables[table];
    expect(after.tables).toEqual(before.tables);
    expect(read("./meta/_journal.json").entries.find((entry: { idx: number }) => entry.idx === 35)).toMatchObject({ tag: "0035_tembo" });
  });

  it("applies to a populated schema, reapplies safely, constrains and cascades", () => {
    const { database } = createSqliteD1();
    try {
      for (const file of readdirSync(new URL("./", import.meta.url)).filter((n) => n.endsWith(".sql") && n < "0035").toSorted()) {
        database.exec(readMigration(file));
      }
      database.exec(`INSERT INTO "user"(id,name,email) VALUES ('wanjiku','Wanjiku Kamau','w@example.test'),('otieno','Otieno Ouma','o@example.test')`);
      const help = (database.prepare("SELECT id FROM channel WHERE slug = 'help'").get() as { id: string }).id;
      const message = database.prepare(`INSERT INTO channel_message (id, channelId, parentId, seq, changeSeq, authorKind, authorId, body, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'text', 1)`);
      message.run("question", help, null, 1, 1, "USER", "wanjiku");
      message.run("answer", help, "question", 2, 2, "TEMBO", null);
      const existing = database.prepare("SELECT id, seq FROM channel_message ORDER BY id").all();
      database.exec(migration);
      database.exec(migration);
      expect(database.prepare("SELECT id, seq FROM channel_message ORDER BY id").all()).toEqual(existing);

      const usage = database.prepare("INSERT INTO tembo_usage (userId, day, count) VALUES (?, ?, ?)");
      usage.run("wanjiku", "2026-11-02", 1);
      expect(() => usage.run("wanjiku", "2026-11-02", 1)).toThrow(/UNIQUE|PRIMARY/);
      expect(() => usage.run("wanjiku", "2 Nov", 1)).toThrow(/CHECK/);
      expect(() => usage.run("wanjiku", "2026-11-03", -1)).toThrow(/CHECK/);
      expect(() => usage.run("nobody", "2026-11-03", 1)).toThrow(/FOREIGN KEY/);

      const ask = database.prepare(`INSERT INTO tembo_ask (messageId, channelId, userId, day, status, claim, answerId, claimedAt, createdAt, updatedAt)
        VALUES (?, ?, 'wanjiku', '2026-11-02', ?, 'claim', ?, 1, 1, 1)`);
      expect(() => ask.run("question", help, "PENDING", "answer")).toThrow(/CHECK/);
      expect(() => ask.run("question", help, "WAITING", null)).toThrow(/CHECK/);
      ask.run("question", help, "ANSWERED", "answer");
      expect(() => ask.run("question", help, "PENDING", null)).toThrow(/UNIQUE|PRIMARY/);

      const feedback = database.prepare("INSERT INTO tembo_feedback (messageId, userId, kind, createdAt, updatedAt) VALUES (?, ?, ?, 1, 1)");
      feedback.run("answer", "wanjiku", "helpful");
      feedback.run("answer", "otieno", "not_quite");
      expect(() => feedback.run("answer", "wanjiku", "not_quite")).toThrow(/UNIQUE|PRIMARY/);
      expect(() => feedback.run("answer", "otieno", "great")).toThrow(/CHECK/);

      const plan = database.prepare("EXPLAIN QUERY PLAN SELECT count FROM tembo_usage WHERE userId = ? AND day = ?").all("wanjiku", "2026-11-02")
        .map((row) => String(row.detail)).join("\n");
      expect(plan).toMatch(/USING (INDEX|PRIMARY KEY) sqlite_autoindex_tembo_usage_1 \(userId=\? AND day=\?\)/);

      // Deleting the answer keeps the question answered, with no answer; deleting a person removes their rows.
      database.exec("DELETE FROM channel_message WHERE id = 'answer'");
      expect(database.prepare("SELECT status, answerId FROM tembo_ask").all()).toEqual([{ status: "ANSWERED", answerId: null }]);
      expect(database.prepare("SELECT COUNT(*) AS n FROM tembo_feedback").get()).toEqual({ n: 0 });
      database.exec(`DELETE FROM "user" WHERE id = 'wanjiku'`);
      expect(database.prepare("SELECT COUNT(*) AS n FROM tembo_usage").get()).toEqual({ n: 0 });
      expect(database.prepare("SELECT COUNT(*) AS n FROM tembo_ask").get()).toEqual({ n: 0 });
    } finally { database.close(); }
  });
});
