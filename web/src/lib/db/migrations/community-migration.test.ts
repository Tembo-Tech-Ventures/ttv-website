import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const directory = new URL("./", import.meta.url);
const sql = (name: string) => readFileSync(new URL(name,directory),"utf8").replaceAll("--> statement-breakpoint", "");
describe("community schema migration", () => {
  it("applies after the complete historical migration chain and preserves existing members", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys=ON");
      for (const name of readdirSync(directory).filter(n=>n.endsWith(".sql") && n < "0017").toSorted()) db.exec(sql(name));
      db.exec(`INSERT INTO user(id,name,email) VALUES ('existing','Existing Member','existing@example.test');`);
      db.exec(sql("0017_community_discovery.sql"));
      db.exec(`INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES ('legacy','existing','Legacy','Earlier claim','2026-10-24','institution');
        INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion) VALUES ('legacy-confirmation','legacy','existing','Legacy statement','Legacy review',1);`);
      db.exec(sql("0018_confirmation_role_snapshot.sql"));
      expect(db.prepare("SELECT mentorRole FROM communityConfirmation WHERE id='legacy-confirmation'").get()).toMatchObject({mentorRole:"UNKNOWN"});
      expect(db.prepare("SELECT name FROM user WHERE id='existing'").get()).toMatchObject({name:"Existing Member"});
      expect(db.prepare("SELECT count(*) AS count FROM Roles WHERE name IN ('MENTOR','INSTITUTION')").get()).toMatchObject({count:2});
      db.exec(`INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES ('journey','existing','Project','Built it','2026-10-24','institution');`);
      expect(()=>db.exec(`INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES ('bad','missing','Project','Built it','2026-10-24','institution');`)).toThrow(/FOREIGN KEY/);
      expect(()=>db.exec(`UPDATE communityJourney SET visibility='public' WHERE id='journey'`)).toThrow(/CHECK/);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
});
