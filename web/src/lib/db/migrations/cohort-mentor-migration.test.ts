import { readFileSync, readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { programRole } from "../schema";

const migration = readMigration("0022_cohort_mentor_access.sql");
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach((database) => database.close()); });

function setup() {
  const { database } = createSqliteD1();
  databases.push(database);
  for (const name of readdirSync(new URL("./", import.meta.url)).filter((filename) => filename.endsWith(".sql") && filename < "0022").toSorted()) {
    database.exec(readMigration(name));
  }
  database.exec(`
    INSERT INTO user (id,name,email) VALUES ('wanjiku','Wanjiku Njeri','wanjiku@example.test'),('otieno','Otieno Ouma','otieno@example.test');
    INSERT INTO curriculum (id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program (id,name,description,curriculumId) VALUES ('cohort-a','Synthetic cohort A','Test','curriculum'),('cohort-b','Synthetic cohort B','Test','curriculum');
    INSERT INTO programRole (id,programId,userId,name,createdAt,updatedAt) VALUES
      ('instructor','cohort-a','wanjiku','INSTRUCTOR',111,222),('ta','cohort-b','otieno','TA',333,444);
    INSERT INTO programApplication (id,programId,userId,status,application) VALUES ('application','cohort-a','otieno','AUDIT','{}');
    INSERT INTO UserRoles (id,userId,roleId) SELECT 'global-admin','wanjiku',id FROM Roles WHERE name='ADMIN';
    UPDATE feature_flag SET audience='STAFF',updatedAt=123,updatedBy='wanjiku' WHERE key='spaces';
  `);
  return database;
}

