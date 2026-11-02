import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

const migration = readMigration("0037_mentor_request_checks.sql");

function populated() {
  const { database } = createSqliteD1();
  for (const file of readdirSync(new URL("./", import.meta.url)).filter((n) => n.endsWith(".sql") && n < "0037").toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO "user"(id,name,email) VALUES ('wanjiku','Wanjiku Kamau','w@example.test'),('david','David Kamau','d@example.test'),
      ('amina','Amina Hassan','a@example.test');
    INSERT INTO mentor_request (id, requesterId, mentorId, format, note, createdAt, updatedAt)
      VALUES ('ask','wanjiku','david','WRITTEN_REVIEW','Could you review my callback?',1,1),
        ('other','david','wanjiku','QUICK_QUESTION','A quick question',1,1);`);
  return database;
}

describe("mentor request checks migration", () => {
  it("chains metadata with only the two new tables", () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
    const before = read("./meta/0036_snapshot.json");
    const after = read("./meta/0037_snapshot.json");
    expect(after.prevId).toBe(before.id);
    expect(Object.keys(after.tables.mentor_request_case.columns)).toEqual(
      ["requestId", "state", "clefReasons", "openedAt", "decision", "decisionReason", "decidedBy", "decidedAt", "closedRequest", "createdAt", "updatedAt"]);
    expect(Object.keys(after.tables.mentor_request_report.columns)).toEqual(["requestId", "reporterId", "reason", "createdAt"]);
    for (const table of ["mentor_request_case", "mentor_request_report"]) delete after.tables[table];
    expect(after.tables).toEqual(before.tables);
    expect(read("./meta/_journal.json").entries.find((entry: { idx: number }) => entry.idx === 37)).toMatchObject({ tag: "0037_mentor_request_checks" });
  });

  it("applies to a populated schema, reapplies safely, and leaves existing requests untouched", () => {
    const database = populated();
    try {
      const existing = database.prepare("SELECT * FROM mentor_request ORDER BY id").all();
      database.exec(migration);
      database.exec(migration);
      expect(database.prepare("SELECT * FROM mentor_request ORDER BY id").all()).toEqual(existing);
      expect(database.prepare("SELECT COUNT(*) AS n FROM mentor_request_case").get()).toEqual({ n: 0 });
    } finally { database.close(); }
  });

  it("constrains states, decisions, reasons and reports", () => {
    const database = populated();
    try {
      database.exec(migration);
      const insertCase = (values: string) => () => database.exec(`INSERT INTO mentor_request_case
        (requestId, state, clefReasons, openedAt, decision, decisionReason, decidedBy, decidedAt, createdAt, updatedAt) VALUES ${values}`);
      expect(insertCase(`('ask','HELD','[]',1,NULL,NULL,NULL,NULL,1,1)`)).toThrow(/CHECK/);
      expect(insertCase(`('ask','OPEN','{}',1,NULL,NULL,NULL,NULL,1,1)`)).toThrow(/CHECK/);
      expect(insertCase(`('ask','DECIDED','[]',1,NULL,NULL,NULL,NULL,1,1)`)).toThrow(/CHECK/);
      expect(insertCase(`('ask','DECIDED','[]',1,'KEEP',NULL,'amina',2,1,2)`)).toThrow(/CHECK/);
      expect(insertCase(`('ask','DECIDED','[]',1,'KEEP',' ','amina',2,1,2)`)).toThrow(/CHECK/);
      expect(insertCase(`('ask','DECIDED','[]',1,'BAN','Abuse','amina',2,1,2)`)).toThrow(/CHECK/);
      expect(insertCase(`('ask','OPEN','[]',1,NULL,NULL,NULL,NULL,2,1)`)).toThrow(/CHECK/);
      expect(insertCase(`('missing','OPEN','[]',1,NULL,NULL,NULL,NULL,1,1)`)).toThrow(/FOREIGN KEY/);
      // Only a removal closes a request.
      const closing = (decision: string, closed: number) => () => database.exec(`INSERT INTO mentor_request_case
        (requestId, state, openedAt, decision, decisionReason, decidedBy, decidedAt, closedRequest, createdAt, updatedAt)
        VALUES ('ask','DECIDED',1,'${decision}','Why','amina',2,${closed},1,2)`);
      expect(closing("KEEP", 1)).toThrow(/CHECK/);
      expect(closing("REMOVE", 2)).toThrow(/CHECK/);
      insertCase(`('ask','DECIDED','["May be abusive"]',1,'KEEP','Fine as written','amina',2,1,2)`)();
      // Reopened after a keep: the earlier decision stays until the next.
      insertCase(`('other','OPEN','[]',3,'KEEP','Fine as written','amina',2,1,3)`)();
      const report = (values: string) => () => database.exec(`INSERT INTO mentor_request_report (requestId, reporterId, reason, createdAt) VALUES ${values}`);
      expect(report(`('ask','david','',1)`)).toThrow(/CHECK/);
      report(`('ask','david','Insults me',1)`)();
      expect(report(`('ask','david','Again',2)`)).toThrow(/UNIQUE/);
    } finally { database.close(); }
  });

  it("cascades with the request and the reporter, and forgets a deleted admin's name only", () => {
    const database = populated();
    try {
      database.exec(migration);
      database.exec(`INSERT INTO mentor_request_case (requestId, state, openedAt, decision, decisionReason, decidedBy, decidedAt, createdAt, updatedAt)
          VALUES ('ask','DECIDED',1,'REMOVE','Abusive','amina',2,1,2), ('other','OPEN',1,NULL,NULL,NULL,NULL,1,1);
        INSERT INTO mentor_request_report (requestId, reporterId, reason, createdAt) VALUES ('other','wanjiku','Rude',1);
        DELETE FROM "user" WHERE id = 'amina';`);
      expect(database.prepare("SELECT requestId, decidedBy FROM mentor_request_case ORDER BY requestId").all())
        .toEqual([{ requestId: "ask", decidedBy: null }, { requestId: "other", decidedBy: null }]);
      database.exec(`DELETE FROM mentor_request WHERE id = 'ask'; DELETE FROM "user" WHERE id = 'wanjiku'`);
      expect(database.prepare("SELECT COUNT(*) AS n FROM mentor_request_case").get()).toEqual({ n: 0 });
      expect(database.prepare("SELECT COUNT(*) AS n FROM mentor_request_report").get()).toEqual({ n: 0 });
    } finally { database.close(); }
  });
});
