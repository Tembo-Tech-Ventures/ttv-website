import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

const migration = readMigration("0036_mentor_requests.sql");

function populated() {
  const { database } = createSqliteD1();
  for (const file of readdirSync(new URL("./", import.meta.url)).filter((n) => n.endsWith(".sql") && n < "0036").toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO "user"(id,name,email) VALUES ('wanjiku','Wanjiku Kamau','w@example.test'),('david','David Kamau','d@example.test'),
      ('joseph','Joseph Mutua','j@example.test');
    INSERT INTO communityJourney (id, userId, title, description, occurredAt, visibility, version) VALUES ('ledger','wanjiku','Ledger','A chama ledger','2026-10','institution',2);
    INSERT INTO channel (id, kind, slug, name) VALUES ('dm','DIRECT','conversation','Mentoring conversation');`);
  return database;
}

describe("mentor requests migration", () => {
  it("chains metadata with only the two new tables", () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
    const before = read("./meta/0035_snapshot.json");
    const after = read("./meta/0036_snapshot.json");
    expect(after.prevId).toBe(before.id);
    expect(Object.keys(after.tables.mentor_profile.columns)).toEqual(
      ["userId", "headline", "bio", "areas", "formats", "monthlyCapacity", "paused", "createdAt", "updatedAt"]);
    expect(Object.keys(after.tables.mentor_request.columns)).toEqual([
      "id", "requesterId", "mentorId", "status", "format", "note", "noteReasons", "journeyId", "journeyVersion", "project",
      "channelId", "redirectedToId", "responseNote", "acceptedAt", "decidedAt", "createdAt", "updatedAt",
    ]);
    for (const table of ["mentor_profile", "mentor_request"]) delete after.tables[table];
    expect(after.tables).toEqual(before.tables);
    expect(read("./meta/_journal.json").entries.find((entry: { idx: number }) => entry.idx === 36)).toMatchObject({ tag: "0036_mentor_requests" });
  });

  it("applies to a populated schema and reapplies without touching existing rows", () => {
    const database = populated();
    try {
      const existing = () => database.prepare("SELECT (SELECT COUNT(*) FROM channel) AS channels, (SELECT COUNT(*) FROM communityJourney) AS journeys").get();
      const before = existing();
      database.exec(migration);
      database.exec(migration);
      expect(existing()).toEqual(before);
      expect(database.prepare("SELECT COUNT(*) AS n FROM mentor_profile").get()).toEqual({ n: 0 });
    } finally { database.close(); }
  });

  it("constrains profiles and requests to the states the domain allows", () => {
    const database = populated();
    try {
      database.exec(migration);
      const profile = database.prepare("INSERT INTO mentor_profile (userId, headline, areas, formats, monthlyCapacity, paused) VALUES (?, ?, ?, ?, ?, ?)");
      profile.run("david", "Backend engineer", '["Code review"]', '["WRITTEN_REVIEW"]', 2, 0);
      expect(database.prepare("SELECT bio, createdAt > 0 AS stamped FROM mentor_profile").get()).toEqual({ bio: "", stamped: 1 });
      for (const [values, why] of [
        [["joseph", " ", "[]", '["CALL_30_MIN"]', 1, 0], "blank headline"], [["joseph", "Engineer", "{}", '["CALL_30_MIN"]', 1, 0], "areas not an array"],
        [["joseph", "Engineer", "[]", "[]", 1, 0], "no format"], [["joseph", "Engineer", "[]", '["CALL_30_MIN"]', 21, 0], "capacity above 20"],
        [["joseph", "Engineer", "[]", '["CALL_30_MIN"]', -1, 0], "negative capacity"], [["joseph", "Engineer", "[]", '["CALL_30_MIN"]', 1, 2], "paused not boolean"],
      ] as const) expect(() => profile.run(...values), `${why}`).toThrow(/CHECK/);
      expect(() => profile.run("nobody", "Engineer", "[]", '["CALL_30_MIN"]', 1, 0)).toThrow(/FOREIGN KEY/);

      const insert = (id: string, columns: Record<string, unknown>) => {
        const row = { id, requesterId: "wanjiku", mentorId: "david", format: "WRITTEN_REVIEW", note: "Could you look?", createdAt: 1, updatedAt: 1, ...columns };
        const keys = Object.keys(row);
        database.prepare(`INSERT INTO mentor_request (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
          .run(...Object.values(row) as never[]);
      };
      insert("pending", {});
      expect(database.prepare("SELECT status, noteReasons FROM mentor_request").get()).toEqual({ status: "PENDING", noteReasons: "[]" });
      expect(() => insert("again", {}), "a second pending request to the same mentor").toThrow(/UNIQUE/);
      insert("other-mentor", { mentorId: "joseph" });
      insert("accepted", { status: "ACCEPTED", channelId: "dm", acceptedAt: 5, decidedAt: 5, journeyId: "ledger", journeyVersion: 2, project: '{"type":"project"}' });
      insert("declined", { status: "DECLINED", decidedAt: 5, responseNote: "Not this month." });
      insert("redirected", { status: "REDIRECTED", decidedAt: 5, redirectedToId: "joseph" });
      for (const [columns, why] of [
        [{ mentorId: "wanjiku" }, "asking yourself"], [{ status: "MAYBE", decidedAt: 5 }, "an unknown status"], [{ format: "LUNCH" }, "an unknown format"],
        [{ note: "  " }, "a blank note"], [{ note: "x".repeat(2001) }, "a long note"], [{ noteReasons: "{}" }, "reasons not an array"],
        [{ status: "ACCEPTED", decidedAt: 5, acceptedAt: 5 }, "accepted without a conversation"], [{ status: "DECLINED", decidedAt: 5, channelId: "dm" }, "a conversation without acceptance"],
        [{ decidedAt: null }, "decided without a time"], [{ status: "PENDING" }, "pending with a decision time"],
        [{ status: "PENDING", decidedAt: null, redirectedToId: "joseph" }, "a target on a pending request"],
        [{ status: "PENDING", decidedAt: null, responseNote: "Sure" }, "a reply on a pending request"], [{ redirectedToId: "joseph" }, "a target on a declined request"],
        [{ status: "WITHDRAWN", decidedAt: 5, responseNote: "Bye" }, "a reply on a withdrawn request"],
        [{ journeyVersion: 2 }, "a revision without the work"], [{ project: "{}" }, "work without a revision"], [{ journeyVersion: 0, project: "{}" }, "revision 0"],
        [{ project: "not json", journeyVersion: 1 }, "work that is not JSON"], [{ createdAt: 10, updatedAt: 5 }, "updated before created"],
      ] as const) expect(() => insert(`bad-${why}`, Object.assign({ mentorId: "joseph", status: "DECLINED", decidedAt: 5 }, columns)), `${why}`).toThrow(/CHECK/);
      expect(() => insert("ghost", { status: "ACCEPTED", channelId: "nowhere", acceptedAt: 5, decidedAt: 5 })).toThrow(/FOREIGN KEY/);

      const plan = (sql: string, ...params: unknown[]) => database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params as never[])
        .map((row) => String(row.detail)).join("\n");
      expect(plan("SELECT id FROM mentor_request WHERE mentorId = ? ORDER BY createdAt DESC, id DESC LIMIT 21", "david"))
        .toMatch(/^SCAN mentor_request USING INDEX mentor_request_mentor_idx|SEARCH mentor_request USING (COVERING )?INDEX mentor_request_mentor_idx \(mentorId=\?\)$/);
      expect(plan("SELECT id FROM mentor_request WHERE requesterId = ? ORDER BY createdAt DESC, id DESC LIMIT 21", "wanjiku"))
        .toMatch(/SEARCH mentor_request USING (COVERING )?INDEX mentor_request_requester_idx \(requesterId=\?\)$/);
      expect(plan("SELECT COUNT(*) FROM mentor_request WHERE mentorId = ? AND status = 'ACCEPTED' AND acceptedAt >= ?", "david", 0))
        .toMatch(/USING COVERING INDEX mentor_request_mentor_status_idx \(mentorId=\? AND status=\? AND acceptedAt>\?\)/);
      expect(plan("SELECT COUNT(*) FROM mentor_request WHERE mentorId = ? AND status = 'PENDING'", "david"))
        .toMatch(/USING COVERING INDEX mentor_request_(mentor_status_idx \(mentorId=\? AND status=\?\)|pending_idx)/);

      // Deleting a person removes their profile and the requests they made or received; a suggested
      // mentor's deletion leaves the redirect without a target, and deleted work leaves its snapshot.
      database.exec("DELETE FROM communityJourney WHERE id = 'ledger'");
      expect(database.prepare("SELECT journeyId, journeyVersion FROM mentor_request WHERE id = 'accepted'").get()).toEqual({ journeyId: null, journeyVersion: 2 });
      database.exec(`DELETE FROM "user" WHERE id = 'joseph'`);
      expect(database.prepare("SELECT redirectedToId FROM mentor_request WHERE id = 'redirected'").get()).toEqual({ redirectedToId: null });
      expect(database.prepare("SELECT COUNT(*) AS n FROM mentor_request WHERE id = 'other-mentor'").get()).toEqual({ n: 0 });
      // A conversation is never deleted from under the request that opened it.
      expect(() => database.exec("DELETE FROM channel WHERE id = 'dm'")).toThrow(/FOREIGN KEY/);
      database.exec(`DELETE FROM "user" WHERE id = 'david'`);
      expect(database.prepare("SELECT COUNT(*) AS n FROM mentor_request").get()).toEqual({ n: 0 });
      expect(database.prepare("SELECT COUNT(*) AS n FROM mentor_profile").get()).toEqual({ n: 0 });
    } finally { database.close(); }
  });
});
