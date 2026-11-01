import { readFileSync, readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

const migration = readMigration("0028_channels.sql");
const CHANNEL_TABLES = ["channel", "channel_member", "channel_message", "channel_read", "message_reaction", "message_report", "moderation_event"];
const COMMUNITY = ["introductions", "show-your-work", "help", "opportunities", "design-crit"];

/** Every migration before 0028, with fictional people and the cohorts a long-lived database holds. */
function historicalDatabase() {
  const fixture = createSqliteD1();
  const { database } = fixture;
  for (const file of readdirSync(new URL("./", import.meta.url)).filter(n => n.endsWith(".sql") && n < "0028").toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`
    INSERT INTO "user"(id,name,email) VALUES ('wanjiku','Wanjiku Kamau','wanjiku@example.test'),
      ('achieng','Achieng Otieno','achieng@example.test'),('david','David Mwangi','david@example.test');
    INSERT INTO curriculum(id,title,description) VALUES ('web','Web foundations','Synthetic');
    INSERT INTO program(id,name,description,curriculumId,startDate,createdAt) VALUES
      ('demo','Demo programme','Synthetic','web',NULL,10),
      ('c4','Cohort 04','Synthetic','web',400,40),
      ('c1','Cohort 1','Synthetic','web',100,10),
      ('c3','TTV Cohort #3 (Nairobi)','Synthetic','web',300,30),
      ('c4-again','Cohort 4','Synthetic','web',450,45);
    INSERT INTO programApplication(id,programId,userId,status,application) VALUES ('application','c4','wanjiku','APPROVED','{}');
    UPDATE feature_flag SET audience='STAFF', updatedBy='david' WHERE key='spaces';`);
  return fixture;
}

const rows = (database: DatabaseSync, sql: string) => database.prepare(sql).all().map(row => ({ ...row }));
const channels = (database: DatabaseSync) =>
  rows(database, "SELECT kind, programId, slug, name, postingPolicy, position, seedKey, archivedAt FROM channel ORDER BY kind, programId, position");
const cohortSlugs = (database: DatabaseSync, programId: string) =>
  rows(database, `SELECT slug, postingPolicy FROM channel WHERE programId='${programId}' ORDER BY position`);
const cohort = (nn: string) => [
  { slug: `cohort-${nn}`, postingPolicy: "ALL" },
  { slug: `c${nn}-help`, postingPolicy: "ALL" },
  { slug: `c${nn}-announcements`, postingPolicy: "STAFF" },
];

function withChannels(run: (database: DatabaseSync, db: D1Database) => void | Promise<void>) {
  return async () => {
    const { database, db } = historicalDatabase();
    try {
      database.exec(migration);
      await run(database, db);
    } finally { database.close(); }
  };
}

describe("channels migration", () => {
  it("chains metadata with only the seven channel tables added", () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
    const before = read("./meta/0027_snapshot.json");
    const after = read("./meta/0028_snapshot.json");
    expect(after.prevId).toBe(before.id);
    expect(Object.keys(after.tables).filter(name => !(name in before.tables)).toSorted()).toEqual(CHANNEL_TABLES);
    for (const name of CHANNEL_TABLES) delete after.tables[name];
    expect(after.tables).toEqual(before.tables);
    expect(read("./meta/_journal.json").entries.find((entry: { idx: number }) => entry.idx === 28)).toMatchObject({ tag: "0028_channels" });
  });

  it("applies to a populated database, seeds every channel, and changes nothing else", () => {
    const { database } = historicalDatabase();
    try {
      const untouched = () => ({
        users: rows(database, `SELECT * FROM "user" ORDER BY id`),
        programs: rows(database, "SELECT * FROM program ORDER BY id"),
        applications: rows(database, "SELECT * FROM programApplication ORDER BY id"),
        flags: rows(database, "SELECT * FROM feature_flag ORDER BY key"),
      });
      const existing = untouched();
      database.exec(migration);
      expect(untouched()).toEqual(existing);
      expect(rows(database, "SELECT audience FROM feature_flag WHERE key='channels'")).toEqual([{ audience: "OFF" }]);

      expect(rows(database, "SELECT slug, name, postingPolicy, position, seedKey FROM channel WHERE kind='COMMUNITY' ORDER BY position"))
        .toEqual(COMMUNITY.map((slug, i) => ({ slug, name: slug, postingPolicy: "ALL", position: i + 1, seedKey: `community:${slug}` })));
      // Numbers come from the program's name; a repeated or missing one takes the next free number.
      expect(cohortSlugs(database, "c1")).toEqual(cohort("01"));
      expect(cohortSlugs(database, "c3")).toEqual(cohort("03"));
      expect(cohortSlugs(database, "c4")).toEqual(cohort("04"));
      expect(cohortSlugs(database, "c4-again")).toEqual(cohort("05"));
      expect(cohortSlugs(database, "demo")).toEqual(cohort("06"));
      // Cohort channels stay open after the cohort ends: nothing is archived.
      expect(rows(database, "SELECT COUNT(*) AS n FROM channel WHERE archivedAt IS NOT NULL")).toEqual([{ n: 0 }]);
      expect(rows(database, "SELECT seedKey FROM channel WHERE programId='c4' ORDER BY position"))
        .toEqual(["main", "help", "announcements"].map(part => ({ seedKey: `cohort:c4:${part}` })));
      expect(rows(database, "SELECT DISTINCT typeof(createdAt) AS type FROM channel")).toEqual([{ type: "integer" }]);
      expect(rows(database, "SELECT COUNT(*) AS n FROM channel WHERE createdAt < 1700000000000")).toEqual([{ n: 0 }]);
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { database.close(); }
  });

  it("is a no-op when re-run, even after channels were renamed, deleted or flags changed", withChannels(database => {
    const seeded = rows(database, "SELECT * FROM channel ORDER BY id");
    database.exec(migration);
    expect(rows(database, "SELECT * FROM channel ORDER BY id")).toEqual(seeded);

    database.exec(`UPDATE channel SET slug='say-hello', name='say-hello' WHERE seedKey='community:introductions';
      DELETE FROM channel WHERE seedKey IN ('community:design-crit','cohort:c1:help');
      UPDATE feature_flag SET audience='STAFF', updatedBy='david' WHERE key='channels';`);
    const edited = { channels: rows(database, "SELECT * FROM channel ORDER BY id"), flags: rows(database, "SELECT * FROM feature_flag ORDER BY key") };
    database.exec(migration);
    expect({ channels: rows(database, "SELECT * FROM channel ORDER BY id"), flags: rows(database, "SELECT * FROM feature_flag ORDER BY key") }).toEqual(edited);

    // A missing flag row is recreated OFF.
    database.exec("DELETE FROM feature_flag WHERE key='channels'");
    database.exec(migration);
    expect(rows(database, "SELECT audience, updatedBy FROM feature_flag WHERE key='channels'")).toEqual([{ audience: "OFF", updatedBy: null }]);
  }));

  it("never claims a slug a channel already uses", () => {
    const { database } = historicalDatabase();
    try {
      // Applied once without the seeds, as if staff had created these channels first.
      const schemaOnly = migration.slice(0, migration.indexOf("INSERT OR IGNORE INTO `feature_flag`"));
      database.exec(schemaOnly);
      database.exec(`INSERT INTO channel(id,kind,slug,name) VALUES ('staff-help','COMMUNITY','help','help'),('staff-c01','COMMUNITY','c01-help','c01-help')`);
      database.exec(migration);
      expect(rows(database, "SELECT id, seedKey FROM channel WHERE slug IN ('help','c01-help') ORDER BY slug"))
        .toEqual([{ id: "staff-c01", seedKey: null }, { id: "staff-help", seedKey: null }]);
      expect(rows(database, "SELECT COUNT(*) AS n FROM channel WHERE kind='COMMUNITY' AND seedKey IS NOT NULL")).toEqual([{ n: 4 }]);
      // Cohort 1's number is in use, so it takes the next number above every one in use.
      expect(["c1", "c3", "c4", "c4-again", "demo"].map(id => cohortSlugs(database, id)[0].slug))
        .toEqual(["cohort-05", "cohort-03", "cohort-04", "cohort-06", "cohort-07"]);
    } finally { database.close(); }
  });

  it("keeps the hook working after every later migration", async () => {
    // Later migrations that rebuild program or channel must recreate the view and triggers (README).
    const { database } = createSqliteD1();
    try {
      for (const file of readdirSync(new URL("./", import.meta.url)).filter(n => n.endsWith(".sql")).toSorted()) {
        database.exec(readMigration(file));
      }
      expect(rows(database, "SELECT type, name FROM sqlite_master WHERE name IN ('cohort_channel_request','cohort_channel_request_insert','program_cohort_channels') ORDER BY name"))
        .toEqual([
          { type: "view", name: "cohort_channel_request" },
          { type: "trigger", name: "cohort_channel_request_insert" },
          { type: "trigger", name: "program_cohort_channels" },
        ]);
      database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('web','Web foundations','Synthetic');
        INSERT INTO program(id,name,description,curriculumId) VALUES ('c4','Cohort 04','Synthetic','web');`);
      expect(cohortSlugs(database, "c4")).toEqual(cohort("04"));
    } finally { database.close(); }
  });

  describe("program creation hook", () => {
    const insertProgram = (database: DatabaseSync, id: string, name: string) =>
      database.prepare("INSERT INTO program(id,name,description,curriculumId) VALUES (?,?,'Synthetic','web')").run(id, name);

    it("gives a new program its three cohort channels, numbered by its name", withChannels(database => {
      insertProgram(database, "c9", "Cohort 9");
      expect(cohortSlugs(database, "c9")).toEqual(cohort("09"));
      expect(rows(database, "SELECT topic FROM channel WHERE programId='c9' ORDER BY position")).toEqual([
        { topic: "Everyday talk for the cohort, its mentors and its instructors." },
        { topic: "Questions about sessions, assignments and setup." },
        { topic: "News from the cohort team. Only staff post here." },
      ]);
    }));

    it.each([
      ["a number already in use", "Cohort 04", "10"],
      ["no number", "Open Cohort Desktop Applications 1", "10"],
      ["a number out of range", "Cohort 1000", "10"],
      ["cohort zero", "Cohort 0", "10"],
      ["a very long name", `Cohort ${"x".repeat(5000)}`, "10"],
      ["non-Latin text", "Kundi la Nairobi 🇰🇪", "10"],
      ["the next free number", "Cohort 11", "11"],
    ])("numbers a program with %s", (_, name, nn) => withChannels(database => {
      insertProgram(database, "c9", "Cohort 9");
      insertProgram(database, "new", name);
      expect(cohortSlugs(database, "new")).toEqual(cohort(nn));
    })());

    it("numbers each row of a multi-row insert in turn, and through the import's INSERT OR IGNORE", withChannels(database => {
      database.exec(`INSERT INTO program(id,name,description,curriculumId) VALUES ('a','Pilot','S','web'),('b','Cohort 07','S','web'),('c','Pilot two','S','web')`);
      expect(["a", "b", "c"].map(id => cohortSlugs(database, id)[0].slug)).toEqual(["cohort-07", "cohort-08", "cohort-09"]);
      const before = channels(database);
      database.exec(`INSERT OR IGNORE INTO program(id,name,description,curriculumId) VALUES ('c4','Cohort 04','S','web'),('d','Cohort 12','S','web')`);
      database.exec(`INSERT INTO program(id,name,description,curriculumId) VALUES ('c4','Cohort 04 renamed','S','web') ON CONFLICT(id) DO UPDATE SET name=excluded.name`);
      const after = channels(database);
      expect(after.filter(c => c.programId !== "d")).toEqual(before);
      expect(cohortSlugs(database, "d")).toEqual(cohort("12"));
    }));

    it("runs for Drizzle inserts and leaves RETURNING to report the program", withChannels(async (database, db) => {
      await drizzle(db, { schema }).insert(schema.program).values({ id: "c8", name: "Cohort 08", description: "Synthetic", curriculumId: "web" });
      expect(cohortSlugs(database, "c8")).toEqual(cohort("08"));
      // The admin form reads the created program back with returning(); the trigger's rows never appear there.
      expect(rows(database, "INSERT INTO program(id,name,description,curriculumId) VALUES ('c13','Cohort 13','S','web') RETURNING id, name"))
        .toEqual([{ id: "c13", name: "Cohort 13" }]);
      expect(cohortSlugs(database, "c13")).toEqual(cohort("13"));
    }));

    it("skips unknown programs and programs that already have their channels", withChannels(database => {
      const before = channels(database);
      database.exec(`INSERT INTO cohort_channel_request(programId) VALUES ('missing'),('c4'),('c4')`);
      expect(channels(database)).toEqual(before);
      // A program whose seeded channels were all removed by staff keeps none.
      database.exec(`DELETE FROM channel WHERE programId='c1' AND seedKey <> 'cohort:c1:main'`);
      database.exec(`INSERT INTO cohort_channel_request(programId) VALUES ('c1')`);
      expect(cohortSlugs(database, "c1")).toEqual(cohort("01").slice(0, 1));
    }));

    it("removes a program's channels and their messages with the program", withChannels(database => {
      const channelId = database.prepare("SELECT id FROM channel WHERE seedKey='cohort:c4:main'").get()?.id;
      database.prepare("INSERT INTO channel_message(id,channelId,seq,changeSeq,authorId,body) VALUES ('m',?,1,1,'wanjiku','Habari!')").run(channelId as string);
      database.exec("DELETE FROM programApplication WHERE programId='c4'; DELETE FROM program WHERE id='c4'");
      expect(rows(database, "SELECT COUNT(*) AS n FROM channel WHERE programId='c4'")).toEqual([{ n: 0 }]);
      expect(rows(database, "SELECT COUNT(*) AS n FROM channel_message")).toEqual([{ n: 0 }]);
    }));
  });

  describe("constraints", () => {
    const channelIds = (database: DatabaseSync) => {
      const id = (seedKey: string) => String(database.prepare("SELECT id FROM channel WHERE seedKey=?").get(seedKey)?.id);
      return { help: id("community:help"), crit: id("community:design-crit") };
    };
    const message = (database: DatabaseSync) => database.prepare(`INSERT INTO channel_message
      (id,channelId,parentId,seq,changeSeq,authorKind,authorId,clientNonce,body,embeds,citations,moderationState,moderationReasons,hiddenBy,hiddenAt,deletedAt)
      VALUES (:id,:channelId,:parentId,:seq,:changeSeq,:authorKind,:authorId,:clientNonce,:body,:embeds,:citations,:moderationState,:moderationReasons,:hiddenBy,:hiddenAt,:deletedAt)`);
    const valid = (channelId: string, overrides: Record<string, string | number | null> = {}) => ({
      id: "m1", channelId, parentId: null, seq: 1, changeSeq: 1, authorKind: "USER", authorId: "wanjiku", clientNonce: "nonce-1",
      body: "Habari! I'm building a chama ledger.", embeds: "[]", citations: "[]", moderationState: "VISIBLE",
      moderationReasons: "[]", hiddenBy: null, hiddenAt: null, deletedAt: null, ...overrides,
    });

    it.each([
      ["an unknown kind", "('x','GROUP',NULL,'x','x')", /CHECK/],
      ["a cohort channel without a program", "('x','COHORT',NULL,'x','x')", /CHECK/],
      ["a community channel with a program", "('x','COMMUNITY','c4','x','x')", /CHECK/],
      ["an uppercase slug", "('x','COMMUNITY',NULL,'Help','x')", /CHECK/],
      ["a slug with spaces", "('x','COMMUNITY',NULL,'my help','x')", /CHECK/],
      ["a slug ending in a hyphen", "('x','COMMUNITY',NULL,'help-','x')", /CHECK/],
      ["a slug starting with a hyphen", "('x','COMMUNITY',NULL,'-help','x')", /CHECK/],
      ["a blank name", "('x','COMMUNITY',NULL,'x','  ')", /CHECK/],
      ["a duplicate shared slug", "('x','COHORT','c4','help','x')", /UNIQUE/],
    ])("rejects a channel with %s", (_, values, error) => withChannels(database => {
      expect(() => database.exec(`INSERT INTO channel(id,kind,programId,slug,name) VALUES ${values}`)).toThrow(error);
    })());

    it("allows direct conversations to share a slug, and checks posting policy and topic", withChannels(database => {
      database.exec(`INSERT INTO channel(id,kind,slug,name) VALUES ('d1','DIRECT','help','Achieng Otieno'),('d2','DIRECT','help','David Mwangi')`);
      expect(() => database.exec("UPDATE channel SET postingPolicy='MENTORS' WHERE id='d1'")).toThrow(/CHECK/);
      expect(() => database.exec(`UPDATE channel SET topic='${"x".repeat(281)}' WHERE id='d1'`)).toThrow(/CHECK/);
      expect(() => database.exec("UPDATE channel SET position=-1 WHERE id='d1'")).toThrow(/CHECK/);
    }));

    it.each([
      ["an unknown author kind", { authorKind: "BOT" }],
      ["Tembo with a user id", { authorKind: "TEMBO", parentId: null, authorId: "wanjiku" }],
      ["Tembo outside a thread", { authorKind: "TEMBO", authorId: null }],
      ["a nonce with punctuation", { clientNonce: "nonce 1" }],
      ["an empty nonce", { clientNonce: "" }],
      ["a nonce over 128 characters", { clientNonce: "n".repeat(129) }],
      ["a blank body", { body: " \n\t " }],
      ["a body over 10,000 characters", { body: "x".repeat(10_001) }],
      ["embeds that are not an array", { embeds: "{}" }],
      ["citations that are not JSON", { citations: "[" }],
      ["an unknown moderation state", { moderationState: "PENDING" }],
      ["a flag without a reason", { moderationState: "FLAGGED" }],
      ["a hidden message without a time", { moderationState: "HIDDEN", moderationReasons: '["Harsh, not about the work"]' }],
      ["a hide time on a visible message", { hiddenAt: 5 }],
      ["a hider on a flagged message", { moderationState: "FLAGGED", moderationReasons: '["Contact details"]', hiddenBy: "david" }],
      ["position zero", { seq: 0, changeSeq: 0 }],
      ["a change before its position", { seq: 3, changeSeq: 2 }],
      ["a negative time", { deletedAt: -1, body: "" }],
    ])("rejects a message with %s", (_, overrides) => withChannels(database => {
      expect(() => message(database).run(valid(channelIds(database).help, overrides))).toThrow(/CHECK/);
    })());

    it("accepts the states the contract describes", withChannels(database => {
      const { help } = channelIds(database);
      const insert = message(database);
      insert.run(valid(help));
      insert.run(valid(help, { id: "deleted", seq: 2, changeSeq: 4, clientNonce: "nonce-2", body: "", deletedAt: 9 }));
      insert.run(valid(help, { id: "flagged", seq: 3, changeSeq: 3, clientNonce: null, moderationState: "FLAGGED", moderationReasons: '["Contact details"]' }));
      insert.run(valid(help, { id: "hidden", seq: 5, changeSeq: 5, clientNonce: null, authorId: "achieng", moderationState: "HIDDEN",
        moderationReasons: '["Harsh, not about the work"]', hiddenBy: "david", hiddenAt: 9 }));
      insert.run(valid(help, { id: "tembo", seq: 6, changeSeq: 6, parentId: "m1", authorKind: "TEMBO", authorId: null, clientNonce: null,
        citations: '[{"type":"message","messageId":"m1"}]' }));
      expect(rows(database, "SELECT id FROM channel_message ORDER BY seq").map(r => r.id)).toEqual(["m1", "deleted", "flagged", "hidden", "tembo"]);
    }));

    it("keeps a client nonce unique per author, and positions unique per channel", withChannels(database => {
      const { help, crit } = channelIds(database);
      const insert = message(database);
      insert.run(valid(help));
      // The same nonce from the same author is the same message, even in another channel.
      expect(() => insert.run(valid(crit, { id: "retry" }))).toThrow(/UNIQUE/);
      insert.run(valid(crit, { id: "other-author", authorId: "achieng" }));
      // Messages without a nonce (Tembo, deleted accounts) never collide.
      insert.run(valid(help, { id: "n1", seq: 2, changeSeq: 2, clientNonce: null }));
      insert.run(valid(help, { id: "n2", seq: 3, changeSeq: 3, clientNonce: null }));
      expect(() => insert.run(valid(help, { id: "same-seq", seq: 3, changeSeq: 7, clientNonce: "nonce-3" }))).toThrow(/UNIQUE/);
      expect(() => insert.run(valid(help, { id: "same-change", seq: 4, changeSeq: 3, clientNonce: "nonce-4" }))).toThrow(/CHECK/);
      expect(() => insert.run(valid(help, { id: "same-change", seq: 1, changeSeq: 3, clientNonce: "nonce-4" }))).toThrow(/UNIQUE/);
      insert.run(valid(crit, { id: "crit-2", seq: 2, changeSeq: 2, clientNonce: "nonce-5" }));
    }));

    it("keeps replies and read markers in their own channel", withChannels(database => {
      const { help, crit } = channelIds(database);
      message(database).run(valid(help));
      expect(() => message(database).run(valid(crit, { id: "stray", clientNonce: "n2", parentId: "m1" }))).toThrow(/FOREIGN KEY/);
      message(database).run(valid(help, { id: "reply", seq: 2, changeSeq: 2, clientNonce: "n3", parentId: "m1" }));
      const read = database.prepare("INSERT INTO channel_read(userId,channelId,lastReadMessageId,readAt) VALUES (?,?,?,?)");
      expect(() => read.run("achieng", crit, "m1", 1)).toThrow(/FOREIGN KEY/);
      expect(() => read.run("achieng", help, "m1", -1)).toThrow(/CHECK/);
      read.run("achieng", help, "m1", 1);
      expect(() => read.run("achieng", help, "reply", 2)).toThrow(/UNIQUE|PRIMARY KEY/);
    }));

    it("checks reactions, reports and the moderation audit trail", withChannels(database => {
      message(database).run(valid(channelIds(database).help));
      const react = database.prepare("INSERT INTO message_reaction(messageId,userId,kind) VALUES ('m1',?,?)");
      react.run("achieng", "useful");
      react.run("achieng", "thanks");
      expect(() => react.run("achieng", "useful")).toThrow(/UNIQUE|PRIMARY KEY/);
      expect(() => react.run("achieng", "like")).toThrow(/CHECK/);

      const report = database.prepare("INSERT INTO message_report(id,messageId,reporterId,reason) VALUES (?,'m1',?,?)");
      report.run("r1", "achieng", "Unrelated promotion");
      expect(() => report.run("r2", "achieng", "Again")).toThrow(/UNIQUE/);
      expect(() => report.run("r3", "david", "   ")).toThrow(/CHECK/);
      expect(() => report.run("r4", "david", "x".repeat(2001))).toThrow(/CHECK/);

      const event = database.prepare(`INSERT INTO moderation_event(id,messageId,action,source,actorId,fromState,toState,reasons)
        VALUES (?, 'm1', ?, ?, ?, ?, ?, ?)`);
      event.run("e1", "FLAG", "DETECTOR", null, "VISIBLE", "FLAGGED", '["Contact details"]');
      event.run("e2", "KEEP", "ADMIN", "david", "FLAGGED", "VISIBLE", '["Fine as is"]');
      expect(() => event.run("e3", "FLAG", "CLEF", "david", "VISIBLE", "FLAGGED", '["Promotion"]')).toThrow(/CHECK/);
      expect(() => event.run("e4", "HIDE", "MENTOR", "david", "VISIBLE", "HIDDEN", "[]")).toThrow(/CHECK/);
      expect(() => event.run("e5", "DELETE", "ADMIN", "david", "VISIBLE", "HIDDEN", '["x"]')).toThrow(/CHECK/);
      expect(() => event.run("e6", "HIDE", "SYSTEM", null, "VISIBLE", "HIDDEN", '["x"]')).toThrow(/CHECK/);
      expect(() => event.run("e7", "HIDE", "ADMIN", "david", "VISIBLE", "GONE", '["x"]')).toThrow(/CHECK/);
    }));

    it("keeps a deleted person's messages and moderation history, anonymised", withChannels(database => {
      const { help } = channelIds(database);
      message(database).run(valid(help, { authorId: "achieng" }));
      message(database).run(valid(help, { id: "hidden", seq: 2, changeSeq: 2, clientNonce: "n2", moderationState: "HIDDEN",
        moderationReasons: '["Harsh"]', hiddenBy: "david", hiddenAt: 3 }));
      database.exec(`INSERT INTO message_reaction(messageId,userId,kind) VALUES ('hidden','achieng','agree');
        INSERT INTO message_report(id,messageId,reporterId,reason) VALUES ('r','hidden','achieng','Harsh');
        INSERT INTO channel_read(userId,channelId,lastReadMessageId,readAt) VALUES ('achieng','${help}','hidden',4);
        INSERT INTO channel_member(channelId,userId,addedBy) VALUES ('${help}','achieng','david');
        INSERT INTO moderation_event(id,messageId,action,source,actorId,fromState,toState,reasons) VALUES ('e','hidden','HIDE','MENTOR','david','VISIBLE','HIDDEN','["Harsh"]');`);
      database.exec(`DELETE FROM "user" WHERE id IN ('achieng','david')`);
      expect(rows(database, "SELECT id, authorId, hiddenBy, moderationState FROM channel_message ORDER BY seq")).toEqual([
        { id: "m1", authorId: null, hiddenBy: null, moderationState: "VISIBLE" },
        { id: "hidden", authorId: "wanjiku", hiddenBy: null, moderationState: "HIDDEN" },
      ]);
      expect(rows(database, "SELECT source, actorId FROM moderation_event")).toEqual([{ source: "MENTOR", actorId: null }]);
      for (const table of ["message_reaction", "message_report", "channel_read", "channel_member"]) {
        expect(rows(database, `SELECT COUNT(*) AS n FROM ${table}`)).toEqual([{ n: 0 }]);
      }
      database.exec(`DELETE FROM channel WHERE id='${help}'`);
      for (const table of ["channel_message", "moderation_event"]) {
        expect(rows(database, `SELECT COUNT(*) AS n FROM ${table}`)).toEqual([{ n: 0 }]);
      }
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    }));
  });

  it("indexes the read paths the channel APIs poll", withChannels(database => {
    const plan = (sql: string) => rows(database, `EXPLAIN QUERY PLAN ${sql}`).map(r => String(r.detail)).join("\n");
    const paths: [string, string][] = [
      // Newest page, older pages and threads (before/thread cursors).
      ["SELECT * FROM channel_message WHERE channelId='c' AND parentId IS NULL ORDER BY seq DESC LIMIT 50", "channel_message_thread_idx (channelId=? AND parentId=?)"],
      ["SELECT * FROM channel_message WHERE channelId='c' AND parentId IS NULL AND seq < 90 ORDER BY seq DESC LIMIT 50", "channel_message_thread_idx (channelId=? AND parentId=? AND seq<?)"],
      ["SELECT * FROM channel_message WHERE channelId='c' AND parentId='p' ORDER BY seq", "channel_message_thread_idx (channelId=? AND parentId=?)"],
      // `since` polling, including edits and moderation.
      ["SELECT * FROM channel_message WHERE channelId='c' AND changeSeq > 90 ORDER BY changeSeq LIMIT 100", "channel_message_changeSeq_idx (channelId=? AND changeSeq>?)"],
      ["SELECT max(changeSeq) FROM channel_message WHERE channelId='c'", "channel_message_changeSeq_idx"],
      ["SELECT 1 FROM channel_message WHERE channelId='c' AND id='m'", "channel_message_channel_id_idx (channelId=? AND id=?)"],
      // Idempotent posting.
      ["SELECT id FROM channel_message WHERE authorId='u' AND clientNonce='n'", "channel_message_nonce_idx (authorId=? AND clientNonce=?)"],
      // A person's read markers, and unread counts after them.
      ["SELECT * FROM channel_read WHERE userId='u'", "sqlite_autoindex_channel_read_1 (userId=?)"],
      ["SELECT count(*) FROM channel_message WHERE channelId='c' AND seq > 10", "channel_message_seq_idx (channelId=? AND seq>?)"],
      // Channel lists.
      ["SELECT * FROM channel WHERE kind='COMMUNITY' AND archivedAt IS NULL", "channel_kind_idx (kind=?)"],
      ["SELECT * FROM channel WHERE kind='COHORT' AND programId IN ('a','b')", "channel_kind_idx (kind=? AND programId=?)"],
      ["SELECT channelId FROM channel_member WHERE userId='u'", "channel_member_userId_idx (userId=?)"],
      // Deleting a person nulls these without scanning every message or membership.
      ["SELECT 1 FROM channel_message WHERE hiddenBy='u'", "channel_message_hiddenBy_idx (hiddenBy=?)"],
      ["SELECT 1 FROM channel_member WHERE addedBy='u'", "channel_member_addedBy_idx (addedBy=?)"],
      // Reactions, reports and the audit trail for a message.
      ["SELECT kind, count(*) FROM message_reaction WHERE messageId IN ('a','b') GROUP BY kind", "sqlite_autoindex_message_reaction_1 (messageId=?)"],
      ["SELECT count(*) FROM message_report WHERE messageId='m'", "message_report_message_reporter_idx (messageId=?)"],
      ["SELECT count(*) FROM message_report WHERE reporterId='u' AND createdAt > 5", "message_report_reporter_idx (reporterId=? AND createdAt>?)"],
      ["SELECT * FROM moderation_event WHERE messageId='m' ORDER BY createdAt", "moderation_event_message_idx (messageId=?)"],
    ];
    // The query leads each plan, so a failure names it.
    for (const [sql, index] of paths) expect(`${sql}\n${plan(sql)}`).toContain(index);
    expect(plan("SELECT * FROM channel_message WHERE channelId='c' AND changeSeq > 90 ORDER BY changeSeq")).not.toContain("TEMP B-TREE");
  }));
});
