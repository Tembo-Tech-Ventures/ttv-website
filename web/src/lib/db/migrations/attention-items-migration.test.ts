import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSqliteD1, MINIMAL_AUTH_SCHEMA, readMigration } from "@/test/sqlite-d1";

const migration = readMigration("0023_attention_items.sql");
describe("attention migration", () => {
  it("applies after all historical migrations and preserves data on reapply", () => {
    const { database } = createSqliteD1();
    try {
      for (const file of readdirSync(new URL("./", import.meta.url)).filter(n => n.endsWith(".sql") && n < "0023").toSorted()) database.exec(readMigration(file));
      database.exec("INSERT INTO user(id,name,email) VALUES ('wanjiku','Wanjiku Njeri','wanjiku@example.test')");
      database.exec(migration);
      database.exec(`INSERT INTO attention_item(id,userId,eventKey,kind,space,category,subjectKind,subjectId,subjectHref,subjectLabel,summary,createdAt,readAt)
        VALUES ('legacy/%雪','wanjiku','event','application_status','cohort','updates','application','application','/dashboard/apply','Application','Updated',1000,2000)`);
      const before = database.prepare("SELECT * FROM attention_item").all();
      database.exec(migration);
      expect(database.prepare("SELECT * FROM attention_item").all()).toEqual(before);
      expect(database.prepare("SELECT name FROM user").get()).toEqual({ name: "Wanjiku Njeri" });
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { database.close(); }
  });

  it("enforces dedup, recipient ownership, valid spaces/times and deletion behavior", () => {
    const { database } = createSqliteD1();
    try {
      database.exec(MINIMAL_AUTH_SCHEMA); database.exec(migration);
      database.exec("INSERT INTO user(id,name,email) VALUES ('wanjiku','Wanjiku Njeri','w@example.test'),('mercy','Mercy Wambui','m@example.test')");
      const insert = database.prepare(`INSERT INTO attention_item(id,userId,eventKey,kind,space,category,subjectKind,subjectId,subjectHref,subjectLabel,actorId,summary,createdAt)
        VALUES (?,?,'event','work_confirmed','profile','updates','journey','journey','/dashboard/community','Work','mercy','Confirmed',1000)`);
      insert.run("first", "wanjiku");
      expect(() => insert.run("duplicate", "wanjiku")).toThrow(/UNIQUE/);
      expect(() => insert.run("missing", "missing")).toThrow(/FOREIGN KEY/);
      expect(() => database.exec("UPDATE attention_item SET space='secret'")).toThrow(/CHECK/);
      expect(() => database.exec("UPDATE attention_item SET category='other'")).toThrow(/CHECK/);
      expect(() => database.exec("UPDATE attention_item SET readAt=1")).toThrow(/CHECK/);
      database.exec("DELETE FROM user WHERE id='mercy'");
      expect(database.prepare("SELECT actorId FROM attention_item").get()).toEqual({ actorId: null });
      database.exec("DELETE FROM user WHERE id='wanjiku'");
      expect(database.prepare("SELECT * FROM attention_item").all()).toEqual([]);
    } finally { database.close(); }
  });
});
