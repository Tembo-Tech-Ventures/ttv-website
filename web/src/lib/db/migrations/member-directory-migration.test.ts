import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { postedWorkEligibility } from "@/lib/community/eligibility";
import { listOwnProjects, resolveOwnProject } from "@/lib/channels/embeds";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

const migration = "0039_member_profiles_and_work.sql";
function productionSeed() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync(new URL("./", import.meta.url))
    .filter((n) => /^\d+.*\.sql$/.test(n) && n < migration)
    .toSorted())
    db.exec(readMigration(name));
  for (let i = 0; i < 8; i++)
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
      "INSERT INTO profileHighlight(id,profileId,repoFullName,repoUrl,description,language,topics,stars,sortOrder,snapshotAt,pushedAt,blurb) VALUES (?,?,?,?,'Snapshot','TypeScript','[\"web\"]',7,?,123,1700000000,'Author blurb')",
    ).run(
      `h${i}`,
      `p${i % 5}`,
      `synthetic/repo${i}`,
      `https://github.com/synthetic/repo${i}`,
      i,
    );
  db.exec(`
    INSERT OR IGNORE INTO Roles(id,name) VALUES ('mentor-role','MENTOR');
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'grant-'||u.id,u.id,r.id FROM user u,Roles r WHERE u.id IN ('u5','u6') AND r.name='MENTOR';
    INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES ('original','u7','Work','Evidence','2026-11-09','institution');
    INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion) VALUES
      ('c1','original','u5','Confirmed evidence','Review',1), ('c2','original','u6','Confirmed evidence','Review',1);
    INSERT INTO communitySetAside(mentorId,journeyId,journeyVersion) VALUES ('u5','original',1);
    INSERT INTO mentor_request(id,requesterId,mentorId,format,note,journeyId,journeyVersion,project)
      VALUES ('request','u7','u5','WRITTEN_REVIEW','Review please','original',1,'{}');
    INSERT INTO blogPost(id,profileId,slug,title,contentMarkdown,status) VALUES ('post','p0','post','Post','Writing','PUBLISHED');
    INSERT INTO profileContact(id,profileId,fromName,fromEmail,message) VALUES ('contact','p0','Synthetic Amina','amina@example.test','Hello');
    INSERT INTO clientProject(id,organization,contactName,contactEmail,title,description) VALUES ('project','Synthetic','Amina','amina@example.test','Project','Work');
    INSERT INTO projectInterest(id,projectId,profileId) VALUES ('interest','project','p0');
  `);
  return db;
}

