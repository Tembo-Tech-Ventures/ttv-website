import { describe, expect, it } from "vitest";
import { createSqliteD1 } from "./sqlite-d1";

/**
 * The adapter reports what local workerd D1 reported for the same statements
 * (wrangler 4.149, 2026-11-02), so tests see trigger writes in meta.changes.
 */
describe("createSqliteD1 change counts", () => {
  function setup() {
    const { database, db } = createSqliteD1();
    database.exec(`
      CREATE TABLE plain (id INTEGER PRIMARY KEY, v TEXT);
      CREATE TABLE trig (id INTEGER PRIMARY KEY, v TEXT);
      CREATE TABLE audit (id INTEGER PRIMARY KEY, v TEXT);
      CREATE TRIGGER trig_insert AFTER INSERT ON trig BEGIN
        INSERT INTO audit (v) VALUES (new.v); INSERT INTO audit (v) VALUES (new.v);
      END;
      CREATE TRIGGER trig_update AFTER UPDATE ON trig BEGIN INSERT INTO audit (v) VALUES (new.v); END;
      CREATE VIRTUAL TABLE fts USING fts5(v);`);
    const run = async (sql: string) => {
      const { results, meta } = await db.prepare(sql).run();
      return { changes: meta.changes, results };
    };
    return { database, db, run };
  }

  it("counts rows written by triggers and FTS5 shadow tables, as D1 does", async () => {
    const { run } = setup();
    expect(await run("INSERT INTO plain (v) VALUES ('a')")).toEqual({ changes: 1, results: [] });
    expect(await run("INSERT INTO trig (v) VALUES ('a')")).toEqual({ changes: 3, results: [] });
    expect(await run("UPDATE trig SET v = 'b' WHERE id = 1")).toEqual({ changes: 2, results: [] });
    // FTS5 counts its shadow-table writes too: D1 reported 3 here; the exact number depends on the SQLite build.
    expect((await run("INSERT INTO fts (v) VALUES ('hello world')")).changes).toBeGreaterThan(1);
  });

  it("reports 0 for a statement that writes no row, whatever its triggers", async () => {
    const { run } = setup();
    await run("INSERT INTO trig (id, v) VALUES (1, 'a')");
    expect(await run("INSERT OR IGNORE INTO trig (id, v) VALUES (1, 'x')")).toEqual({ changes: 0, results: [] });
    expect(await run("UPDATE trig SET v = 'z' WHERE id = 999")).toEqual({ changes: 0, results: [] });
  });

  it("returns RETURNING rows from run() and batch(), counting only the statement's own rows", async () => {
    const { db, run } = setup();
    expect(await run("INSERT INTO trig (v) VALUES ('a') RETURNING id")).toEqual({ changes: 3, results: [{ id: 1 }] });
    expect(await run("INSERT OR IGNORE INTO trig (id, v) VALUES (1, 'x') RETURNING id")).toEqual({ changes: 0, results: [] });
    const batch = await db.batch([
      db.prepare("INSERT INTO trig (v) VALUES ('c') RETURNING id"),
      db.prepare("INSERT INTO plain (v) VALUES ('c')"),
    ]);
    expect(batch.map(({ results, meta }) => [results, meta.changes])).toEqual([[[{ id: 2 }], 3], [[], 1]]);
  });
});
