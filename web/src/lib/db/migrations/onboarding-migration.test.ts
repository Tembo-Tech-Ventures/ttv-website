import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

const migration = readMigration("0025_onboarding.sql");
const databases: ReturnType<typeof createSqliteD1>["database"][] = [];
afterEach(() => { databases.splice(0).forEach(database => database.close()); });

function historicalDatabase() {
  const { database } = createSqliteD1();
  databases.push(database);
  for (const name of readdirSync(new URL("./", import.meta.url)).filter(n => n.endsWith(".sql") && n < "0025").toSorted()) {
    database.exec(readMigration(name));
  }
  database.exec(`INSERT INTO user(id,name,email) VALUES
    ('wairimu','Wairimu Ndung''u','wairimu@example.test'),
    ('otieno','Otieno Ouma','otieno@example.test'),
    ('amina','Amina Hassan','amina@example.test')`);
  return database;
}

function migrated() {
  const database = historicalDatabase();
  database.exec(migration);
  return database;
}

const note = "I review mobile apps and API designs for junior developers.";
function insertRequest(database: ReturnType<typeof migrated>, values: Record<string, unknown>) {
  const row = { id: "request", userId: "wairimu", role: "MENTOR", note, createdAt: 1_000, updatedAt: 1_000, ...values };
  const columns = Object.keys(row);
  database.prepare(`INSERT INTO access_request (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
    .run(...Object.values(row) as (string | number | null)[]);
}
const institution = { role: "INSTITUTION", organisation: "Savanna Mobile Labs", scopeAcknowledgedAt: 1_000 };

describe("onboarding migration", () => {
  it("chains metadata with only the three onboarding tables added", () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
    const before = read("./meta/0024_snapshot.json");
    const after = read("./meta/0025_snapshot.json");
    expect(after.prevId).toBe(before.id);
    const added = ["access_request", "member_intent", "member_onboarding"];
    expect(Object.keys(after.tables).filter(name => !(name in before.tables)).toSorted()).toEqual(added);
    for (const name of added) delete after.tables[name];
    expect(after.tables).toEqual(before.tables);
    expect(read("./meta/_journal.json").entries.find((entry: { idx: number }) => entry.idx === 25))
      .toMatchObject({ tag: "0025_onboarding" });
  });

  it("seeds the onboarding flag OFF, keeps existing flags and data, and reapplies as a no-op", () => {
    const database = historicalDatabase();
    database.exec("UPDATE feature_flag SET audience='STAFF', updatedBy='amina' WHERE key='spaces'");
    const flags = () => database.prepare("SELECT key, audience, updatedBy FROM feature_flag ORDER BY key").all();
    const users = database.prepare("SELECT * FROM user ORDER BY id").all();
    database.exec(migration);
    expect(flags()).toEqual([
      { key: "channels", audience: "OFF", updatedBy: null },
      { key: "mentor_requests", audience: "OFF", updatedBy: null },
      { key: "onboarding", audience: "OFF", updatedBy: null },
      { key: "spaces", audience: "STAFF", updatedBy: "amina" },
      { key: "tembo_channels", audience: "OFF", updatedBy: null },
    ]);

    database.exec("UPDATE feature_flag SET audience='ALL', updatedBy='amina' WHERE key='onboarding'");
    database.exec("INSERT INTO member_onboarding VALUES ('wairimu','NEW',NULL,NULL,1000,1000)");
    database.exec("INSERT INTO member_intent VALUES ('otieno','MENTOR',1000)");
    insertRequest(database, { userId: "otieno" });
    const snapshot = () => ["feature_flag", "member_onboarding", "member_intent", "access_request", "user"]
      .map(table => database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const populated = snapshot();
    database.exec(migration);
    database.exec(migration);
    expect(snapshot()).toEqual(populated);
    expect(database.prepare("SELECT * FROM user ORDER BY id").all()).toEqual(users);
    expect(database.prepare("SELECT audience FROM feature_flag WHERE key='onboarding'").get()).toEqual({ audience: "ALL" });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("allows one pending request per person and role, through the partial unique index", () => {
    const database = migrated();
    insertRequest(database, { id: "first" });
    expect(() => insertRequest(database, { id: "second" })).toThrow(/UNIQUE constraint failed: access_request\.userId, access_request\.role/);
    insertRequest(database, { id: "institution", ...institution });
    insertRequest(database, { id: "other-person", userId: "otieno" });
    database.exec("UPDATE access_request SET status='DECLINED', decidedAt=2000, updatedAt=2000 WHERE id='first'");
    insertRequest(database, { id: "again", createdAt: 3_000, updatedAt: 3_000 });
    database.exec("UPDATE access_request SET status='WITHDRAWN', updatedAt=4000 WHERE id='again'");
    insertRequest(database, { id: "third", createdAt: 5_000, updatedAt: 5_000 });
    expect(() => database.exec("UPDATE access_request SET status='PENDING', decidedAt=NULL WHERE id='first'")).toThrow(/UNIQUE/);
    expect(database.prepare("SELECT id, status FROM access_request WHERE userId='wairimu' AND role='MENTOR' ORDER BY createdAt").all())
      .toEqual([{ id: "first", status: "DECLINED" }, { id: "again", status: "WITHDRAWN" }, { id: "third", status: "PENDING" }]);
    expect(database.prepare("PRAGMA index_info('access_request_pending_idx')").all().map(row => row.name)).toEqual(["userId", "role"]);
  });

  it("keeps each decision id unique while allowing undecided rows", () => {
    const database = migrated();
    insertRequest(database, { id: "a", userId: "wairimu" });
    insertRequest(database, { id: "b", userId: "otieno" });
    database.exec("UPDATE access_request SET status='APPROVED', decisionId='decision', decidedAt=2000, updatedAt=2000 WHERE id='a'");
    expect(() => database.exec("UPDATE access_request SET decisionId='decision' WHERE id='b'")).toThrow(/UNIQUE/);
  });

  it.each([
    ["an unknown intent", "INSERT INTO member_intent VALUES ('wairimu','ADMIN',1000)", /CHECK/],
    ["a duplicate intent", "INSERT INTO member_intent VALUES ('wairimu','MEMBER',1000); INSERT INTO member_intent VALUES ('wairimu','MEMBER',2000)", /UNIQUE/],
    ["an intent for a missing person", "INSERT INTO member_intent VALUES ('missing','MEMBER',1000)", /FOREIGN KEY/],
    ["an unknown stage", "INSERT INTO member_onboarding VALUES ('wairimu','PROMPT',NULL,NULL,1000,1000)", /CHECK/],
    ["a NEW stage that already finished", "INSERT INTO member_onboarding VALUES ('wairimu','NEW',1000,NULL,1000,1000)", /CHECK/],
    ["a NEW stage with a dismissed card", "INSERT INTO member_onboarding VALUES ('wairimu','NEW',NULL,1000,1000,1000)", /CHECK/],
    ["an update before creation", "INSERT INTO member_onboarding VALUES ('wairimu','DONE',NULL,NULL,1000,999)", /CHECK/],
  ])("rejects %s", (_name, sql, error) => {
    const database = migrated();
    expect(() => database.exec(sql)).toThrow(error);
  });

  it.each([
    ["an unknown role", { role: "ADMIN" }],
    ["an unknown status", { status: "OPEN" }],
    ["a short note", { note: "Too short" }],
    ["a note of padding", { note: " ".repeat(30) }],
    ["a long note", { note: "x".repeat(601) }],
    ["an institution without an organisation", { ...institution, organisation: null }],
    ["an institution without the scope acknowledgement", { ...institution, scopeAcknowledgedAt: null }],
    ["a blank organisation", { ...institution, organisation: "   " }],
    ["a long organisation role", { ...institution, organisationRole: "x".repeat(201) }],
    ["a mentor naming an organisation", { organisation: "Savanna Mobile Labs" }],
    ["a mentor with an organisation role", { organisationRole: "Lead" }],
    ["a mentor acknowledging institution scope", { scopeAcknowledgedAt: 1_000 }],
    ["a long link", { link: "https://example.com/" + "x".repeat(2_030) }],
    ["a decision time on a pending request", { decidedAt: 2_000 }],
    ["a decision without its time", { status: "APPROVED" }],
    ["a decision message on a withdrawal", { status: "WITHDRAWN", decisionMessage: "Thanks" }],
    ["a long decision message", { status: "DECLINED", decidedAt: 2_000, decisionMessage: "x".repeat(601) }],
    ["a seen pending request", { requesterSeenAt: 2_000 }],
    ["a withdrawal id on a pending request", { withdrawalId: "withdrawal" }],
    ["a withdrawal id on a decision", { status: "DECLINED", decidedAt: 2_000, withdrawalId: "withdrawal" }],
    ["an update before creation", { updatedAt: 999 }],
    ["a missing requester", { userId: "missing" }],
    ["a missing decider", { status: "APPROVED", decidedAt: 2_000, decidedBy: "missing" }],
  ])("rejects access requests with %s", (_name, values) => {
    const database = migrated();
    expect(() => insertRequest(database, values)).toThrow(/CHECK|FOREIGN KEY/);
    expect(database.prepare("SELECT count(*) AS n FROM access_request").get()).toEqual({ n: 0 });
  });

  it("accepts the shapes the domain writes", () => {
    const database = migrated();
    insertRequest(database, { id: "mentor", link: "https://example.com/wairimu" });
    insertRequest(database, { id: "withdrawn", userId: "amina", status: "WITHDRAWN", withdrawalId: "w1", updatedAt: 2_000 });
    insertRequest(database, { id: "institution", ...institution, organisationRole: "Engineering lead", note: "x".repeat(600) });
    insertRequest(database, { id: "declined", userId: "otieno", status: "DECLINED", decidedAt: 2_000, decidedBy: "amina",
      decisionMessage: "Thank you for offering.", requesterSeenAt: 3_000, updatedAt: 3_000 });
    expect(database.prepare("SELECT id, status FROM access_request ORDER BY id").all()).toEqual([
      { id: "declined", status: "DECLINED" }, { id: "institution", status: "PENDING" }, { id: "mentor", status: "PENDING" },
      { id: "withdrawn", status: "WITHDRAWN" },
    ]);
  });

  it("cascades with the person and keeps a decision when the deciding administrator is deleted", () => {
    const database = migrated();
    database.exec(`INSERT INTO member_onboarding VALUES ('wairimu','DONE',1000,NULL,1000,1000);
      INSERT INTO member_intent VALUES ('wairimu','MENTOR',1000);`);
    insertRequest(database, { id: "approved", status: "APPROVED", decidedAt: 2_000, decidedBy: "amina", decisionId: "d1", updatedAt: 2_000 });
    insertRequest(database, { id: "otieno", userId: "otieno" });
    database.exec("DELETE FROM user WHERE id='amina'");
    expect(database.prepare("SELECT status, decidedBy, decidedAt FROM access_request WHERE id='approved'").get())
      .toEqual({ status: "APPROVED", decidedBy: null, decidedAt: 2_000 });
    database.exec("DELETE FROM user WHERE id='wairimu'");
    for (const table of ["member_onboarding", "member_intent"]) {
      expect(database.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
    expect(database.prepare("SELECT id FROM access_request").all()).toEqual([{ id: "otieno" }]);
  });

  it("indexes the admin queue, the requester's history and decision lookups", () => {
    const database = migrated();
    const plan = (sql: string) => JSON.stringify(database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all());
    expect(plan("SELECT id FROM access_request WHERE status='PENDING' ORDER BY createdAt")).toContain("access_request_queue_idx");
    expect(plan("SELECT id FROM access_request WHERE userId='wairimu' AND role='MENTOR' ORDER BY createdAt DESC"))
      .toContain("access_request_user_idx");
    expect(plan("SELECT id FROM access_request WHERE decisionId='d1'")).toContain("access_request_decision_idx");
  });
});
