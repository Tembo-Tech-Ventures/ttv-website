import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

const migration = readMigration("0027_mentor_set_aside.sql");

describe("mentor set-aside migration", () => {
  it("chains metadata with only the one table addition", () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
    const before = read("./meta/0026_snapshot.json");
    const after = read("./meta/0027_snapshot.json");
    expect(after.prevId).toBe(before.id);
    const table = after.tables.communitySetAside;
    expect(Object.keys(table.columns)).toEqual(["mentorId", "journeyId", "journeyVersion", "createdAt"]);
    expect(Object.values(table.compositePrimaryKeys)).toEqual([expect.objectContaining({ columns: ["mentorId", "journeyId", "journeyVersion"] })]);
    expect(Object.values(table.foreignKeys).map((fk) => (fk as { onDelete: string }).onDelete)).toEqual(["cascade", "cascade"]);
    delete after.tables.communitySetAside;
    expect(after.tables).toEqual(before.tables);
    expect(read("./meta/_journal.json").entries.find((entry: { idx: number }) => entry.idx === 27))
      .toMatchObject({ tag: "0027_mentor_set_aside" });
  });

  it("applies to populated historical schema, preserves data, safely reapplies, constrains and cascades", () => {
    const { database } = createSqliteD1();
    try {
      for (const file of readdirSync(new URL("./", import.meta.url)).filter(n => n.endsWith(".sql") && n < "0027").toSorted()) database.exec(readMigration(file));
      database.exec(`INSERT INTO "user"(id,name,email) VALUES ('member','Achieng Otieno','achieng@example.com'),('mentor','Kamau Njoroge','kamau@example.com'),('mentor2','Wanjiru Mwangi','wanjiru@example.com');
        INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility,version) VALUES
          ('ledger','member','Savings ledger','Built a fictional ledger','2026-10-01','institution',2),
          ('receipts','member','Receipts','Built a fictional tracker','2026-10-02','institution',1);
        INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion,mentorRole) VALUES ('c1','ledger','mentor2','I checked the code','Review',2,'MENTOR');`);
      const snapshot = () => ({
        journeys: database.prepare("SELECT * FROM communityJourney ORDER BY id").all(),
        confirmations: database.prepare("SELECT * FROM communityConfirmation ORDER BY id").all(),
        users: database.prepare(`SELECT * FROM "user" ORDER BY id`).all(),
      });
      const existing = snapshot();
      database.exec(migration);
      database.exec(migration);
      expect(snapshot()).toEqual(existing);
      expect(database.prepare("SELECT COUNT(*) AS n FROM communitySetAside").get()).toEqual({ n: 0 });

      const setAside = database.prepare("INSERT INTO communitySetAside(mentorId,journeyId,journeyVersion) VALUES (?,?,?)");
      setAside.run("mentor", "ledger", 2);
      setAside.run("mentor", "ledger", 1);
      setAside.run("mentor2", "ledger", 2);
      setAside.run("mentor", "receipts", 1);
      // One row per mentor and revision; revisions start at 1; both references must exist.
      expect(() => setAside.run("mentor", "ledger", 2)).toThrow(/UNIQUE/);
      expect(() => setAside.run("mentor", "receipts", 0)).toThrow(/CHECK/);
      expect(() => setAside.run("nobody", "receipts", 1)).toThrow(/FOREIGN KEY/);
      expect(() => setAside.run("mentor", "missing", 1)).toThrow(/FOREIGN KEY/);
      expect(database.prepare("SELECT createdAt FROM communitySetAside LIMIT 1").get()).toEqual({ createdAt: expect.any(Number) });
      database.exec(migration);
      expect(database.prepare("SELECT COUNT(*) AS n FROM communitySetAside").get()).toEqual({ n: 4 });
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

      const plan = (sql: string) => database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(r => String(r.detail)).join("\n");
      // The Confirm page's per-row lookup and the cascade from a deleted contribution are both indexed.
      expect(plan(`SELECT 1 FROM communitySetAside WHERE mentorId='mentor' AND journeyId='ledger' AND journeyVersion=2`)).toContain("sqlite_autoindex_communitySetAside_1 (mentorId=? AND journeyId=? AND journeyVersion=?)");
      expect(plan(`SELECT 1 FROM communitySetAside WHERE journeyId='ledger'`)).toContain("communitySetAside_journeyId_idx");

      database.exec("DELETE FROM communityJourney WHERE id='ledger'");
      expect(database.prepare("SELECT mentorId,journeyId FROM communitySetAside ORDER BY mentorId").all()).toEqual([{ mentorId: "mentor", journeyId: "receipts" }]);
      database.exec(`DELETE FROM "user" WHERE id='mentor'`);
      expect(database.prepare("SELECT COUNT(*) AS n FROM communitySetAside").get()).toEqual({ n: 0 });
      expect(database.prepare("SELECT id FROM communityJourney").all()).toEqual([{ id: "receipts" }]);
    } finally { database.close(); }
  });
});
