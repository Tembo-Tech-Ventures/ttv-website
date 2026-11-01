import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

const migration = readMigration("0026_chat_message_session_index.sql");

describe("chat message session index migration", () => {
  it("chains metadata with only the one index addition", () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
    const before = read("./meta/0025_snapshot.json");
    const after = read("./meta/0026_snapshot.json");
    expect(after.prevId).toBe(before.id);
    expect(after.tables.chat_message.indexes.chat_message_sessionId_createdAt_idx.columns).toEqual(["sessionId", "createdAt"]);
    delete after.tables.chat_message.indexes.chat_message_sessionId_createdAt_idx;
    expect(after.tables).toEqual(before.tables);
    expect(read("./meta/_journal.json").entries.find((entry: { idx: number }) => entry.idx === 26))
      .toMatchObject({ tag: "0026_chat_message_session_index" });
  });

  it("applies to populated historical schema, preserves data, safely reapplies and serves the lookups", () => {
    const { database } = createSqliteD1();
    try {
      for (const file of readdirSync(new URL("./", import.meta.url)).filter(n => n.endsWith(".sql") && n < "0026").toSorted()) database.exec(readMigration(file));
      database.exec(`INSERT INTO "user"(id,name,email) VALUES ('asker','Wanjiru Kamau','wanjiru@example.com');
        INSERT INTO chat_session(id,userId,title) VALUES ('conversation','asker','Pricing'),('empty','asker','Abandoned');
        INSERT INTO chat_message(id,sessionId,userId,role,content) VALUES
          ('question','conversation','asker','user','How do I price?'),('answer','conversation','asker','assistant','Start from value.'),
          ('legacy',NULL,'asker','user','Before sessions');`);
      const messages = database.prepare("SELECT * FROM chat_message ORDER BY id").all();
      const sessions = database.prepare("SELECT * FROM chat_session ORDER BY id").all();
      database.exec(migration); database.exec(migration);
      expect(database.prepare("SELECT * FROM chat_message ORDER BY id").all()).toEqual(messages);
      expect(database.prepare("SELECT * FROM chat_session ORDER BY id").all()).toEqual(sessions);
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(database.prepare("PRAGMA index_info('chat_message_sessionId_createdAt_idx')").all().map(r => r.name)).toEqual(["sessionId", "createdAt"]);
      const plan = (sql: string) => database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(r => String(r.detail)).join("\n");
      expect(plan(`SELECT 1 FROM chat_message cm WHERE cm.sessionId = 'empty'`)).toContain("chat_message_sessionId_createdAt_idx");
      expect(plan(`SELECT id FROM chat_message WHERE userId = 'asker' AND sessionId = 'conversation' ORDER BY createdAt`)).toContain("chat_message_sessionId_createdAt_idx");
    } finally { database.close(); }
  });
});
