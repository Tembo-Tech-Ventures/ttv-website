import { readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { readMigration } from "@/test/sqlite-d1";
import {
  CALL_PROPOSAL_STATES, MEETING_END_REASONS, MEETING_PURPOSES, MEETING_RECORDING_POLICIES, MEETING_STATES,
} from "@/lib/meetings/rules";

/*
 * 0043: in-app calls' tables, the three call flags, and recording scopes that fail closed. `recording`
 * and `communityConfirmation` are referenced by other tables with foreign keys on, so the migration
 * must add to them without a rebuild and keep every row. A Worker from before it (still live while
 * migrations run, or again after a rollback) must keep working: its imports stay in their cohort.
 */
const MIGRATION = "0043_meetings.sql";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

/** Every migration before 0043, with two cohorts, recordings in each scope, and a confirmed piece of work. */
function beforeMigration() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(new URL("./", import.meta.url)).filter((name) => name.endsWith(".sql") && name < MIGRATION).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO user(id,name,email) VALUES ('wanjiku','Wanjiku Njeri','wanjiku@example.test'),('otieno','Otieno Ouma','otieno@example.test');
    INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId) VALUES ('cohort-a','Cohort A','Test','curriculum'),('cohort-b','Cohort B','Test','curriculum');
    INSERT INTO recording(id,programId,title,processingStatus) VALUES ('in-cohort','cohort-a','Week 1','complete'),('no-cohort',NULL,'Unsorted','complete');
    UPDATE recording SET accessScope = 'ADMIN_ONLY' WHERE id = 'no-cohort';
    INSERT INTO transcript_segment(id,recordingId,startTime,endTime,text) VALUES ('s1','in-cohort',0,4,'Habari'),('s2','no-cohort',0,4,'Karibu');
    INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES ('work','wanjiku','Bus fare splitter','A small app','2026-11','institution');
    INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion) VALUES ('confirmed','work','otieno','It runs','Walked through it',1);
    UPDATE feature_flag SET audience = 'STAFF' WHERE key = 'channels';`);
  return database;
}

function migrated() {
  const database = beforeMigration();
  database.exec(readMigration(MIGRATION));
  return database;
}

const scopes = (database: DatabaseSync) =>
  Object.fromEntries((database.prepare("SELECT id, accessScope FROM recording ORDER BY id").all() as { id: string; accessScope: string }[])
    .map(({ id, accessScope }) => [id, accessScope]));
const flags = (database: DatabaseSync) => database.prepare("SELECT key, audience FROM feature_flag ORDER BY key").all();
const count = (database: DatabaseSync, table: string) => (database.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

/** The statements that may run again: all but the ADD COLUMNs, which SQLite runs once. */
const repeatable = () => readMigration(MIGRATION).split("\n").filter((line) => !line.startsWith("ALTER TABLE")).join("\n");

const COMMUNITY_CHANNEL = (database: DatabaseSync) => (database.prepare("SELECT id FROM channel WHERE kind = 'COMMUNITY' ORDER BY id LIMIT 1").get() as { id: string }).id;
const COHORT_CHANNEL = (database: DatabaseSync) =>
  (database.prepare("SELECT id FROM channel WHERE seedKey = 'cohort:cohort-a:main'").get() as { id: string }).id;
const insertMeeting = (database: DatabaseSync, values: Record<string, string | number | null> = {}) => {
  const row = { id: "call", channelId: COHORT_CHANNEL(database), purpose: "SESSION", title: "Week 5", scheduledStartAt: 1_795_600_000_000,
    bookedMinutes: 60, limitMinutes: 90, recordingPolicy: "ALWAYS", ...values };
  const columns = Object.keys(row);
  database.prepare(`INSERT INTO meeting(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(row));
};

