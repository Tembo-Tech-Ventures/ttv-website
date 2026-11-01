import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withStagingPersonas } from "./staging-personas.mjs";
import { verifyStagingFixtureTarget, STAGING_FIXTURE_DATABASE_ID } from "./staging-fixture-target.mjs";

async function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const directory = new URL("../../src/lib/db/migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter(fileName => fileName.endsWith(".sql")).toSorted()) db.exec(readFileSync(new URL(name, directory), "utf8"));
  const accountId = "a".repeat(32), expectedVersion = "b".repeat(40);
  const target = await verifyStagingFixtureTarget({ environmentName: "staging", accountId, expectedVersion, baseUrl: "https://staging.tembotechventures.com",
    api: async (path, options) => {
      if (path === "") return { id: accountId };
      if (path.endsWith("settings")) return { bindings: [
        { name: "DB", type: "d1", id: STAGING_FIXTURE_DATABASE_ID }, { name: "DEPLOYMENT_ENVIRONMENT", text: "staging" },
        { name: "DEPLOYMENT_VERSION", text: expectedVersion }, { name: "PRIMARY_DOMAIN", text: "staging.tembotechventures.com" },
        { name: "BETTER_AUTH_URL", text: "https://staging.tembotechventures.com" },
      ] };
      if (path.endsWith(STAGING_FIXTURE_DATABASE_ID)) return { uuid: STAGING_FIXTURE_DATABASE_ID, name: "ttv-website-db-staging" };
      const { sql, params } = options.body;
      return [{ results: sql.startsWith("SELECT") ? db.prepare(sql).all(...params) : (db.prepare(sql).run(...params), []) }];
    },
    fetchImpl: async () => Response.json({ service: "ttv-website", environment: "staging", version: expectedVersion, checks: { db: "ok" } }),
  });
  return { db, options: { target, signingSecret: "fictional-signing-secret-at-least-thirty-two-characters" } };
}
function contribute(db, personas) {
  const { member, mentor } = personas;
  for (const persona of [member, mentor]) db.prepare("INSERT INTO communityProfile(userId,headline,skills) VALUES (?,?,?)").run(persona.userId, "Synthetic builder", '["TypeScript"]');
  const journeyId = `${member.userId}-journey`;
  db.prepare("INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES (?,?,?,?,?,?)").run(journeyId, member.userId, "Synthetic project", "Synthetic evidence", "2026-10-24", "institution");
  db.prepare("INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES (?,?,?,?,?,?)").run(`${member.userId}-draft`, member.userId, "Synthetic draft", "Unpublished synthetic evidence", "2026-10-24", "private");
  db.prepare("INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion,mentorRole) VALUES (?,?,?,?,?,1,'MENTOR')").run(`${journeyId}-confirmation`, journeyId, mentor.userId, "I reviewed the synthetic artifact", "Local fixture review");
}
const communityTables = ["communityProfile", "communityJourney", "communityConfirmation"];
const snapshot = db => Object.fromEntries(communityTables.map(table => [table, db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()]));

describe("real persona cleanup cascades community evidence", () => {
  it.each([false, true])("cleans populated run on callback failure=%s and preserves another active run", async failVerification => {
    const { db, options } = await fixture();
    try {
      await withStagingPersonas({ ...options, run: async retainedRun => {
        contribute(db, retainedRun);
        const retained = snapshot(db);
        const retainedUsers = db.prepare("SELECT id FROM user ORDER BY id").all();
        const removedIds = [];
        const cleanup = withStagingPersonas({ ...options, run: async removedRun => {
          contribute(db, removedRun);
          removedIds.push(...Object.values(removedRun).map(persona => persona.userId));
          expect(removedRun.member.runId).not.toBe(retainedRun.member.runId);
          for (const table of communityTables) expect(db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n).toBe(retained[table].length * 2);
          if (failVerification) throw new Error("Synthetic verification failure");
        } });
        if (failVerification) await expect(cleanup).rejects.toThrow("setup or verification failed");
        else await cleanup;
        expect(snapshot(db)).toEqual(retained);
        expect(db.prepare("SELECT id FROM user ORDER BY id").all()).toEqual(retainedUsers);
        for (const userId of removedIds) {
          expect(db.prepare("SELECT 1 FROM stagingFixtureIdentity WHERE userId=?").get(userId)).toBeUndefined();
          expect(db.prepare("SELECT 1 FROM session WHERE userId=?").get(userId)).toBeUndefined();
          expect(db.prepare("SELECT 1 FROM personal_access_token WHERE userId=?").get(userId)).toBeUndefined();
          expect(db.prepare("SELECT 1 FROM UserRoles WHERE userId=?").get(userId)).toBeUndefined();
        }
      } });
      for (const table of [...communityTables, "user", "session", "personal_access_token", "stagingFixtureIdentity", "UserRoles"]) expect(db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n).toBe(0);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
  it("deleting a mentor removes their confirmation while the member profile and journeys survive", async () => {
    const { db, options } = await fixture();
    try {
      await withStagingPersonas({ ...options, run: async personas => {
        contribute(db, personas);
        db.prepare("DELETE FROM user WHERE id=?").run(personas.mentor.userId);
        expect(db.prepare("SELECT * FROM communityConfirmation").all()).toEqual([]);
        // The other member is provisioned with a saved profile, so institutions can discover them.
        expect(db.prepare("SELECT userId FROM communityProfile ORDER BY userId").all())
          .toEqual([personas.member.userId, personas.otherMember.userId].toSorted().map(userId => ({ userId })));
        expect(db.prepare("SELECT count(*) AS n FROM communityJourney WHERE userId=?").get(personas.member.userId).n).toBe(2);
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } });
      for (const table of communityTables) expect(db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n).toBe(0);
    } finally { db.close(); }
  });
});
