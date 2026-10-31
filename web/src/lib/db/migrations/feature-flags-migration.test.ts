import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSqliteD1, MINIMAL_AUTH_SCHEMA, readMigration } from "@/test/sqlite-d1";

const migration = readMigration("0021_feature_flags.sql");

describe("feature flags migration", () => {
  it("applies to the historical schema, seeds OFF, and reruns without changing data", () => {
    const { database } = createSqliteD1();
    try {
      const directory = new URL("./", import.meta.url);
      for (const name of readdirSync(directory).filter(n => n.endsWith(".sql") && n < "0021").toSorted()) {
        database.exec(readMigration(name));
      }
      database.exec("INSERT INTO user(id,name,email) VALUES ('amina','Amina Hassan','amina@example.test')");
      database.exec(migration);
      const rows = () => database.prepare("SELECT * FROM feature_flag ORDER BY key").all();
      const initial = rows();
      expect(initial).toEqual(["channels", "mentor_requests", "spaces", "tembo_channels"].map(key => ({
        key, audience: "OFF", updatedAt: expect.any(Number), updatedBy: null,
      })));
      database.exec(migration);
      expect(rows()).toEqual(initial);

      database.exec("UPDATE feature_flag SET audience='STAFF', updatedAt=123, updatedBy='amina' WHERE key='spaces'");
      database.exec("UPDATE feature_flag SET audience='ALL', updatedAt=456, updatedBy='amina' WHERE key='channels'");
      const changed = rows();
      database.exec(migration);
      expect(rows()).toEqual(changed);
      expect(database.prepare("SELECT name FROM user WHERE id='amina'").get()).toMatchObject({ name: "Amina Hassan" });
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { database.close(); }
  });

  it("enforces audiences and actor references, retaining flags when an actor is deleted", () => {
    const { database } = createSqliteD1();
    try {
      database.exec(MINIMAL_AUTH_SCHEMA);
      database.exec(migration);
      expect(() => database.exec("UPDATE feature_flag SET audience='PUBLIC'")).toThrow(/CHECK/);
      expect(() => database.exec("UPDATE feature_flag SET audience=NULL")).toThrow(/NOT NULL/);
      expect(() => database.exec("UPDATE feature_flag SET updatedBy='missing'")).toThrow(/FOREIGN KEY/);
      database.exec("INSERT INTO user(id,name,email) VALUES ('amina','Amina Hassan','amina@example.test')");
      database.exec("UPDATE feature_flag SET audience='STAFF', updatedBy='amina'");
      database.exec("DELETE FROM user WHERE id='amina'");
      expect(database.prepare("SELECT audience, updatedBy FROM feature_flag").all()).toEqual(
        Array.from({ length: 4 }, () => ({ audience: "STAFF", updatedBy: null }))
      );
    } finally { database.close(); }
  });
});
