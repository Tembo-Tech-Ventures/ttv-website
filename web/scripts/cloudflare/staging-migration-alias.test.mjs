import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { ALIAS_ACCOUNT, ALIAS_DATABASE, ALIAS_ORIGIN, LEGACY_MIGRATION, CANONICAL_MIGRATION, reconcileStagingAlias, parseAliasArguments } from "./staging-migration-alias.mjs";
const directory = new URL("../../src/lib/db/migrations/", import.meta.url);
const open = [];
afterEach(() => { for (const db of open.splice(0)) db.close(); });
const read = name => readFileSync(new URL(name, directory), "utf8");
function fixture() {
  const db = new DatabaseSync(":memory:"); open.push(db);
  db.exec("CREATE TABLE d1_migrations( id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL )");
  const apply = (name, sql = read(name)) => { db.exec(sql); db.prepare("INSERT INTO d1_migrations(name) VALUES (?)").run(name); };
  for (const name of readdirSync(directory).filter(fileName => /^000[0-2]_.*\.sql$/.test(fileName)).toSorted()) apply(name);
  apply(LEGACY_MIGRATION, read(CANONICAL_MIGRATION));
  db.prepare("UPDATE d1_migrations SET applied_at=? WHERE name=?").run("2026-07-15 10:01:23", LEGACY_MIGRATION);
  for (const name of readdirSync(directory).filter(fileName => /^000[3-6]_.*\.sql$/.test(fileName)).toSorted()) apply(name);
  const observedTimestamps = ["2026-04-04 13:38:09", "2026-04-05 00:10:59", "2026-05-27 14:23:03", "2026-07-15 10:01:23", "2026-10-24 11:41:49", "2026-10-24 11:41:49", "2026-10-24 11:41:50", "2026-10-24 11:41:50"];
  observedTimestamps.forEach((timestamp, i) => db.prepare("UPDATE d1_migrations SET applied_at=? WHERE id=?").run(timestamp, i + 1));
  db.exec("INSERT INTO curriculum(id,title,description) VALUES ('local-curriculum','Synthetic','Synthetic'); INSERT INTO program(id,name,description,curriculumId) VALUES ('local-program','Synthetic','Synthetic','local-curriculum')");
  db.exec("INSERT INTO recording_import_source(id,programId,name,driveFolderId) VALUES ('local-synthetic-sentinel','local-program','Local synthetic sentinel','local-folder')");
  const expectedVersion = "4".repeat(40);
  const account = { id: ALIAS_ACCOUNT };
  const settings = { bindings: [
    { name: "DB", type: "d1", id: ALIAS_DATABASE }, { name: "DEPLOYMENT_ENVIRONMENT", text: "staging" },
    { name: "DEPLOYMENT_VERSION", text: expectedVersion }, { name: "PRIMARY_DOMAIN", text: "staging.tembotechventures.com" },
    { name: "BETTER_AUTH_URL", text: ALIAS_ORIGIN },
  ] };
  const database = { uuid: ALIAS_DATABASE, name: "ttv-website-db-staging" };
  const writes = []; let beforeInsert; let afterInsert;
  const api = async (path, options) => {
    if (path === "") return account;
    if (path.endsWith("/settings")) return settings;
    if (path === `/d1/database/${ALIAS_DATABASE}`) return database;
    if (path !== `/d1/database/${ALIAS_DATABASE}/query`) throw new Error("Unexpected target");
    const { sql, params = [] } = options.body;
    if (sql.startsWith("INSERT")) { beforeInsert?.(); writes.push({ sql, params }); }
    const results = db.prepare(sql).all(...params);
    if (sql.startsWith("INSERT")) afterInsert?.();
    return [{ results }];
  };
  return { db, account, settings, database, writes, options: { api, expectedVersion }, race(fn) { beforeInsert = fn; }, afterWrite(fn) { afterInsert = fn; } };
}
describe("one staging historical migration alias", () => {
  it("reproduces collision, preserves synthetic data and replays the remaining real migration chain", async () => {
    const f = fixture();
    expect(() => f.db.exec(read(CANONICAL_MIGRATION))).toThrow("already exists");
    const originalLedger = f.db.prepare("SELECT * FROM d1_migrations ORDER BY id").all();
    const originalData = f.db.prepare("SELECT * FROM recording_import_source").all();
    expect(await reconcileStagingAlias(f.options)).toMatchObject({ outcome: "eligible", changed: false, mode: "dry-run" });
    expect(f.writes).toHaveLength(0);
    expect(await reconcileStagingAlias({ ...f.options, apply: true })).toMatchObject({ outcome: "recorded", changed: true, canonical: { id: 9, name: CANONICAL_MIGRATION } });
    expect(f.writes).toHaveLength(1);
    expect(f.db.prepare("SELECT * FROM d1_migrations WHERE name<>? ORDER BY id").all(CANONICAL_MIGRATION)).toEqual(originalLedger);
    expect(await reconcileStagingAlias({ ...f.options, apply: true })).toMatchObject({ outcome: "already-recorded", changed: false });
    expect(f.writes).toHaveLength(1);
    for (const name of readdirSync(directory).filter(fileName => /^(000[8-9]|001\d)_.*\.sql$/.test(fileName)).toSorted()) f.db.exec(read(name));
    expect(f.db.prepare("SELECT * FROM recording_import_source").all()).toEqual(originalData);
    expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name='stagingFixtureIdentity'").get()).toBeTruthy();
  });
  it.each(["account", "database", "name", "DB", "DEPLOYMENT_ENVIRONMENT", "DEPLOYMENT_VERSION", "PRIMARY_DOMAIN", "BETTER_AUTH_URL", "digest", "version"])("fails before write on %s mismatch", async mismatch => {
    const f = fixture();
    if (mismatch === "account") f.account.id = "a".repeat(32);
    else if (mismatch === "database") f.database.uuid = "other";
    else if (mismatch === "name") f.database.name = "production";
    else if (mismatch === "digest") f.options.migrationSql = read(CANONICAL_MIGRATION) + "\n";
    else if (mismatch === "version") f.options.expectedVersion = "short";
    else if (mismatch === "DB") f.settings.bindings[0].id = "other";
    else f.settings.bindings.find(b => b.name === mismatch).text = "production";
    await expect(reconcileStagingAlias({ ...f.options, apply: true })).rejects.toThrow("refused");
    expect(f.writes).toHaveLength(0);
  });
  it.each(["missingLegacy", "renamedLegacy", "wrongTimestamp", "extraLedger", "changedTable", "missingIndex", "nonUniqueIndex", "secondLedger", "trigger", "sequence"])("fails closed on %s drift", async drift => {
    const f = fixture();
    if (drift === "missingLegacy") f.db.prepare("DELETE FROM d1_migrations WHERE name=?").run(LEGACY_MIGRATION);
    if (drift === "renamedLegacy") f.db.prepare("UPDATE d1_migrations SET name='unknown.sql' WHERE name=?").run(LEGACY_MIGRATION);
    if (drift === "wrongTimestamp") f.db.prepare("UPDATE d1_migrations SET applied_at='different' WHERE name=?").run(LEGACY_MIGRATION);
    if (drift === "extraLedger") f.db.exec("INSERT INTO d1_migrations(name) VALUES ('0008_curvy_purifiers.sql')");
    if (drift === "changedTable") f.db.exec("ALTER TABLE recording_import_source ADD COLUMN unexpected TEXT");
    if (drift === "missingIndex") f.db.exec("DROP INDEX recording_driveFileId_unique");
    if (drift === "nonUniqueIndex") f.db.exec("DROP INDEX recording_driveFileId_unique; CREATE INDEX recording_driveFileId_unique ON recording(driveFileId)");
    if (drift === "sequence") f.db.exec("UPDATE sqlite_sequence SET seq=100 WHERE name='d1_migrations'");
    if (drift === "secondLedger") f.db.exec("CREATE TABLE __drizzle_migrations(id INTEGER)");
    if (drift === "trigger") f.db.exec("CREATE TRIGGER unsafe_alias AFTER INSERT ON d1_migrations BEGIN DELETE FROM recording_import_source; END");
    await expect(reconcileStagingAlias({ ...f.options, apply: true })).rejects.toThrow("refused");
    expect(f.writes).toHaveLength(0);
  });
  it.each(["ledger", "schema", "trigger", "sequence"])("atomic write refuses %s drift after repeated inspection", async drift => {
    const f = fixture(); f.race(() => {
      if (drift === "ledger") f.db.exec("UPDATE d1_migrations SET applied_at='race' WHERE id=1");
      if (drift === "sequence") f.db.exec("UPDATE sqlite_sequence SET seq=100 WHERE name='d1_migrations'");
      if (drift === "schema") f.db.exec("ALTER TABLE recording_import_source ADD COLUMN race TEXT");
      if (drift === "trigger") f.db.exec("CREATE TRIGGER unsafe_alias AFTER INSERT ON d1_migrations BEGIN DELETE FROM recording_import_source; END");
    });
    await expect(reconcileStagingAlias({ ...f.options, apply: true })).rejects.toThrow("atomic insertion precondition");
    expect(f.db.prepare("SELECT * FROM d1_migrations WHERE name=?").get(CANONICAL_MIGRATION)).toBeUndefined();
    expect(f.db.prepare("SELECT count(*) AS n FROM recording_import_source").get().n).toBe(1);
  });
  it("never retries or undoes an admitted write after readback drift", async () => {
    const f = fixture(); f.afterWrite(() => f.db.exec("UPDATE d1_migrations SET applied_at='drift' WHERE id=1"));
    await expect(reconcileStagingAlias({ ...f.options, apply: true })).rejects.toThrow("post-write verification");
    expect(f.writes).toHaveLength(1);
    expect(f.db.prepare("SELECT name FROM d1_migrations WHERE name=?").get(CANONICAL_MIGRATION)).toBeTruthy();
  });
  it("defaults to dry run and rejects ambiguous CLI arguments", () => {
    expect(parseAliasArguments(["--expected-version=" + "a".repeat(40)]).apply).toBe(false);
    for (const args of [[], ["--apply"], ["--expected-version=x", "--target=production"], ["--expected-version=x", "--apply", "--apply"]]) expect(() => parseAliasArguments(args)).toThrow("refused");
  });
});