describe("one-profile additive D1 migration", () => {
  it("preserves exact production-shaped counts, snapshots, order and foreign-key links", async () => {
    const db = productionSeed();
    try {
      db.exec(readMigration(migration));
      db.exec(readMigration("0040_member_review_safety.sql"));
      for (const [table, count] of Object.entries({
        studentProfile: 6,
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
      expect(
        db
          .prepare(
            "SELECT count(*) n FROM communityJourney WHERE kind='repo' AND moderationOutcome='pass' AND moderationCheckedAt IS NOT NULL",
          )
          .get(),
      ).toEqual({ n: 16 });
      for (let i = 0; i < 16; i++)
        expect(
          db
            .prepare(
              "SELECT userId,title,description,evidenceUrl,repoFullName,repoUrl,repoDescription,language,topics,stars,pushedAt,blurb,sortOrder,snapshotAt FROM communityJourney WHERE id=?",
            )
            .get(`repo-h${i}`),
        ).toEqual({
          userId: `u${i % 5}`,
          title: `synthetic/repo${i}`,
          description: "Author blurb",
          evidenceUrl: `https://github.com/synthetic/repo${i}`,
          repoFullName: `synthetic/repo${i}`,
          repoUrl: `https://github.com/synthetic/repo${i}`,
          repoDescription: "Snapshot",
          language: "TypeScript",
          topics: '["web"]',
          stars: 7,
          pushedAt: 1700000000,
          blurb: "Author blurb",
          sortOrder: i,
          snapshotAt: 123,
        });
      expect(db.prepare(`SELECT id FROM communityJourney j WHERE id='original' AND ${postedWorkEligibility("j")}`).all()).toEqual([{ id: "original" }]);
      expect(db.prepare(`SELECT count(*) n FROM communityConfirmation c JOIN communityJourney j ON j.id=c.journeyId AND j.version=c.journeyVersion WHERE j.id='original' AND ${postedWorkEligibility("j", true)}`).get()).toEqual({ n: 2 });
      expect(db.prepare("SELECT publicName,moderationOutcome,moderationReviewRequired FROM studentProfile WHERE userId='u7'").get()).toEqual({ publicName: null, moderationOutcome: null, moderationReviewRequired: 1 });
      const embed = await resolveOwnProject(createSqliteD1(db).db, "u7", { type: "project", journeyId: "original", version: 1 });
      expect(embed.title).toBe("Work");
      expect((await listOwnProjects(createSqliteD1(db).db, "u7"))[0].confirmations).toHaveLength(2);
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
        UPDATE studentProfile SET status='DRAFT' WHERE userId='u0';
        INSERT INTO communityProfile(userId,headline,skills,opportunityGoals,updatedAt) VALUES
        ('u0','New headline','["Rust"]','Collaborate',200),('u5','New member','[]','Learn',200),('u6','New member','[]','Build',200);`);
      db.exec(readMigration(migration));
      db.exec(readMigration("0040_member_review_safety.sql"));
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

  it("keeps legacy writes private during migration-before-deploy and supports repeated guarded backfills", () => {
    const db = productionSeed();
    try {
      db.exec(readMigration(migration));
      db.exec(readMigration("0040_member_review_safety.sql"));
      db.exec(
        "INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES ('legacy','u0','Private','Evidence','2026-11-09','private')",
      );
      expect(
        db
          .prepare(
            "SELECT state,visibility FROM communityJourney WHERE id='legacy'",
          )
          .get(),
      ).toEqual({ state: "DRAFT", visibility: "institution" });
      db.exec(
        "UPDATE communityJourney SET visibility='private' WHERE id='original'",
      );
      expect(
        db
          .prepare(
            "SELECT state,visibility FROM communityJourney WHERE id='original'",
          )
          .get(),
      ).toEqual({ state: "DRAFT", visibility: "institution" });
      expect(
        db.prepare("SELECT count(*) n FROM communityConfirmation").get(),
      ).toEqual({ n: 2 });
      const guarded = readFileSync(
        new URL("0040_member_review_safety.sql", import.meta.url),
        "utf8",
      )
        .split("--> statement-breakpoint")
        .filter((s) =>
          /CREATE (?:UNIQUE INDEX|INDEX|TRIGGER) IF NOT EXISTS|WITH RECURSIVE hashes/.test(
            s,
          ),
        );
      expect(guarded.some((s) => s.includes("WITH RECURSIVE hashes"))).toBe(
        true,
      );
      const before = db
        .prepare("SELECT id,rotationSeed FROM studentProfile ORDER BY id")
        .all();
      for (const statement of guarded) db.exec(statement);
      expect(
        db
          .prepare("SELECT id,rotationSeed FROM studentProfile ORDER BY id")
          .all(),
      ).toEqual(before);
      expect(
        db
          .prepare("SELECT publicName FROM studentProfile WHERE userId='u0'")
          .get(),
      ).toEqual({ publicName: null });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("protects published text and nonempty draft fields, queues draft repos, and ignores malformed handle suffixes", () => {
    const db = productionSeed();
    try {
      db.exec(`UPDATE studentProfile SET headline='Checked public text',bio='Retain biography',skills='["SQL"]';
        UPDATE studentProfile SET status='DRAFT',handle='member-999999999999999999999999999' WHERE userId='u1';
        UPDATE studentProfile SET handle='member-99junk' WHERE userId='u2';
        INSERT INTO communityProfile(userId,headline,bio,skills,opportunityGoals,updatedAt) VALUES
          ('u0','Unscreeened public edit','','[]','',200),('u1','','','[]','Collaborate',200),('u5','Member','','[]','',200);`);
      db.exec(readMigration(migration));
      db.exec(readMigration("0040_member_review_safety.sql"));
      expect(
        db
          .prepare(
            "SELECT headline,moderationReviewRequired FROM studentProfile WHERE userId='u0'",
          )
          .get(),
      ).toEqual({
        headline: "Checked public text",
        moderationReviewRequired: 0,
      });
      expect(
        db
          .prepare(
            "SELECT headline,bio,skills,opportunityGoals,moderationReviewRequired FROM studentProfile WHERE userId='u1'",
          )
          .get(),
      ).toEqual({
        headline: "Checked public text",
        bio: "Retain biography",
        skills: '["SQL"]',
        opportunityGoals: "Collaborate",
        moderationReviewRequired: 1,
      });
      expect(
        db.prepare("SELECT handle FROM studentProfile WHERE userId='u5'").get(),
      ).toEqual({ handle: "member-5" });
      expect(
        db
          .prepare(
            "SELECT count(*) n FROM communityJourney WHERE userId='u1' AND moderationReviewRequired=1",
          )
          .get(),
      ).toEqual({ n: 3 });
    } finally {
      db.close();
    }
  });

  it("never rebuilds referenced tables or disables foreign keys", () => {
    const sql =
      readMigration(migration) + readMigration("0040_member_review_safety.sql");
    expect(sql).not.toMatch(
      /CREATE TABLE.*__new_|DROP TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?(studentProfile|communityJourney)\b|ALTER TABLE[^;]*RENAME|foreign_keys\s*=\s*OFF/i,
    );
  });
});
