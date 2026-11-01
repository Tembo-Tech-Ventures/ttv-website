import { readFileSync, readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

const NAME = "0033_channel_message_search";
const migration = readMigration(`${NAME}.sql`);

/** Every migration before this one, two people and a few messages in #help in every state. */
function populated() {
  const { database } = createSqliteD1();
  for (const file of readdirSync(new URL("./", import.meta.url)).filter((n) => n.endsWith(".sql") && n < NAME).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO "user"(id,name,email) VALUES ('wanjiku','Wanjiku Kamau','w@example.test'),('otieno','Otieno Ouma','o@example.test')`);
  const help = (database.prepare("SELECT id FROM channel WHERE slug = 'help'").get() as { id: string }).id;
  let seq = 0;
  const insert = (id: string, body: string, extra: { state?: string; deleted?: boolean; parentId?: string } = {}) => {
    seq += 1;
    const state = extra.state ?? "VISIBLE";
    database.prepare(`INSERT INTO channel_message(id,channelId,parentId,seq,changeSeq,authorId,body,moderationState,moderationReasons,hiddenAt,deletedAt,createdAt)
      VALUES (?,?,?,?,?,'otieno',?,?,?,?,?,?)`).run(id, help, extra.parentId ?? null, seq, seq, extra.deleted ? "" : body, state,
      state === "VISIBLE" ? "[]" : '["Synthetic reason"]', state === "HIDDEN" ? 1 : null, extra.deleted ? 1 : null, seq);
  };
  return { database, help, insert };
}

/** Message ids matching an FTS5 expression, through the content table, newest first. */
const match = (database: DatabaseSync, expression: string) => (database.prepare(`SELECT s.messageId FROM channel_message_fts f
  JOIN channel_message_search s ON s.id = f.rowid WHERE channel_message_fts MATCH ? ORDER BY f.rowid DESC`).all(expression) as { messageId: string }[])
  .map((row) => row.messageId);
const indexed = (database: DatabaseSync) => database.prepare("SELECT id, messageId, body FROM channel_message_search ORDER BY id").all();
/** FTS5 checks its index against the content table; it throws on any difference. */
const checkIntegrity = (database: DatabaseSync) =>
  database.exec("INSERT INTO channel_message_fts(channel_message_fts, rank) VALUES ('integrity-check', 1)");

describe("channel message search migration", () => {
  it("chains metadata without changing a Drizzle table", () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
    const before = read("./meta/0032_snapshot.json");
    const after = read("./meta/0033_snapshot.json");
    expect(after.prevId).toBe(before.id);
    expect(after.tables).toEqual(before.tables);
    expect(read("./meta/_journal.json").entries.find((entry: { idx: number }) => entry.idx === 33)).toMatchObject({ tag: NAME });
  });

  it("backfills only searchable messages, oldest first, and reapplies without duplicates", () => {
    const { database, insert } = populated();
    try {
      insert("visible", "Mandazi recipe");
      insert("flagged", "Mandazi seller 0712 345 678", { state: "FLAGGED" });
      insert("hidden", "Mandazi insult", { state: "HIDDEN" });
      insert("deleted", "", { deleted: true });
      insert("reply", "Mandazi reply", { parentId: "visible" });
      const messages = database.prepare("SELECT * FROM channel_message ORDER BY id").all();
      database.exec(migration);
      const once = indexed(database);
      expect(once).toEqual([
        { id: 1, messageId: "visible", body: "Mandazi recipe" },
        { id: 2, messageId: "flagged", body: "Mandazi seller 0712 345 678" },
        { id: 3, messageId: "reply", body: "Mandazi reply" },
      ]);
      database.exec(migration);
      expect(indexed(database)).toEqual(once);
      checkIntegrity(database);
      expect(match(database, '"mandazi"')).toEqual(["reply", "flagged", "visible"]);
      expect(database.prepare("SELECT * FROM channel_message ORDER BY id").all()).toEqual(messages);
    } finally { database.close(); }
  });

  it("follows inserts, edits, deletes, hides, restores and row deletes, and ignores everything else", () => {
    const { database, help, insert } = populated();
    try {
      database.exec(migration);
      insert("a", "Sukuma wiki");
      insert("b", "Posted hidden", { state: "HIDDEN" });
      expect(indexed(database)).toEqual([{ id: 1, messageId: "a", body: "Sukuma wiki" }]);

      // An edit re-indexes in place: the old words go, the new ones come, the row keeps its key.
      database.exec("UPDATE channel_message SET body = 'Githeri tonight', editedAt = 5 WHERE id = 'a'");
      expect(match(database, '"sukuma"')).toEqual([]);
      expect(match(database, '"githeri"')).toEqual(["a"]);
      expect(indexed(database)).toEqual([{ id: 1, messageId: "a", body: "Githeri tonight" }]);

      // Reactions, polling counters and flags move the message without touching its text.
      database.exec(`UPDATE channel_message SET changeSeq = changeSeq + 10 WHERE id = 'a';
        UPDATE channel_message SET moderationState = 'FLAGGED', moderationReasons = '["Contact details"]' WHERE id = 'a';
        UPDATE channel_message SET body = body WHERE id = 'a'`);
      expect(indexed(database)).toEqual([{ id: 1, messageId: "a", body: "Githeri tonight" }]);

      // Hidden: out of the index. Restored: back in.
      database.exec(`UPDATE channel_message SET moderationState = 'HIDDEN', moderationReasons = '["Abuse"]', hiddenAt = 6 WHERE id = 'a'`);
      expect(match(database, '"githeri"')).toEqual([]);
      expect(indexed(database)).toEqual([]);
      database.exec(`UPDATE channel_message SET moderationState = 'VISIBLE', moderationReasons = '[]', hiddenAt = NULL WHERE id IN ('a', 'b')`);
      expect(match(database, '"githeri" OR "posted"')).toEqual(["b", "a"]);

      // The author's delete leaves a placeholder, and nothing in the index.
      database.exec("UPDATE channel_message SET body = '', deletedAt = 7 WHERE id = 'b'");
      expect(match(database, '"posted"')).toEqual([]);
      checkIntegrity(database);

      // Deleting rows, here through the channel's cascade, takes them out too.
      insert("c", "Chai break");
      database.prepare("DELETE FROM channel WHERE id = ?").run(help);
      expect(indexed(database)).toEqual([]);
      expect(match(database, '"chai" OR "githeri"')).toEqual([]);
      checkIntegrity(database);
    } finally { database.close(); }
  });

  it("keeps message ids and bodies together when channel_message's implicit rowids change", () => {
    const { database, insert } = populated();
    try {
      database.exec(migration);
      for (let i = 1; i <= 6; i++) insert(`m${i}`, `Ndengu ${i}`);
      database.exec("DELETE FROM channel_message WHERE id IN ('m1', 'm3')");
      // As a table rebuild (or VACUUM) may: the index never relies on these numbers.
      database.exec("UPDATE channel_message SET rowid = rowid + 100");
      database.exec("UPDATE channel_message SET body = 'Ndengu five, edited' WHERE id = 'm5'");
      database.exec("UPDATE channel_message SET body = '', deletedAt = 9 WHERE id = 'm6'");
      expect(indexed(database)).toEqual([
        { id: 2, messageId: "m2", body: "Ndengu 2" }, { id: 4, messageId: "m4", body: "Ndengu 4" }, { id: 5, messageId: "m5", body: "Ndengu five, edited" },
      ]);
      expect(match(database, '"edited"')).toEqual(["m5"]);
      checkIntegrity(database);
    } finally { database.close(); }
  });

  it("finds a message by its key through indexes, never a scan", () => {
    const { database } = populated();
    try {
      database.exec(migration);
      const plan = (sql: string) => (database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((row) => row.detail).join("\n");
      expect(plan("DELETE FROM channel_message_search WHERE messageId = 'x'"))
        .toMatch(/^SEARCH channel_message_search USING (COVERING )?INDEX channel_message_search_messageId_idx \(messageId=\?\)$/);
      expect(() => database.exec("INSERT INTO channel_message_search(messageId, body) VALUES ('x', 'a'), ('x', 'b')")).toThrow(/UNIQUE/);
    } finally { database.close(); }
  });
});