/** D1 migration execution is atomic; keep FK enforcement on inside the transaction. */
function apply(database: DatabaseSync) {
  database.exec("BEGIN");
  try {
    database.exec(migration);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function data(database: DatabaseSync) {
  const tables = ["programRole", "programApplication", "user", "program", "curriculum", "Roles", "UserRoles", "feature_flag"];
  return Object.fromEntries(tables.map((table) => [table, database.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()]));
}

function indexes(database: DatabaseSync) {
  return database.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='programRole' ORDER BY name").all();
}

describe("0022 cohort mentor migration", () => {
  it("preserves historical data, timestamps, foreign keys and existing uniqueness; reapplication preserves mentor edits", () => {
    const database = setup();
    const before = data(database);
    const foreignKeys = database.prepare("PRAGMA foreign_key_list(programRole)").all();
    const uniqueIndex = indexes(database).find((row) => row.name === "programRole_programId_userId_name_unique");
    apply(database);
    expect(data(database)).toEqual(before);
    expect(database.prepare("PRAGMA foreign_key_list(programRole)").all()).toEqual(foreignKeys);
    expect(indexes(database)).toContainEqual(uniqueIndex);
    expect(database.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    database.exec("INSERT INTO programRole (id,programId,userId,name,createdAt,updatedAt) VALUES ('mentor','cohort-a','otieno','MENTOR',555,666)");
    database.exec("UPDATE programRole SET updatedAt=777 WHERE id='mentor'");
    const withMentor = data(database);
    const allIndexes = indexes(database);
    apply(database);
    apply(database);
    expect(data(database)).toEqual(withMentor);
    expect(indexes(database)).toEqual(allIndexes);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name='__new_programRole'").all()).toEqual([]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("supports empty tables and retains defaults on newly assigned mentors", () => {
    const database = setup();
    database.exec("DELETE FROM programRole");
    apply(database);
    apply(database);
    database.exec("INSERT INTO programRole (id,programId,userId,name) VALUES ('mentor','cohort-a','otieno','MENTOR')");
    expect(database.prepare("SELECT createdAt,updatedAt FROM programRole").get()).toEqual({ createdAt: expect.any(Number), updatedAt: expect.any(Number) });
  });

  it("enforces the enum, NOT NULL, foreign keys and role uniqueness after rebuilding", () => {
    const database = setup();
    apply(database);
    expect(programRole.name.enumValues).toEqual(["INSTRUCTOR", "TA", "MENTOR"]);
    for (const name of ["INSTRUCTOR", "TA", "MENTOR"]) {
      database.prepare("INSERT INTO programRole (id,programId,userId,name) VALUES (?,'cohort-a','otieno',?)").run(name, name);
    }
    expect(() => database.exec("INSERT INTO programRole (id,programId,userId,name) VALUES ('duplicate','cohort-a','otieno','MENTOR')")).toThrow(/UNIQUE/);
    expect(() => database.exec("UPDATE programRole SET name='ADMIN' WHERE id='MENTOR'")).toThrow(/CHECK/);
    expect(() => database.exec("UPDATE programRole SET name=NULL WHERE id='MENTOR'")).toThrow(/NOT NULL/);
    expect(() => database.exec("UPDATE programRole SET userId='missing' WHERE id='MENTOR'")).toThrow(/FOREIGN KEY/);
    expect(() => database.exec("UPDATE programRole SET programId='missing' WHERE id='MENTOR'")).toThrow(/FOREIGN KEY/);
    expect(() => database.exec("DELETE FROM user WHERE id='wanjiku'")).toThrow(/FOREIGN KEY/);
    expect(() => database.exec("DELETE FROM program WHERE id='cohort-b'")).toThrow(/FOREIGN KEY/);
  });

  it("aborts on unexpected legacy names without deleting data or leaving a partial rebuild", () => {
    const database = setup();
    database.exec("INSERT INTO programRole (id,programId,userId,name) VALUES ('legacy','cohort-a','otieno','LEGACY')");
    const before = data(database);
    const beforeIndexes = indexes(database);
    expect(() => apply(database)).toThrow(/CHECK/);
    expect(data(database)).toEqual(before);
    expect(indexes(database)).toEqual(beforeIndexes);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name='__new_programRole' OR name='programApplication_userId_programId_status_idx'").all()).toEqual([]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("indexes both user-scoped membership queries after application and reapplication", () => {
    const database = setup();
    apply(database);
    apply(database);
    for (const [table, columns, index] of [
      ["programRole", "programId,name", "programRole_userId_programId_name_idx"],
      ["programApplication", "programId,status", "programApplication_userId_programId_status_idx"],
    ]) {
      const plan = database.prepare(`EXPLAIN QUERY PLAN SELECT ${columns} FROM ${table} WHERE userId=?`).all("wanjiku");
      expect(plan.map((row) => row.detail).join(" ")).toContain(`USING COVERING INDEX ${index}`);
    }
  });

  it("keeps the journal and snapshot chained to 0021 with only the intended table changes", () => {
    const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
    const before = readJson("./meta/0021_snapshot.json");
    const after = readJson("./meta/0022_snapshot.json");
    const journal = readJson("./meta/_journal.json");
    expect(after.prevId).toBe(before.id);
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 22)).toMatchObject({ idx: 22, tag: "0022_cohort_mentor_access" });
    const { programRole: oldRole, programApplication: oldApplication, ...oldTables } = before.tables;
    const { programRole: newRole, programApplication: newApplication, ...newTables } = after.tables;
    expect(newTables).toEqual(oldTables);
    expect(newRole.columns).toEqual(oldRole.columns);
    expect(newRole.foreignKeys).toEqual(oldRole.foreignKeys);
    expect(newRole.indexes.programRole_programId_userId_name_unique).toEqual(oldRole.indexes.programRole_programId_userId_name_unique);
    expect(newRole.checkConstraints.programRole_name_check.value).toContain("'MENTOR'");
    expect(newApplication.columns).toEqual(oldApplication.columns);
    expect(newApplication.foreignKeys).toEqual(oldApplication.foreignKeys);
    expect(newApplication.indexes.programApplication_programId_userId_unique).toEqual(oldApplication.indexes.programApplication_programId_userId_unique);
  });
});
