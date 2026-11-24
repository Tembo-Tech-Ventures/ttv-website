import { readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigration } from "@/test/sqlite-d1";
import { CAPABILITY_ROLE_MATRIX } from "@/lib/platform/server/capabilities.fixtures";
import { DEMO_PREFIX } from "@/lib/staging-demo-policy";
import { RECORDING_ACCESS_SCOPES } from "@/lib/db/schema";
import {
  cohortAudience, cohortAudienceSql, mayReadRecordings, recordingAccessFor, recordingScopeSql,
  type RecordingAccessTarget, type RecordingViewer,
} from "./access";

/*
 * The recording access policy's two forms, recordingAccessFor (one recording) and recordingScopeSql
 * (a SQL condition), give the same answer for every kind of viewer and every kind of recording, on
 * SQLite with every migration. cohortAudienceSql equals recordingScopeSql for cohortAudience.
 */
const DEMO_PROGRAM = DEMO_PREFIX + "program";
const PROGRAMS = ["cohort-a", "cohort-b", DEMO_PROGRAM, null] as const;
const USER = "synthetic-wanjiku";
const DEMO_USER = DEMO_PREFIX + "member-cohort";

interface Row extends RecordingAccessTarget { id: string }
let database: DatabaseSync;
let rows: Row[];

