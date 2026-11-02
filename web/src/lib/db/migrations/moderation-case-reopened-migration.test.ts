import { readFileSync, readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

const NAME = "0034_moderation_case_reopened";
const migration = readMigration(`${NAME}.sql`);

/** Every migration before this one, and a message by Otieno in #help. */
function populated() {
  const { database } = createSqliteD1();
  for (const file of readdirSync(new URL("./", import.meta.url)).filter((n) => n.endsWith(".sql") && n < NAME).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO "user"(id,name,email) VALUES ('otieno','Otieno Ouma','o@example.test'),('achieng','Achieng Odhiambo','a@example.test')`);
  const help = (database.prepare("SELECT id FROM channel WHERE slug = 'help'").get() as { id: string }).id;
  database.prepare(`INSERT INTO channel_message(id,channelId,seq,changeSeq,authorId,body,createdAt) VALUES ('message',?,1,1,'otieno','Ring me',1)`)
    .run(help);
  return database;
}

let events = 0;
/** A moderation event on the message: a signal (a report) or an admin's decision. */
function event(database: DatabaseSync, at: number, kind: "report" | "keep") {
  const [action, source, actor] = kind === "report" ? ["FLAG", "REPORT", "achieng"] : ["KEEP", "ADMIN", "achieng"];
  database.prepare(`INSERT INTO moderation_event (id, messageId, action, source, actorId, fromState, toState, reasons, createdAt)
    VALUES (?, 'message', ?, ?, ?, 'VISIBLE', 'VISIBLE', json_array(?), ?)`).run(`event-${++events}`, action, source, actor, `Reason ${at}`, at);
}
const caseOf = (database: DatabaseSync) => database.prepare(
  "SELECT state, openedAt, reopenedAt, updatedAt, reasons, reportCount, decision FROM moderation_case WHERE messageId = 'message'",
).get();

describe("moderation case reopened migration", () => {
  it("chains metadata with only moderation_case.reopenedAt added", () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
    const before = read("./meta/0033_snapshot.json");
    const after = read("./meta/0034_snapshot.json");
    expect(after.prevId).toBe(before.id);
    expect(after.tables.moderation_case.columns.reopenedAt).toEqual({
      name: "reopenedAt", type: "integer", primaryKey: false, notNull: false, autoincrement: false,
    });
    delete after.tables.moderation_case.columns.reopenedAt;
    expect(after.tables).toEqual(before.tables);
    expect(read("./meta/_journal.json").entries.find((entry: { idx: number }) => entry.idx === 34)).toMatchObject({ tag: NAME });
  });

  it("leaves existing cases as they were", () => {
    const database = populated();
    try {
      event(database, 10, "report");
      event(database, 20, "keep");
      const all = () => database.prepare("SELECT * FROM moderation_case").all();
      const existing = all();
      expect(existing).toHaveLength(1);
      database.exec(migration);
      expect(all()).toEqual(existing.map((row) => ({ ...row, reopenedAt: null })));
    } finally { database.close(); }
  });

  it("keeps when a case first opened and records each reopening, as the old trigger did otherwise", () => {
    const database = populated();
    try {
      database.exec(migration);
      event(database, 10, "report");
      event(database, 15, "report");
      // Signals on an open case add to it and reopen nothing.
      expect(caseOf(database)).toEqual({
        state: "PENDING", openedAt: 10, reopenedAt: null, updatedAt: 15, reasons: '["Reason 10","Reason 15"]', reportCount: 2, decision: null,
      });
      event(database, 20, "keep");
      event(database, 30, "report");
      expect(caseOf(database)).toEqual({
        state: "PENDING", openedAt: 10, reopenedAt: 30, updatedAt: 30, reasons: '["Reason 30"]', reportCount: 1, decision: null,
      });
      event(database, 40, "keep");
      event(database, 50, "report");
      expect(caseOf(database)).toMatchObject({ state: "PENDING", openedAt: 10, reopenedAt: 50 });
      expect(database.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name = 'moderation_event_case_signal'").get())
        .toEqual({ n: 1 });
    } finally { database.close(); }
  });
});