describe("migration 0043, in-app calls", () => {
  it("adds to recording and communityConfirmation with no rebuild: every row and segment survives, its scope unchanged", () => {
    const before = beforeMigration();
    const scopesBefore = scopes(before);
    before.exec(readMigration(MIGRATION));
    expect(scopes(before)).toEqual(scopesBefore);
    expect(scopes(before)).toEqual({ "in-cohort": "COHORT", "no-cohort": "ADMIN_ONLY" });
    expect(count(before, "transcript_segment")).toBe(2);
    expect(before.prepare("SELECT meetingId, channelId, scopeChosen FROM recording WHERE id = 'in-cohort'").get())
      .toEqual({ meetingId: null, channelId: null, scopeChosen: null });
    expect(before.prepare("SELECT id, meetingId FROM communityConfirmation").all()).toEqual([{ id: "confirmed", meetingId: null }]);
    expect(before.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(readMigration(MIGRATION)).not.toMatch(/DROP TABLE|RENAME|__new_|ALTER TABLE `(?!recording|communityConfirmation)/i);
    expect(readMigration(MIGRATION).match(/ALTER TABLE `\w+` ADD `\w+`/g)).toEqual([
      "ALTER TABLE `communityConfirmation` ADD `meetingId`", "ALTER TABLE `recording` ADD `meetingId`",
      "ALTER TABLE `recording` ADD `channelId`", "ALTER TABLE `recording` ADD `scopeChosen`",
    ]);
  });

  it("seeds the three call flags OFF and leaves every other flag as an admin set it", () => {
    const database = migrated();
    expect(flags(database)).toEqual([
      { key: "channels", audience: "STAFF" }, { key: "meeting_checkins", audience: "OFF" }, { key: "meeting_events", audience: "OFF" },
      { key: "meetings", audience: "OFF" }, { key: "mentor_requests", audience: "OFF" }, { key: "onboarding", audience: "OFF" },
      { key: "spaces", audience: "OFF" }, { key: "tembo_channels", audience: "OFF" },
    ]);
  });

  it("can run again without changing anything: tables, flags, triggers and data", () => {
    const database = migrated();
    database.exec("UPDATE feature_flag SET audience = 'STAFF' WHERE key = 'meetings'");
    insertMeeting(database);
    const schema = () => database.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
    const once = { schema: schema(), flags: flags(database), scopes: scopes(database), meetings: database.prepare("SELECT * FROM meeting").all() };
    expect(() => database.exec(repeatable())).not.toThrow();
    expect({ schema: schema(), flags: flags(database), scopes: scopes(database), meetings: database.prepare("SELECT * FROM meeting").all() }).toEqual(once);
  });

  it("replaces 0042's widening cohort triggers", () => {
    const triggers = (migrated().prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'recording' ORDER BY name").all() as { name: string }[])
      .map(({ name }) => name);
    expect(triggers).toEqual([
      "recording_access_scope_insert", "recording_access_scope_update", "recording_cohort_scope_leave", "recording_unscoped_insert",
    ]);
  });
});

describe("recording scopes after 0043", () => {
  it("puts an older Worker's import with a cohort in that cohort, and one without in admins only", () => {
    const database = migrated();
    // A Worker from before 0042 names no scope; one from 0042 sends Drizzle's default. Neither knows scopeChosen.
    database.exec(`INSERT INTO recording(id,programId,title) VALUES ('imported','cohort-b','Week 2'),('uploaded',NULL,'Loose file');
      INSERT INTO recording(id,programId,title,accessScope) VALUES ('imported-0042','cohort-b','Week 3','ADMIN_ONLY'),('uploaded-0042',NULL,'Loose','ADMIN_ONLY')`);
    expect(scopes(database)).toMatchObject({ imported: "COHORT", uploaded: "ADMIN_ONLY", "imported-0042": "COHORT", "uploaded-0042": "ADMIN_ONLY" });
  });

  it("keeps the scope this Worker names, admins only with a cohort included", () => {
    const database = migrated();
    database.exec(`INSERT INTO recording(id,programId,title,accessScope,scopeChosen) VALUES
      ('kept-private','cohort-a','Staff only','ADMIN_ONLY',1),('cohort','cohort-a','Week 4','COHORT',1),('loose',NULL,'Loose','ADMIN_ONLY',1)`);
    expect(scopes(database)).toMatchObject({ "kept-private": "ADMIN_ONLY", cohort: "COHORT", loose: "ADMIN_ONLY" });
  });

  it("never widens on a cohort change: admins only stays admins only, in the same statement or after", () => {
    const database = migrated();
    database.exec(`INSERT INTO recording(id,programId,title,accessScope,scopeChosen) VALUES ('moved','cohort-a','Week 4','COHORT',1)`);
    // The cohort and admins only in one statement.
    database.exec("UPDATE recording SET programId = 'cohort-b', accessScope = 'ADMIN_ONLY' WHERE id = 'moved'");
    // An admins-only recording moved into a cohort.
    database.exec("UPDATE recording SET programId = 'cohort-b' WHERE id = 'no-cohort'");
    expect(scopes(database)).toMatchObject({ moved: "ADMIN_ONLY", "no-cohort": "ADMIN_ONLY" });
  });

  it("narrows a cohort's recording moved out of every cohort, and keeps one moved to another cohort that cohort's", () => {
    const database = migrated();
    database.exec(`INSERT INTO recording(id,programId,title,accessScope,scopeChosen) VALUES ('refiled','cohort-a','Week 4','COHORT',1)`);
    database.exec("UPDATE recording SET programId = NULL WHERE id = 'in-cohort'");
    database.exec("UPDATE recording SET programId = 'cohort-b' WHERE id = 'refiled'");
    // Even when the same statement says COHORT, a recording with no cohort is admins only.
    database.exec("UPDATE recording SET programId = NULL, accessScope = 'COHORT' WHERE id = 'refiled'");
    expect(scopes(database)).toMatchObject({ "in-cohort": "ADMIN_ONLY", refiled: "ADMIN_ONLY" });
    database.exec("UPDATE recording SET programId = 'cohort-b', accessScope = 'COHORT' WHERE id = 'refiled'");
    database.exec("UPDATE recording SET programId = 'cohort-a' WHERE id = 'refiled'");
    expect(scopes(database).refiled).toBe("COHORT");
  });

  it("leaves a conversation's or the community's recording alone, and still refuses any other scope", () => {
    const database = migrated();
    database.exec(`INSERT INTO recording(id,programId,title,accessScope,scopeChosen) VALUES ('call',NULL,'A check-in','DIRECT',1),('event','cohort-a','Open hours','COMMUNITY',1)`);
    database.exec("UPDATE recording SET programId = 'cohort-a' WHERE id = 'call'");
    database.exec("UPDATE recording SET programId = NULL WHERE id = 'event'");
    expect(scopes(database)).toMatchObject({ call: "DIRECT", event: "COMMUNITY" });
    expect(() => database.exec(`INSERT INTO recording(id,title,accessScope,scopeChosen) VALUES ('odd','Odd','PUBLIC',1)`))
      .toThrow("recording.accessScope must be COHORT, DIRECT, COMMUNITY or ADMIN_ONLY");
  });
});

describe("the call tables", () => {
  it("takes a call in a channel, with every allowed value, and refuses any other", () => {
    const database = migrated();
    for (const [i, purpose] of MEETING_PURPOSES.entries()) {
      insertMeeting(database, { id: `purpose-${i}`, purpose, journeyVersion: purpose === "CHECKIN" ? 1 : null });
    }
    for (const [i, recordingPolicy] of MEETING_RECORDING_POLICIES.entries()) insertMeeting(database, { id: `policy-${i}`, recordingPolicy });
    for (const [i, state] of MEETING_STATES.entries()) {
      const live = state === "LIVE" || state === "ENDED";
      insertMeeting(database, { id: `state-${i}`, state, openedAt: live ? 1_795_600_000_000 : null,
        endedAt: state === "ENDED" ? 1_795_605_400_000 : null, endReason: state === "ENDED" ? "LIMIT" : null });
    }
    for (const [i, endReason] of MEETING_END_REASONS.entries()) {
      insertMeeting(database, { id: `ended-${i}`, state: "ENDED", openedAt: 1, endedAt: 2, endReason });
    }
    const values = "meeting: purpose, state, recordingPolicy and endReason take only their allowed values";
    expect(() => insertMeeting(database, { id: "odd", purpose: "WEBINAR" })).toThrow(values);
    expect(() => insertMeeting(database, { id: "odd", recordingPolicy: "SOMETIMES" })).toThrow(values);
    expect(() => insertMeeting(database, { id: "odd", state: "PAUSED" })).toThrow(values);
    expect(() => insertMeeting(database, { id: "odd", state: "ENDED", openedAt: 1, endedAt: 2, endReason: "BORED" })).toThrow(values);
    expect(() => database.exec("UPDATE meeting SET state = 'PAUSED' WHERE id = 'purpose-0'")).toThrow(values);
    expect(() => database.exec("UPDATE meeting SET purpose = 'session' WHERE id = 'purpose-0'")).toThrow(values);
  });

  it("holds a call's shape: its title, a check-in's revision, an end only when ended, its minutes and its times", () => {
    const database = migrated();
    const shape = "meeting: a 1 to 120 character title, a check-in's revision, an end only when ended, minutes within the limit and times in order";
    expect(() => insertMeeting(database, { title: "  " })).toThrow(shape);
    expect(() => insertMeeting(database, { title: "x".repeat(121) })).toThrow(shape);
    expect(() => insertMeeting(database, { purpose: "CHECKIN" })).toThrow(shape);
    expect(() => insertMeeting(database, { purpose: "CHECKIN", journeyVersion: 0 })).toThrow(shape);
    expect(() => insertMeeting(database, { state: "LIVE" })).toThrow(shape);
    expect(() => insertMeeting(database, { state: "ENDED", openedAt: 1, endedAt: 2 })).toThrow(shape);
    expect(() => insertMeeting(database, { endedAt: 2 })).toThrow(shape);
    expect(() => insertMeeting(database, { bookedMinutes: 0 })).toThrow(shape);
    expect(() => insertMeeting(database, { bookedMinutes: 60, limitMinutes: 30 })).toThrow(shape);
    expect(() => insertMeeting(database, { scheduledStartAt: -1 })).toThrow(shape);
    expect(() => insertMeeting(database, { createdAt: 10, updatedAt: 5 })).toThrow(shape);
    expect(() => insertMeeting(database, { state: "LIVE", openedAt: 100, hardEndAt: 50 })).toThrow(shape);
    expect(() => insertMeeting(database, { hardEndAt: 50 })).toThrow(shape);
    expect(() => insertMeeting(database, { state: "ENDED", openedAt: 100, endedAt: 50, endReason: "LIMIT" })).toThrow(shape);
    // A table check would make drizzle-kit rebuild a cited table to change it: there are none.
    expect((database.prepare("SELECT sql FROM sqlite_master WHERE name = 'meeting'").get() as { sql: string }).sql).not.toMatch(/CHECK/i);
    insertMeeting(database, { title: "x".repeat(120) });
    expect(() => database.exec("UPDATE meeting SET state = 'ENDED', endedAt = 5 WHERE id = 'call'")).toThrow(shape);
    expect(() => database.exec("UPDATE meeting SET title = '' WHERE id = 'call'")).toThrow(shape);
    expect(() => database.exec("UPDATE meeting SET limitMinutes = 30 WHERE id = 'call'")).toThrow(shape);
    expect(() => database.exec("UPDATE meeting SET updatedAt = 0 WHERE id = 'call'")).toThrow(shape);
    database.exec("UPDATE meeting SET state = 'LIVE', openedAt = 10, hardEndAt = 5410 WHERE id = 'call'");
    database.exec("UPDATE meeting SET state = 'ENDED', endedAt = 5410, endReason = 'LIMIT' WHERE id = 'call'");
    expect(database.prepare("SELECT state, endReason FROM meeting").get()).toEqual({ state: "ENDED", endReason: "LIMIT" });
  });

  it("takes a call's seats, consent and recording-in-progress with it, keeps its recording, and never deletes a confirmation citing it", () => {
    const database = migrated();
    insertMeeting(database);
    database.exec(`INSERT INTO meeting_seat(meetingId,userId,role,lastSeenAt) VALUES ('call','wanjiku','MEMBER',1),('call','otieno','HOST',1);
      INSERT INTO meeting_consent(meetingId,userId,answer,wordingVersion,answeredAt) VALUES ('call','wanjiku','RECORD',1,1);
      INSERT INTO recording(id,programId,title,accessScope,scopeChosen,meetingId,channelId) VALUES ('recorded','cohort-a','Week 5','COHORT',1,'call',NULL);
      INSERT INTO meeting_recording(id,meetingId,recordingId,reservedSeconds) VALUES ('taking','call','recorded',5400);
      UPDATE communityConfirmation SET meetingId = 'call' WHERE id = 'confirmed';`);
    // A confirmation cites the call: deleting it fails loudly rather than taking the confirmation.
    expect(() => database.exec("DELETE FROM meeting WHERE id = 'call'")).toThrow(/FOREIGN KEY constraint failed/);
    expect(count(database, "meeting")).toBe(1);
    expect(count(database, "communityConfirmation")).toBe(1);
    // Removing the confirmation first (as deleting the check-in's recording will, in P12) lets the call go.
    database.exec("DELETE FROM communityConfirmation WHERE meetingId = 'call'");
    database.exec("DELETE FROM meeting WHERE id = 'call'");
    for (const table of ["meeting_seat", "meeting_consent", "meeting_recording"]) expect(count(database, table)).toBe(0);
    expect(database.prepare("SELECT id, meetingId, accessScope FROM recording WHERE id = 'recorded'").get())
      .toEqual({ id: "recorded", meetingId: null, accessScope: "COHORT" });
    expect(count(database, "communityJourney")).toBe(1);
  });

  it("goes with its channel, and a recording loses only its channel, which then admits nobody", () => {
    const database = migrated();
    database.exec(`INSERT INTO channel(id,kind,slug,name) VALUES ('conversation','DIRECT','dm-1','Wanjiku and Otieno')`);
    insertMeeting(database, { channelId: "conversation", purpose: "CALL", recordingPolicy: "BOTH_AGREE" });
    database.exec(`INSERT INTO recording(id,title,accessScope,scopeChosen,meetingId,channelId) VALUES ('private','A call','DIRECT',1,'call','conversation')`);
    database.exec("DELETE FROM channel WHERE id = 'conversation'");
    expect(count(database, "meeting")).toBe(0);
    expect(database.prepare("SELECT meetingId, channelId, accessScope FROM recording WHERE id = 'private'").get())
      .toEqual({ meetingId: null, channelId: null, accessScope: "DIRECT" });
  });

  it("refuses to delete a channel or a cohort whose call a confirmation cites", () => {
    const database = migrated();
    insertMeeting(database);
    database.exec("UPDATE communityConfirmation SET meetingId = 'call' WHERE id = 'confirmed'");
    expect(() => database.exec(`DELETE FROM channel WHERE id = '${COHORT_CHANNEL(database)}'`)).toThrow(/FOREIGN KEY constraint failed/);
    expect(count(database, "communityConfirmation")).toBe(1);
  });

  it("keeps one seat and one consent per person, one recording per call, and one open suggestion per conversation", () => {
    const database = migrated();
    insertMeeting(database);
    database.exec("INSERT INTO meeting_seat(meetingId,userId,role,lastSeenAt) VALUES ('call','wanjiku','MEMBER',1)");
    expect(() => database.exec("INSERT INTO meeting_seat(meetingId,userId,role,lastSeenAt) VALUES ('call','wanjiku','HOST',2)")).toThrow(/UNIQUE/);
    expect(() => database.exec("INSERT INTO meeting_seat(meetingId,userId,role,state,lastSeenAt) VALUES ('call','otieno','GUEST','HELD',1)")).toThrow(/CHECK/);
    database.exec("INSERT INTO meeting_recording(id,meetingId) VALUES ('first','call')");
    expect(() => database.exec("INSERT INTO meeting_recording(id,meetingId) VALUES ('second','call')")).toThrow(/UNIQUE/);
    expect(() => database.exec("UPDATE meeting_recording SET state = 'PAUSED'")).toThrow(/CHECK/);

    const channel = COMMUNITY_CHANNEL(database);
    const propose = (id: string, state = "OPEN") => database.exec(`INSERT INTO call_proposal(id,channelId,proposedBy,purpose,journeyId,journeyVersion,times,bookedMinutes,state,decidedAt)
      VALUES ('${id}','${channel}','wanjiku','CHECKIN','work',1,'[1795600000000,1795686400000]',30,'${state}',${state === "OPEN" ? "NULL" : "unixepoch() * 1000"})`);
    propose("open");
    expect(() => propose("again")).toThrow(/UNIQUE/);
    for (const [i, closed] of CALL_PROPOSAL_STATES.filter((state) => state !== "OPEN").entries()) propose(`closed-${i}`, closed);
    expect(() => database.exec(`INSERT INTO call_proposal(id,channelId,proposedBy,purpose,times,bookedMinutes) VALUES ('no-work','${channel}','wanjiku','CHECKIN','[1]',30)`)).toThrow(/CHECK/);
    expect(() => database.exec(`INSERT INTO call_proposal(id,channelId,proposedBy,purpose,times,bookedMinutes) VALUES ('four','${channel}','otieno','CALL','[1,2,3,4]',30)`)).toThrow(/CHECK/);
    expect(() => database.exec(`INSERT INTO call_proposal(id,channelId,proposedBy,purpose,times,bookedMinutes) VALUES ('none','${channel}','otieno','CALL','[]',30)`)).toThrow(/CHECK/);
  });

  it("counts a month's use once per UTC month, never below zero", () => {
    const database = migrated();
    database.exec("INSERT INTO meeting_usage_month(month,recordingSecondsReserved) VALUES ('2026-11',5400)");
    expect(() => database.exec("INSERT INTO meeting_usage_month(month) VALUES ('2026-11')")).toThrow(/UNIQUE/);
    expect(() => database.exec("INSERT INTO meeting_usage_month(month) VALUES ('Nov 2026')")).toThrow(/CHECK/);
    for (const month of ["2026-00", "2026-13", "2026-19"]) {
      expect(() => database.exec(`INSERT INTO meeting_usage_month(month) VALUES ('${month}')`)).toThrow(/CHECK/);
    }
    database.exec("INSERT INTO meeting_usage_month(month) VALUES ('2026-12'), ('2027-01')");
    expect(() => database.exec("UPDATE meeting_usage_month SET recordingSecondsUsed = -1")).toThrow(/CHECK/);
  });
});

describe("a Worker from before 0043 against the new schema", () => {
  it("reads and writes recordings and confirmations as it did", () => {
    const database = migrated();
    // Its statements name only the columns it knows.
    database.exec(`INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion,mentorRole) VALUES ('again','work','otieno','Still runs','Call',1,'MENTOR')`);
    database.exec("UPDATE recording SET title = 'Week 1, again', processingStatus = 'queued' WHERE id = 'in-cohort'");
    expect(database.prepare("SELECT id, programId, title, accessScope, deletedAt, hiddenAt FROM recording WHERE id = 'in-cohort'").get())
      .toEqual({ id: "in-cohort", programId: "cohort-a", title: "Week 1, again", accessScope: "COHORT", deletedAt: null, hiddenAt: null });
    expect(database.prepare("SELECT id FROM communityConfirmation ORDER BY id").all()).toEqual([{ id: "again" }, { id: "confirmed" }]);
    database.exec("DELETE FROM communityJourney WHERE id = 'work'");
    expect(count(database, "communityConfirmation")).toBe(0);
  });
});