beforeAll(() => {
  database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(new URL("../db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId) VALUES ('cohort-a','A','Test','curriculum'),('cohort-b','B','Test','curriculum'),
      ('${DEMO_PROGRAM}','Demo','Test','curriculum');`);
  // Every scope, cohort, deletion and hiding: inserted, then set, so the cohort triggers can't
  // normalise the odd ones away (an admins-only recording that still names a cohort).
  const insert = database.prepare("INSERT INTO recording(id,programId,title) VALUES (?,?,'Session')");
  const set = database.prepare("UPDATE recording SET accessScope = ?, deletedAt = ?, hiddenAt = ? WHERE id = ?");
  for (const scope of RECORDING_ACCESS_SCOPES) for (const programId of PROGRAMS) for (const deleted of [null, 1]) for (const hidden of [null, 1]) {
    const id = [scope, programId ?? "none", deleted ? "deleted" : "", hidden ? "hidden" : ""].join(":");
    insert.run(id, programId);
    set.run(scope, deleted, hidden, id);
  }
  rows = database.prepare("SELECT id, programId, accessScope, deletedAt, hiddenAt FROM recording ORDER BY id").all() as unknown as Row[];
});
afterAll(() => database.close());

const viewers: { name: string; viewer: RecordingViewer; userId: string | null }[] = [
  ...CAPABILITY_ROLE_MATRIX.map(({ name, expected }) => ({ name, viewer: expected, userId: USER })),
  { name: "demo member", viewer: { cohortIds: [DEMO_PROGRAM], teachingCohortIds: [], isAdmin: false }, userId: DEMO_USER },
  { name: "demo admin", viewer: { cohortIds: [], teachingCohortIds: [], isAdmin: true }, userId: DEMO_USER },
  { name: "demo instructor", viewer: { cohortIds: [DEMO_PROGRAM], teachingCohortIds: [DEMO_PROGRAM], isAdmin: false }, userId: DEMO_USER },
  ...["cohort-a", "cohort-b", DEMO_PROGRAM].map((programId) => ({ name: `audience of ${programId}`, viewer: cohortAudience(programId), userId: null })),
];

const bySql = (condition: string, ...values: string[]) =>
  (database.prepare(`SELECT id FROM recording r WHERE ${condition} ORDER BY id`).all(...values) as { id: string }[]).map(({ id }) => id);
const byPolicy = (viewer: RecordingViewer, userId: string | null) =>
  rows.filter((row) => recordingAccessFor(viewer, row, { userId })).map(({ id }) => id);

describe("the recording access policy", () => {
  it.each(viewers)("$name: one recording and the SQL condition agree", ({ viewer, userId }) => {
    expect(bySql(recordingScopeSql(viewer, userId, "r"))).toEqual(byPolicy(viewer, userId));
    // The default alias is the table's own name.
    expect((database.prepare(`SELECT id FROM recording WHERE ${recordingScopeSql(viewer, userId)} ORDER BY id`).all() as { id: string }[])
      .map(({ id }) => id)).toEqual(byPolicy(viewer, userId));
  });

  it.each(["cohort-a", "cohort-b", DEMO_PROGRAM])("a cohort channel's audience (%s) is the same rule with the cohort as a parameter", (programId) => {
    expect(bySql(cohortAudienceSql("r", "?1"), programId)).toEqual(byPolicy(cohortAudience(programId), null));
    expect(bySql(cohortAudienceSql("r", "?1"), programId)).toEqual([`COHORT:${programId}::`]);
  });

  it("follows the scope table", () => {
    const sees = (viewer: RecordingViewer, userId: string | null = USER) => byPolicy(viewer, userId);
    const student = { cohortIds: ["cohort-a"], teachingCohortIds: [], isAdmin: false };
    const host = { ...student, teachingCohortIds: ["cohort-a"] };
    const admin = { cohortIds: [], teachingCohortIds: [], isAdmin: true };
    // COHORT: that cohort's people. Never deleted, never hidden from them.
    expect(sees(student)).toEqual(["COHORT:cohort-a::"]);
    // Hidden: also the cohort's hosts.
    expect(sees(host)).toEqual(["COHORT:cohort-a::", "COHORT:cohort-a::hidden"]);
    // Admins: every cohort's, hidden ones and those with no cohort; never a deleted one, a conversation's or the community's.
    expect(sees(admin)).toEqual(rows.filter(({ id }) => /^(COHORT|ADMIN_ONLY):/.test(id) && !id.includes("deleted")).map(({ id }) => id));
    for (const { viewer, userId } of viewers) {
      const seen = sees(viewer, userId);
      expect(seen.filter((id) => id.includes("deleted") || /^(DIRECT|COMMUNITY):/.test(id))).toEqual([]);
      if (!viewer.isAdmin) expect(seen.filter((id) => id.startsWith("ADMIN_ONLY:") || id.startsWith("COHORT:none"))).toEqual([]);
    }
  });

  it("keeps a demo identity to the demo cohort, whatever its roles", () => {
    for (const viewer of [{ cohortIds: ["cohort-a", DEMO_PROGRAM], teachingCohortIds: [], isAdmin: true }, cohortAudience("cohort-a")]) {
      expect(byPolicy(viewer, DEMO_USER).every((id) => id.includes(`:${DEMO_PROGRAM}:`))).toBe(true);
      expect(bySql(recordingScopeSql(viewer, DEMO_USER, "r"))).toEqual(byPolicy(viewer, DEMO_USER));
    }
  });

  it("writes cohorts as quoted literals that no cohort id can break out of", () => {
    const viewer = { cohortIds: ["o'brien", "x') OR 1=1 --"], teachingCohortIds: ["x' OR '1'='1"], isAdmin: false };
    expect(bySql(recordingScopeSql(viewer, USER, "r"))).toEqual([]);
    expect(() => recordingScopeSql({ ...viewer, cohortIds: ["a\0b"] }, USER)).toThrow("NUL");
  });

  it("reads nothing for someone it can admit to no recording", () => {
    expect(mayReadRecordings({ cohortIds: [], teachingCohortIds: [], isAdmin: false })).toBe(false);
    expect(mayReadRecordings({ cohortIds: ["cohort-a"], teachingCohortIds: [], isAdmin: false })).toBe(true);
    expect(mayReadRecordings({ cohortIds: [], teachingCohortIds: [], isAdmin: true })).toBe(true);
    for (const { viewer, userId } of viewers) {
      if (!mayReadRecordings(viewer)) expect(byPolicy(viewer, userId)).toEqual([]);
    }
  });

  it("treats a raw D1 row's numbers like Drizzle's dates", () => {
    const viewer = cohortAudience("cohort-a");
    const row = { programId: "cohort-a", accessScope: "COHORT", deletedAt: null, hiddenAt: null };
    expect(recordingAccessFor(viewer, row, { userId: null })).toBe(true);
    expect(recordingAccessFor(viewer, { ...row, hiddenAt: 0 }, { userId: null })).toBe(false);
    expect(recordingAccessFor(viewer, { ...row, deletedAt: new Date(0) }, { userId: null })).toBe(false);
    expect(recordingAccessFor(viewer, { ...row, accessScope: "PUBLIC" }, { userId: null })).toBe(false);
  });
});
