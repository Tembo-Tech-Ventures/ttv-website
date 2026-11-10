import { readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { readMigration } from "@/test/sqlite-d1";

const migration = "0039_member_profiles_and_work.sql";
function productionSeed() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync(new URL("./", import.meta.url))
    .filter((n) => /^\d+.*\.sql$/.test(n) && n < migration)
    .toSorted())
    db.exec(readMigration(name));
  for (let i = 0; i < 7; i++)
    db.prepare("INSERT INTO user(id,name,email) VALUES (?,?,?)").run(
      `u${i}`,
      `Synthetic Wanjiku ${i}`,
      `u${i}@example.test`,
    );
  for (let i = 0; i < 5; i++)
    db.prepare(
      "INSERT INTO studentProfile(id,userId,handle,status,updatedAt) VALUES (?,?,?,'PUBLISHED',100)",
    ).run(`p${i}`, `u${i}`, `member-${i}`);
  for (let i = 0; i < 16; i++)
    db.prepare(
      "INSERT INTO profileHighlight(id,profileId,repoFullName,repoUrl,description,language,topics,stars,sortOrder,snapshotAt) VALUES (?,?,?,?,'Snapshot','TypeScript','[\"web\"]',7,?,123)",
    ).run(
      `h${i}`,
      `p${i % 5}`,
      `synthetic/repo${i}`,
      `https://github.com/synthetic/repo${i}`,
      i,
    );
  db.exec(`
    INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES ('original','u0','Work','Evidence','2026-11-09','institution');
    INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion) VALUES
      ('c1','original','u5','Confirmed evidence','Review',1), ('c2','original','u6','Confirmed evidence','Review',1);
    INSERT INTO communitySetAside(mentorId,journeyId,journeyVersion) VALUES ('u5','original',1);
    INSERT INTO mentor_request(id,requesterId,mentorId,format,note,journeyId,journeyVersion,project)
      VALUES ('request','u0','u5','WRITTEN_REVIEW','Review please','original',1,'{}');
    INSERT INTO blogPost(id,profileId,slug,title,contentMarkdown,status) VALUES ('post','p0','post','Post','Writing','PUBLISHED');
    INSERT INTO profileContact(id,profileId,fromName,fromEmail,message) VALUES ('contact','p0','Synthetic Amina','amina@example.test','Hello');
    INSERT INTO clientProject(id,organization,contactName,contactEmail,title,description) VALUES ('project','Synthetic','Amina','amina@example.test','Project','Work');
    INSERT INTO projectInterest(id,projectId,profileId) VALUES ('interest','project','p0');
  `);
  return db;
}

describe("one-profile additive D1 migration", () => {
  it("preserves exact production-shaped counts, snapshots, order and foreign-key links", () => {
    const db = productionSeed();
    try {
      db.exec(readMigration(migration));
      for (const [table, count] of Object.entries({
        studentProfile: 5,
        communityJourney: 17,
        communityConfirmation: 2,
        communitySetAside: 1,
        mentor_request: 1,
        blogPost: 1,
        profileContact: 1,
        projectInterest: 1,
      })) {
        expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({
          n: count,
        });
      }
      expect(db.prepare("SELECT journeyId FROM mentor_request").get()).toEqual({
        journeyId: "original",
      });
      expect(
        db
          .prepare(
            "SELECT count(*) AS n FROM communityJourney WHERE kind='repo' AND repoDescription='Snapshot' AND language='TypeScript' AND stars=7 AND snapshotAt=123",
          )
          .get(),
      ).toEqual({ n: 16 });
      expect(
        db
          .prepare(
            "SELECT sortOrder FROM communityJourney WHERE kind='repo' ORDER BY sortOrder",
          )
          .all(),
      ).toEqual(Array.from({ length: 16 }, (_, sortOrder) => ({ sortOrder })));
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name IN ('communityProfile','profileHighlight')",
          )
          .all(),
      ).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("keeps private rows as drafts and merges newer profile fields without handle collisions", () => {
    const db = productionSeed();
    try {
      db.exec(`UPDATE communityJourney SET visibility='private';
        INSERT INTO communityProfile(userId,headline,skills,opportunityGoals,updatedAt) VALUES
        ('u0','New headline','["Rust"]','Collaborate',200),('u5','New member','[]','Learn',200),('u6','New member','[]','Build',200);`);
      db.exec(readMigration(migration));
      expect(
        db
          .prepare(
            "SELECT state,visibility FROM communityJourney WHERE id='original'",
          )
          .get(),
      ).toEqual({ state: "DRAFT", visibility: "institution" });
      expect(
        db
          .prepare(
            "SELECT headline,skills,opportunityGoals FROM studentProfile WHERE userId='u0'",
          )
          .get(),
      ).toEqual({
        headline: "New headline",
        skills: '["Rust"]',
        opportunityGoals: "Collaborate",
      });
      expect(
        db
          .prepare(
            "SELECT handle FROM studentProfile WHERE userId IN ('u5','u6') ORDER BY handle",
          )
          .all(),
      ).toEqual([{ handle: "member-5" }, { handle: "member-6" }]);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("is a no-op when D1 applies its migration ledger a second time", () => {
    const db = productionSeed();
    try {
      db.exec(
        "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)",
      );
      const apply = () => {
        if (
          db.prepare("SELECT 1 FROM d1_migrations WHERE name=?").get(migration)
        )
          return;
        db.exec("BEGIN");
        try {
          db.exec(readMigration(migration));
          db.prepare("INSERT INTO d1_migrations(name) VALUES (?)").run(
            migration,
          );
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      };
      apply();
      const before = db
        .prepare("SELECT * FROM communityJourney ORDER BY id")
        .all();
      apply();
      expect(
        db.prepare("SELECT * FROM communityJourney ORDER BY id").all(),
      ).toEqual(before);
      expect(
        db.prepare("SELECT count(*) n FROM communityConfirmation").get(),
      ).toEqual({ n: 2 });
      expect(db.prepare("SELECT count(*) n FROM d1_migrations").get()).toEqual({
        n: 1,
      });
    } finally {
      db.close();
    }
  });

  it("never rebuilds referenced tables or disables foreign keys", () => {
    const sql = readMigration(migration);
    expect(sql).not.toMatch(
      /CREATE TABLE.*__new_|DROP TABLE\s+[`"]?(studentProfile|communityJourney)\b|foreign_keys\s*=\s*OFF/i,
    );
  });
});
