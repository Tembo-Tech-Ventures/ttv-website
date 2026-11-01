import { afterEach, describe, expect, it, vi } from "vitest";
import { readMigration } from "@/test/sqlite-d1";
import { Capabilities, Intent, IntentSet, SPACE_ORDER } from "../contracts";
import { capabilitiesFor } from "./capabilities";
import { CAPABILITY_ROLE_MATRIX } from "./capabilities.fixtures";
import { createCapabilityDatabase } from "./capabilities.test-support";

const databases: ReturnType<typeof createCapabilityDatabase>["database"][] = [];
function setup(...args: Parameters<typeof createCapabilityDatabase>) {
  const fixture = createCapabilityDatabase(...args);
  databases.push(fixture.database);
  return fixture;
}
afterEach(() => { databases.splice(0).forEach((db) => db.close()); });

describe("capabilitiesFor", () => {
  it.each(CAPABILITY_ROLE_MATRIX)("$name", async (fixture) => {
    const { db, user, queries } = setup(fixture);
    const result = await capabilitiesFor(db, user);
    expect(result).toEqual(fixture.expected);
    expect(Capabilities.parse(result)).toEqual({
      cohortIds: fixture.expected.cohortIds, mentorCohortIds: fixture.expected.mentorCohortIds,
      isMentor: fixture.expected.isMentor, isInstitution: fixture.expected.isInstitution, isAdmin: fixture.expected.isAdmin,
    });
    expect(result.spaces).toEqual(SPACE_ORDER.filter((space) => fixture.expected.spaces.includes(space)));
    expect(queries).toHaveLength(user ? 3 : 0);
  });

  it("ignores caller-supplied role claims and other users' assignments", async () => {
    const { db, database, user } = setup();
    database.exec(`INSERT INTO programRole (id,userId,programId,name) VALUES ('other','synthetic-otieno','cohort-b','MENTOR')`);
    const claimedUser = { ...user!, isAdmin: true, roles: ["ADMIN", "MENTOR"] };
    const result = await capabilitiesFor(db, claimedUser);
    expect(result).toMatchObject({ isAdmin: false, isMentor: false, cohortIds: [], mentorCohortIds: [] });
  });

  it("does not cache revoked cohort or global roles", async () => {
    const { db, database, user } = setup({ globalRoles: ["MENTOR"], assignments: [{ programId: "cohort-a", name: "MENTOR" }] });
    expect((await capabilitiesFor(db, user)).cohortIds).toEqual(["cohort-a"]);
    database.exec('DELETE FROM programRole; DELETE FROM UserRoles');
    expect(await capabilitiesFor(db, user)).toEqual({ spaces: ["community", "profile"], cohortIds: [], mentorCohortIds: [], isAdmin: false, isMentor: false, isInstitution: false });
  });

  // Onboarding SPEC §1: a choice changes framing, never authority. Every valid intent set, with the
  // onboarding row and access requests it leads to, leaves each role baseline exactly as it was.
  const combinable = Intent.options.filter((intent) => intent !== "EXPLORING");
  const intentSets = [["EXPLORING"], ...Array.from({ length: 2 ** combinable.length },
    (_, mask) => combinable.filter((_intent, bit) => mask & (1 << bit)))];
  it("enumerates every valid intent set", () => {
    expect(intentSets).toHaveLength(9);
    expect(intentSets.every((set) => IntentSet.safeParse(set).success)).toBe(true);
  });
  it.each(CAPABILITY_ROLE_MATRIX.filter((fixture) => fixture.signedIn !== false))("intents never change $name", async (fixture) => {
    for (const intents of intentSets) {
      const { db, database, user, queries } = setup(fixture);
      database.exec(readMigration("0021_feature_flags.sql"));
      database.exec(readMigration("0025_onboarding.sql"));
      database.prepare("INSERT INTO member_onboarding(userId,stage,completedAt,createdAt,updatedAt) VALUES (?,'DONE',1,1,1)").run(user!.id);
      for (const intent of intents) database.prepare("INSERT INTO member_intent(userId,intent,createdAt) VALUES (?,?,1)").run(user!.id, intent);
      database.prepare(`INSERT INTO access_request(id,userId,role,status,note,organisation,scopeAcknowledgedAt,decidedAt,createdAt,updatedAt) VALUES
        ('pending',?1,'MENTOR','PENDING','Synthetic request to review mobile work.',NULL,NULL,NULL,1,1),
        ('approved',?1,'INSTITUTION','APPROVED','Synthetic request to find junior developers.','Savanna Mobile Labs',1,2,1,2)`).run(user!.id);
      expect({ intents, capabilities: await capabilitiesFor(db, user) }).toEqual({ intents, capabilities: fixture.expected });
      expect(queries).toHaveLength(3);
      expect(queries.join("\n")).not.toMatch(/member_intent|member_onboarding|access_request/);
    }
  });

  it.each(["userRole", "programApplication", "programRole"] as const)("propagates %s read failures instead of returning partial grants", async (table) => {
    const { db, user } = setup({ globalRoles: ["ADMIN"] });
    vi.spyOn(db.query[table], "findMany").mockRejectedValueOnce(new Error("D1 unavailable"));
    await expect(capabilitiesFor(db, user)).rejects.toThrow("D1 unavailable");
  });

});
