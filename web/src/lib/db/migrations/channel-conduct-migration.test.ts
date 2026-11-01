import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

const migration = readMigration("0029_channel_conduct.sql");

describe("channel conduct migration", () => {
  it("chains metadata with only the one table addition", () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
    const before = read("./meta/0028_snapshot.json");
    const after = read("./meta/0029_snapshot.json");
    expect(after.prevId).toBe(before.id);
    const table = after.tables.channel_conduct;
    expect(Object.keys(table.columns)).toEqual(["userId", "version", "acknowledgedAt"]);
    expect(table.columns.userId.primaryKey).toBe(true);
    expect(Object.values(table.foreignKeys).map((fk) => (fk as { onDelete: string }).onDelete)).toEqual(["cascade"]);
    expect(Object.keys(table.checkConstraints).toSorted()).toEqual(["channel_conduct_time_check", "channel_conduct_version_check"]);
    delete after.tables.channel_conduct;
    expect(after.tables).toEqual(before.tables);
    expect(after.views).toEqual(before.views);
    expect(read("./meta/_journal.json").entries.find((entry: { idx: number }) => entry.idx === 29))
      .toMatchObject({ tag: "0029_channel_conduct" });
  });

  it("applies to a populated historical schema, preserves data, safely reapplies, constrains and cascades", () => {
    const { database } = createSqliteD1();
    try {
      for (const file of readdirSync(new URL("./", import.meta.url)).filter(n => n.endsWith(".sql") && n < "0029").toSorted()) database.exec(readMigration(file));
      database.exec(`INSERT INTO "user"(id,name,email) VALUES ('wanjiku','Wanjiku Kamau','wanjiku@example.test'),('otieno','Otieno Ouma','otieno@example.test');
        INSERT INTO curriculum(id,title,description) VALUES ('web','Web foundations','Synthetic');
        INSERT INTO program(id,name,description,curriculumId) VALUES ('c4','Cohort 04','Synthetic','web');`);
      const snapshot = () => ({
        users: database.prepare(`SELECT * FROM "user" ORDER BY id`).all(),
        channels: database.prepare("SELECT id, slug, programId FROM channel ORDER BY id").all(),
        flags: database.prepare("SELECT * FROM feature_flag ORDER BY key").all(),
      });
      const existing = snapshot();
      database.exec(migration);
      database.exec(migration);
      expect(snapshot()).toEqual(existing);
      expect(database.prepare("SELECT COUNT(*) AS n FROM channel_conduct").get()).toEqual({ n: 0 });

      const agree = database.prepare("INSERT INTO channel_conduct(userId,version,acknowledgedAt) VALUES (?,?,?)");
      agree.run("wanjiku", 1, 1_793_539_000_000);
      // One row per person; versions start at 1; times are epoch milliseconds; the person must exist.
      expect(() => agree.run("wanjiku", 2, 1)).toThrow(/UNIQUE|PRIMARY KEY/);
      expect(() => agree.run("otieno", 0, 1)).toThrow(/CHECK/);
      expect(() => agree.run("otieno", 1, -1)).toThrow(/CHECK/);
      expect(() => agree.run("nobody", 1, 1)).toThrow(/FOREIGN KEY/);
      expect(() => database.prepare("INSERT INTO channel_conduct(userId,acknowledgedAt) VALUES ('otieno',1)").run()).toThrow(/NOT NULL/);
      database.exec(migration);
      expect(database.prepare("SELECT userId, version FROM channel_conduct").all()).toEqual([{ userId: "wanjiku", version: 1 }]);
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

      const plan = database.prepare("EXPLAIN QUERY PLAN SELECT version, acknowledgedAt FROM channel_conduct WHERE userId = 'wanjiku'").all()
        .map(row => String(row.detail)).join("\n");
      expect(plan).toContain("sqlite_autoindex_channel_conduct_1 (userId=?)");

      database.exec(`DELETE FROM "user" WHERE id='wanjiku'`);
      expect(database.prepare("SELECT COUNT(*) AS n FROM channel_conduct").get()).toEqual({ n: 0 });
    } finally { database.close(); }
  });
});
