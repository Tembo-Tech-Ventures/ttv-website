import { readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { readMigration } from "@/test/sqlite-d1";

/*
 * 0042: the recording access policy's columns. `recording` is referenced by transcript segments
 * (ON DELETE CASCADE) and foreign keys are on, so the migration must add to it without a rebuild,
 * keep every existing cohort's recordings in their cohort, and keep imports by a Worker that predates
 * it (still live while migrations run, or again after a rollback) in theirs.
 */
const MIGRATION = "0042_recording_access.sql";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

/** Every migration before 0042, with two cohorts and a recording with segments in each state. */
function beforeMigration() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(new URL("./", import.meta.url)).filter((name) => name.endsWith(".sql") && name < MIGRATION).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId) VALUES ('cohort-a','Cohort A','Test','curriculum'),('cohort-b','Cohort B','Test','curriculum');
    INSERT INTO recording(id,programId,title,processingStatus) VALUES ('in-cohort','cohort-a','Week 1','complete'),('no-cohort',NULL,'Unsorted','complete');
    INSERT INTO transcript_segment(id,recordingId,startTime,endTime,text) VALUES ('s1','in-cohort',0,4,'Habari'),('s2','no-cohort',0,4,'Karibu');`);
  return database;
}

const scopes = (database: DatabaseSync) =>
  Object.fromEntries((database.prepare("SELECT id, accessScope FROM recording ORDER BY id").all() as { id: string; accessScope: string }[])
    .map(({ id, accessScope }) => [id, accessScope]));

/** The statements after the three ADD COLUMNs: what may run again (the ADD COLUMNs themselves only run once). */
const repeatable = () => readMigration(MIGRATION).split("\n").filter((line) => !line.startsWith("ALTER TABLE")).join("\n");

describe("migration 0042, recording access", () => {
  it("adds the columns with no rebuild: segments survive, and a missing scope means admins only", () => {
    const database = beforeMigration();
    database.exec(readMigration(MIGRATION));
    expect(scopes(database)).toEqual({ "in-cohort": "COHORT", "no-cohort": "ADMIN_ONLY" });
    expect(database.prepare("SELECT count(*) AS n FROM transcript_segment").get()).toEqual({ n: 2 });
    expect(database.prepare("SELECT deletedAt, hiddenAt FROM recording WHERE id = 'in-cohort'").get()).toEqual({ deletedAt: null, hiddenAt: null });
    expect(readMigration(MIGRATION)).not.toMatch(/DROP TABLE|CREATE TABLE|RENAME/i);
  });

  it("can run its backfill and triggers again without changing anything", () => {
    const database = beforeMigration();
    database.exec(readMigration(MIGRATION));
    const once = scopes(database);
    expect(() => database.exec(repeatable())).not.toThrow();
    expect(scopes(database)).toEqual(once);
  });

  it("puts a recording an older Worker inserts with a cohort in that cohort, and one without in admins only", () => {
    const database = beforeMigration();
    database.exec(readMigration(MIGRATION));
    // The old importer's and upload's insert: no accessScope column named.
    database.exec(`INSERT INTO recording(id,programId,title) VALUES ('imported','cohort-b','Week 2'),('uploaded',NULL,'Loose file')`);
    expect(scopes(database)).toMatchObject({ imported: "COHORT", uploaded: "ADMIN_ONLY" });
  });

  it("moves a cohort or admins-only recording's audience with its cohort, never a conversation's or the community's", () => {
    const database = beforeMigration();
    database.exec(readMigration(MIGRATION));
    database.exec("UPDATE recording SET programId = NULL WHERE id = 'in-cohort'");
    database.exec("UPDATE recording SET programId = 'cohort-b' WHERE id = 'no-cohort'");
    expect(scopes(database)).toEqual({ "in-cohort": "ADMIN_ONLY", "no-cohort": "COHORT" });
    database.exec(`INSERT INTO recording(id,programId,title,accessScope) VALUES ('call',NULL,'A check-in','DIRECT'),('event',NULL,'Open hours','COMMUNITY')`);
    database.exec("UPDATE recording SET programId = 'cohort-a' WHERE id IN ('call','event')");
    expect(scopes(database)).toMatchObject({ call: "DIRECT", event: "COMMUNITY" });
    // A title change touches no scope.
    database.exec("UPDATE recording SET title = 'Renamed' WHERE id = 'in-cohort'");
    expect(scopes(database)["in-cohort"]).toBe("ADMIN_ONLY");
  });

  it("refuses any other scope, on insert and on update", () => {
    const database = beforeMigration();
    database.exec(readMigration(MIGRATION));
    expect(() => database.exec(`INSERT INTO recording(id,title,accessScope) VALUES ('odd','Odd','PUBLIC')`))
      .toThrow("recording.accessScope must be COHORT, DIRECT, COMMUNITY or ADMIN_ONLY");
    expect(() => database.exec(`UPDATE recording SET accessScope = 'cohort' WHERE id = 'in-cohort'`))
      .toThrow("recording.accessScope must be COHORT, DIRECT, COMMUNITY or ADMIN_ONLY");
    expect(() => database.exec(`UPDATE recording SET accessScope = NULL WHERE id = 'in-cohort'`)).toThrow("NOT NULL constraint failed: recording.accessScope");
    expect(scopes(database)).toEqual({ "in-cohort": "COHORT", "no-cohort": "ADMIN_ONLY" });
  });
});
