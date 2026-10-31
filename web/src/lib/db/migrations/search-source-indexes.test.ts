import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

const migration = readMigration("0024_search_source_indexes.sql");
describe("search source index migration", () => {
  it("chains metadata with only the two authorized index additions", () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
    const before = read("./meta/0023_snapshot.json");
    const after = read("./meta/0024_snapshot.json");
    expect(after.prevId).toBe(before.id);
    expect(after.tables.recording.indexes.recording_program_idx.columns).toEqual(["programId"]);
    expect(after.tables.transcript_segment.indexes.transcript_segment_recording_time_idx.columns).toEqual(["recordingId", "startTime", "id"]);
    delete after.tables.recording.indexes.recording_program_idx;
    delete after.tables.transcript_segment.indexes.transcript_segment_recording_time_idx;
    expect(after.tables).toEqual(before.tables);
    expect(read("./meta/_journal.json").entries.find((entry: { idx: number }) => entry.idx === 24))
      .toMatchObject({ tag: "0024_search_source_indexes" });
  });

  it("applies to populated historical schema, preserves data and safely reapplies", () => {
    const { database } = createSqliteD1();
    try {
      for (const file of readdirSync(new URL("./", import.meta.url)).filter(n => n.endsWith(".sql") && n < "0024").toSorted()) database.exec(readMigration(file));
      database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Test','Test');
        INSERT INTO program(id,name,description,curriculumId) VALUES ('cohort','Test','Test','curriculum');
        INSERT INTO recording(id,programId,title,processingStatus) VALUES ('session','cohort','Test session','complete');
        INSERT INTO transcript_segment(id,recordingId,startTime,endTime,text) VALUES
          ('first','session',1,2,'Evidence'),('same-time','session',1,2,'Another segment');`);
      const before = database.prepare("SELECT * FROM transcript_segment ORDER BY id").all();
      const recording = database.prepare("SELECT * FROM recording").all();
      database.exec(migration); database.exec(migration);
      expect(database.prepare("SELECT * FROM transcript_segment ORDER BY id").all()).toEqual(before);
      expect(database.prepare("SELECT * FROM recording").all()).toEqual(recording);
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(database.prepare("PRAGMA index_info('recording_program_idx')").all().map(r => r.name)).toEqual(["programId"]);
      expect(database.prepare("PRAGMA index_info('transcript_segment_recording_time_idx')").all().map(r => r.name)).toEqual(["recordingId", "startTime", "id"]);
      expect(() => database.exec("INSERT INTO transcript_segment(id,recordingId,startTime,endTime,text) VALUES ('invalid','missing',0,1,'Invalid')")).toThrow(/FOREIGN KEY/);
    } finally { database.close(); }
  });
});
