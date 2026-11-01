import { readFileSync, readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

const migration = readMigration("0032_moderation_pipeline.sql");
const DAY = 24 * 60 * 60_000;

/** Every migration before 0032, a populated channel, then 0032 twice. */
function migrated() {
  const { database } = createSqliteD1();
  for (const file of readdirSync(new URL("./", import.meta.url)).filter((n) => n.endsWith(".sql") && n < "0032").toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO "user"(id,name,email) VALUES ('wanjiku','Wanjiku Kamau','w@example.test'),
    ('otieno','Otieno Ouma','o@example.test'),('amina','Amina Hassan','a@example.test')`);
  const help = (database.prepare("SELECT id FROM channel WHERE slug = 'help'").get() as { id: string }).id;
  database.prepare(`INSERT INTO channel_message(id,channelId,seq,changeSeq,authorId,body,createdAt) VALUES ('before',?,1,1,'wanjiku','Hello',1000)`).run(help);
  database.exec(migration);
  database.exec(migration);
  return { database, help };
}

const versions = (database: DatabaseSync, messageId: string) => database.prepare(
  "SELECT body, cause, capturedAt FROM channel_message_version WHERE messageId = ? ORDER BY capturedAt, rowid",
).all(messageId);
const caseOf = (database: DatabaseSync, messageId: string) => database.prepare(
  `SELECT state, source, reasons, reportCount, actorId, openedAt, updatedAt, decision, decisionReason, decidedBy, decidedAt
   FROM moderation_case WHERE messageId = ?`,
).get(messageId);

function writer(database: DatabaseSync, channelId: string) {
  let seq = 1;
  const event = database.prepare(`INSERT INTO moderation_event(id,messageId,action,source,actorId,fromState,toState,reasons,createdAt)
    VALUES (lower(hex(randomblob(8))),?,?,?,?,?,?,?,?)`);
  return {
    post(id: string, body: string, at: number, state: "VISIBLE" | "FLAGGED" = "VISIBLE") {
      seq += 1;
      database.prepare(`INSERT INTO channel_message(id,channelId,seq,changeSeq,authorId,body,moderationState,moderationReasons,createdAt)
        VALUES (?,?,?,?,'wanjiku',?,?,?,?)`).run(id, channelId, seq, seq, body, state, state === "VISIBLE" ? "[]" : '["Shares a phone number"]', at);
    },
    edit: (id: string, body: string, at: number) =>
      database.prepare("UPDATE channel_message SET body = ?, editedAt = ? WHERE id = ?").run(body, at, id),
    remove: (id: string, at: number) =>
      database.prepare("UPDATE channel_message SET body = '', deletedAt = ? WHERE id = ?").run(at, id),
    event: (id: string, action: string, source: string, actor: string | null, from: string, to: string, reasons: string[], at: number) =>
      event.run(id, action, source, actor, from, to, JSON.stringify(reasons), at),
    state: (id: string, state: string, reasons: string[], hiddenAt: number | null = null) =>
      database.prepare("UPDATE channel_message SET moderationState = ?, moderationReasons = ?, hiddenAt = ? WHERE id = ?")
        .run(state, JSON.stringify(reasons), hiddenAt, id),
  };
}

describe("moderation pipeline migration", () => {
  it("chains metadata with only the three tables and the name index added", () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
    const before = read("./meta/0031_snapshot.json");
    const after = read("./meta/0032_snapshot.json");
    expect(after.prevId).toBe(before.id);
    expect(Object.keys(after.tables.channel_message_version.columns)).toEqual(["id", "messageId", "body", "cause", "capturedAt", "retained"]);
    expect(Object.keys(after.tables.moderation_allowlist.columns)).toEqual(["key", "messageId", "createdBy", "createdAt"]);
    expect(Object.keys(after.tables.moderation_case.columns)).toEqual([
      "messageId", "state", "source", "reasons", "reportCount", "actorId", "openedAt", "updatedAt",
      "decision", "decisionReason", "decidedBy", "decidedAt", "reviewRequestedAt", "reviewNote",
    ]);
    expect(Object.keys(after.tables.user.indexes).toSorted()).toEqual(["user_email_unique", "user_name_lower_idx"]);
    delete after.tables.channel_message_version;
    delete after.tables.moderation_allowlist;
    delete after.tables.moderation_case;
    delete after.tables.user.indexes.user_name_lower_idx;
    expect(after.tables).toEqual(before.tables);
    expect(read("./meta/_journal.json").entries.find((entry: { idx: number }) => entry.idx === 32))
      .toMatchObject({ tag: "0032_moderation_pipeline" });
  });

  it("applies to a populated database and reapplies without touching existing rows", () => {
    const { database } = migrated();
    try {
      expect(database.prepare("SELECT id, body, moderationState FROM channel_message").all())
        .toEqual([{ id: "before", body: "Hello", moderationState: "VISIBLE" }]);
      expect(database.prepare("SELECT COUNT(*) AS n FROM channel_message_version").get()).toEqual({ n: 0 });
      const triggers = database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%version%' OR name LIKE 'moderation_event_case%' ORDER BY name").all();
      expect(triggers.map((row) => row.name)).toEqual([
        "channel_message_version_insert", "channel_message_version_prune", "channel_message_version_update",
        "message_report_version", "message_report_version_retain", "moderation_event_case_decision", "moderation_event_case_signal",
        "moderation_event_version_retain",
      ]);
    } finally { database.close(); }
  });

  it("keeps the text each edit and delete replaces, and the text that was flagged, hidden or reported", () => {
    const { database, help } = migrated();
    try {
      const w = writer(database, help);
      w.post("m1", "Call me on 0712 345 678", 10_000, "FLAGGED");
      expect(versions(database, "m1")).toEqual([{ body: "Call me on 0712 345 678", cause: "FLAG", capturedAt: 10_000 }]);
      // An edit keeps the text it replaced (not again: it is already the newest kept).
      w.edit("m1", "Call me sometime", 20_000);
      w.edit("m1", "Call me on 0733 222 444", 30_000);
      expect(versions(database, "m1").map((v) => [v.body, v.cause, v.capturedAt])).toEqual([
        ["Call me on 0712 345 678", "FLAG", 10_000], ["Call me sometime", "EDIT", 30_000],
      ]);
      // A moderation update keeps the text it judged, at its event's time.
      w.event("m1", "HIDE", "CLEF", null, "FLAGGED", "HIDDEN", ["May be abusive"], 40_000);
      w.state("m1", "HIDDEN", ["Shares a phone number", "May be abusive"], 40_000);
      database.prepare("INSERT INTO message_report(id,messageId,reporterId,reason,createdAt) VALUES ('r1','m1','otieno','Spam',45_000)").run();
      w.remove("m1", 50_000);
      expect(versions(database, "m1").map((v) => [v.body, v.cause, v.capturedAt])).toEqual([
        ["Call me on 0712 345 678", "FLAG", 10_000], ["Call me sometime", "EDIT", 30_000],
        ["Call me on 0733 222 444", "HIDE", 40_000],
      ]);
      // A report of an unchanged text after the snapshot keeps nothing new; a report of new text does.
      w.post("m2", "Buy followers today", 60_000);
      database.prepare("INSERT INTO message_report(id,messageId,reporterId,reason,createdAt) VALUES ('r2','m2','otieno','Spam',61_000)").run();
      w.edit("m2", "Buy followers today, cheap", 62_000);
      w.remove("m2", 63_000);
      expect(versions(database, "m2").map((v) => [v.body, v.cause])).toEqual([
        ["Buy followers today", "REPORT"], ["Buy followers today, cheap", "DELETE"],
      ]);
      // An ordinary edit of a visible message is kept too; restoring keeps nothing.
      w.post("m3", "First draft", 70_000);
      w.edit("m3", "Second draft", 71_000);
      w.state("m3", "VISIBLE", []);
      expect(versions(database, "m3").map((v) => v.cause)).toEqual(["EDIT"]);
    } finally { database.close(); }
  });

  it("prunes unmoderated edits after 14 days, and never evidence of a moderated message", () => {
    const { database, help } = migrated();
    try {
      const w = writer(database, help);
      w.post("plain", "Draft one", 1_000);
      w.edit("plain", "Draft two", 2_000);
      w.post("reported", "Rude words", 1_000);
      w.edit("reported", "Kind words", 2_000);
      database.prepare("INSERT INTO message_report(id,messageId,reporterId,reason,createdAt) VALUES ('r','reported','otieno','Rude',3_000)").run();
      w.post("flagged", "0712345678", 1_000, "FLAGGED");
      w.event("flagged", "FLAG", "DETECTOR", null, "VISIBLE", "FLAGGED", ["Shares a phone number"], 1_000);
      w.edit("flagged", "Never mind", 2_000);
      // 14 days later, to the millisecond, nothing has expired; one more and it has.
      w.post("later", "Later one", 2_000 + 14 * DAY - 1);
      w.edit("later", "Later two", 2_000 + 14 * DAY - 1);
      expect(versions(database, "plain")).toHaveLength(1);
      w.edit("later", "Later three", 2_000 + 14 * DAY);
      expect(versions(database, "plain")).toEqual([]);
      expect(versions(database, "reported").map((v) => v.cause)).toEqual(["EDIT", "REPORT"]);
      expect(versions(database, "flagged").map((v) => v.cause)).toEqual(["FLAG"]);
      // Retained evidence is out of the expiry index: pruning reads only what it deletes.
      expect(database.prepare("SELECT messageId, cause, retained FROM channel_message_version ORDER BY messageId, rowid").all()).toEqual([
        { messageId: "flagged", cause: "FLAG", retained: 1 }, { messageId: "later", cause: "EDIT", retained: 0 },
        { messageId: "later", cause: "EDIT", retained: 0 }, { messageId: "reported", cause: "EDIT", retained: 1 },
        { messageId: "reported", cause: "REPORT", retained: 1 },
      ]);
      const plan = database.prepare(`EXPLAIN QUERY PLAN DELETE FROM channel_message_version
        WHERE cause IN ('EDIT','DELETE') AND retained = 0 AND capturedAt <= ?`).all(0).map((row) => String(row.detail)).join("\n");
      expect(plan).toBe("SEARCH channel_message_version USING INDEX channel_message_version_expiry_idx (capturedAt<?)");
    } finally { database.close(); }
  });

  it("opens, adds to, decides and reopens a case from moderation events", () => {
    const { database, help } = migrated();
    try {
      const w = writer(database, help);
      w.post("m", "Call 0712345678", 1_000, "FLAGGED");
      w.event("m", "FLAG", "DETECTOR", null, "VISIBLE", "FLAGGED", ["Shares a phone number"], 1_000);
      expect(caseOf(database, "m")).toMatchObject({ state: "PENDING", source: "AI_FLAG", reasons: '["Shares a phone number"]', reportCount: 0, openedAt: 1_000 });
      w.event("m", "FLAG", "REPORT", "otieno", "FLAGGED", "FLAGGED", ["Spam"], 2_000);
      w.event("m", "FLAG", "REPORT", "amina", "FLAGGED", "FLAGGED", ["Spam"], 2_500);
      expect(caseOf(database, "m")).toMatchObject({ source: "REPORT", reasons: '["Shares a phone number","Spam"]', reportCount: 2, updatedAt: 2_500 });
      w.event("m", "HIDE", "MENTOR", "amina", "FLAGGED", "HIDDEN", ["Contact details"], 3_000);
      // A weaker signal after a hide keeps the stronger source and its moderator.
      w.event("m", "FLAG", "CLEF", null, "HIDDEN", "HIDDEN", ["May share contact details"], 3_500);
      expect(caseOf(database, "m")).toMatchObject({ state: "PENDING", source: "MENTOR_HIDE", actorId: "amina", reportCount: 2, openedAt: 1_000 });

      w.event("m", "KEEP", "ADMIN", "wanjiku", "HIDDEN", "VISIBLE", ["Fine in context"], 4_000);
      expect(caseOf(database, "m")).toMatchObject({
        state: "DECIDED", source: "MENTOR_HIDE", decision: "KEEP", decisionReason: "Fine in context", decidedBy: "wanjiku", decidedAt: 4_000,
      });
      // A new signal after the decision is a new case.
      w.event("m", "FLAG", "REPORT", "wanjiku", "VISIBLE", "VISIBLE", ["Still spam"], 5_000);
      expect(caseOf(database, "m")).toEqual({
        state: "PENDING", source: "REPORT", reasons: '["Still spam"]', reportCount: 1, actorId: null, openedAt: 5_000, updatedAt: 5_000,
        decision: null, decisionReason: null, decidedBy: null, decidedAt: null,
      });
    } finally { database.close(); }
  });

  it("counts only flags and hides as signals", () => {
    const { database, help } = migrated();
    try {
      const w = writer(database, help);
      w.post("m", "Text", 1_000);
      w.event("m", "RESTORE", "MENTOR", "amina", "VISIBLE", "VISIBLE", ["Not a signal"], 2_000);
      expect(caseOf(database, "m")).toBeUndefined();
    } finally { database.close(); }
  });

  it("opens a decided case for an admin's own hide, and none for a restore without a case", () => {
    const { database, help } = migrated();
    try {
      const w = writer(database, help);
      w.post("hidden", "Rude", 1_000);
      w.event("hidden", "HIDE", "ADMIN", "wanjiku", "VISIBLE", "HIDDEN", ["Harassment"], 2_000);
      expect(caseOf(database, "hidden")).toMatchObject({ state: "DECIDED", source: "ADMIN_HIDE", actorId: "wanjiku", decision: "HIDE", decisionReason: "Harassment" });
      w.post("kept", "Fine", 1_000);
      w.event("kept", "RESTORE", "ADMIN", "wanjiku", "VISIBLE", "VISIBLE", ["Fine"], 2_000);
      expect(caseOf(database, "kept")).toBeUndefined();
    } finally { database.close(); }
  });

  it("constrains cases, versions and allowlist keys, and follows people and messages out", () => {
    const { database, help } = migrated();
    try {
      const w = writer(database, help);
      w.post("m", "Text", 1_000);
      const insertCase = database.prepare(`INSERT INTO moderation_case(messageId,state,source,reasons,openedAt,updatedAt,decision,decisionReason,decidedAt)
        VALUES ('m',?,?,?,1,1,?,?,?)`);
      expect(() => insertCase.run("DECIDED", "REPORT", '["x"]', null, null, null)).toThrow(/CHECK/);
      expect(() => insertCase.run("PENDING", "REPORT", '["x"]', "KEEP", "x", 1)).toThrow(/CHECK/);
      expect(() => insertCase.run("PENDING", "OTHER", '["x"]', null, null, null)).toThrow(/CHECK/);
      expect(() => insertCase.run("PENDING", "REPORT", "[]", null, null, null)).toThrow(/CHECK/);
      const insertVersion = database.prepare("INSERT INTO channel_message_version(id,messageId,body,cause,capturedAt) VALUES ('v','m',?,?,1)");
      expect(() => insertVersion.run("", "EDIT")).toThrow(/CHECK/);
      expect(() => insertVersion.run("x", "OTHER")).toThrow(/CHECK/);
      const allow = database.prepare("INSERT INTO moderation_allowlist(key,messageId,createdBy,createdAt) VALUES (?,'m','wanjiku',1)");
      for (const key of [`text:${"a".repeat(64)}`, "phone:+254712345678", "phone:07123456789", "email:w@gmail.com", "link:wa.me/2547"]) allow.run(key);
      for (const key of ["text:XYZ", "phone:abc", "email:nope", "other:x", "link:"]) expect(() => allow.run(key), `${key}`).toThrow(/CHECK/);

      w.event("m", "HIDE", "MENTOR", "amina", "VISIBLE", "HIDDEN", ["Rude"], 2_000);
      database.exec(`DELETE FROM "user" WHERE id IN ('amina', 'wanjiku')`);
      expect(caseOf(database, "m")).toMatchObject({ actorId: null });
      expect(database.prepare("SELECT messageId, createdBy FROM moderation_allowlist LIMIT 1").get()).toEqual({ messageId: "m", createdBy: null });
      database.prepare("DELETE FROM channel WHERE id = ?").run(help);
      for (const table of ["moderation_case", "channel_message_version"]) {
        expect(database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), `${table}`).toEqual({ n: 0 });
      }
      expect(database.prepare("SELECT COUNT(*) AS n FROM moderation_allowlist WHERE messageId IS NULL").get()).toEqual({ n: 5 });
    } finally { database.close(); }
  });

  it("reads the queue, a message's evidence and names through their indexes", () => {
    const { database } = migrated();
    try {
      const plan = (sql: string, ...params: (string | number)[]) =>
        database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => String(row.detail)).join("\n");
      expect(plan("SELECT messageId FROM moderation_case WHERE state = ? ORDER BY openedAt DESC, messageId DESC LIMIT 20", "PENDING"))
        .toContain("moderation_case_queue_idx (state=?)");
      expect(plan("SELECT body FROM channel_message_version WHERE messageId = ? ORDER BY capturedAt", "m"))
        .toContain("channel_message_version_message_idx (messageId=?)");
      expect(plan(`SELECT id FROM "user" WHERE lower(name) IN (SELECT value FROM json_each(?))`, "[]"))
        .toContain("user_name_lower_idx");
    } finally { database.close(); }
  });
});
