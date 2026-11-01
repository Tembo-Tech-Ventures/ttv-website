import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

const migration = readMigration("0031_channel_action.sql");
const HOUR = 60 * 60_000;

describe("channel action migration", () => {
  it("chains metadata with only the one table addition", () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
    const before = read("./meta/0030_snapshot.json");
    const after = read("./meta/0031_snapshot.json");
    expect(after.prevId).toBe(before.id);
    const table = after.tables.channel_action;
    expect(Object.keys(table.columns)).toEqual(["id", "userId", "channelId", "kind", "at"]);
    expect(Object.keys(table.indexes).toSorted()).toEqual(["channel_action_channelId_idx", "channel_action_user_idx"]);
    expect(Object.values(table.foreignKeys).map((fk) => (fk as { onDelete: string }).onDelete)).toEqual(["cascade", "cascade"]);
    delete after.tables.channel_action;
    expect(after.tables).toEqual(before.tables);
    expect(read("./meta/_journal.json").entries.find((entry: { idx: number }) => entry.idx === 31))
      .toMatchObject({ tag: "0031_channel_action" });
  });

  it("applies to a populated schema, reapplies safely, constrains, prunes past an hour and cascades", () => {
    const { database } = createSqliteD1();
    try {
      for (const file of readdirSync(new URL("./", import.meta.url)).filter((n) => n.endsWith(".sql") && n < "0031").toSorted()) {
        database.exec(readMigration(file));
      }
      database.exec(`INSERT INTO "user"(id,name,email) VALUES ('wanjiku','Wanjiku Kamau','w@example.test'),('otieno','Otieno Ouma','o@example.test')`);
      const help = (database.prepare("SELECT id FROM channel WHERE slug = 'help'").get() as { id: string }).id;
      const channels = () => database.prepare("SELECT id, slug FROM channel ORDER BY id").all();
      const existing = channels();
      database.exec(migration);
      database.exec(migration);
      expect(channels()).toEqual(existing);

      const log = database.prepare("INSERT INTO channel_action(id,userId,channelId,kind,at) VALUES (?,?,?,?,?)");
      log.run("a1", "wanjiku", help, "EDIT", 1_000);
      log.run("a2", "wanjiku", help, "REACT", 1_000);
      log.run("b1", "otieno", help, "EDIT", 1_000);
      expect(() => log.run("x", "wanjiku", help, "DELETE", 1)).toThrow(/CHECK/);
      expect(() => log.run("y", "wanjiku", help, "EDIT", -1)).toThrow(/CHECK/);
      expect(() => log.run("z", "nobody", help, "EDIT", 1)).toThrow(/FOREIGN KEY/);
      // A new row prunes only the same person's rows of the same kind, an hour old or more.
      log.run("a3", "wanjiku", help, "EDIT", 999 + HOUR);
      const ids = () => (database.prepare("SELECT id FROM channel_action ORDER BY id").all() as { id: string }[]).map((r) => r.id);
      expect(ids()).toEqual(["a1", "a2", "a3", "b1"]);
      log.run("a4", "wanjiku", help, "EDIT", 1_000 + HOUR);
      expect(ids()).toEqual(["a2", "a3", "a4", "b1"]);

      const plan = database.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM channel_action WHERE userId = ? AND kind = ? AND at > ? AND channelId = ?")
        .all("wanjiku", "EDIT", 0, help).map((row) => String(row.detail)).join("\n");
      expect(plan).toContain("channel_action_user_idx (userId=? AND kind=? AND at>?)");

      database.exec(`DELETE FROM "user" WHERE id = 'otieno'`);
      expect(ids()).toEqual(["a2", "a3", "a4"]);
      database.prepare("DELETE FROM channel WHERE id = ?").run(help);
      expect(ids()).toEqual([]);
    } finally { database.close(); }
  });
});
