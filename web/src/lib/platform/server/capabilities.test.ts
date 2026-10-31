import { afterEach, describe, expect, it, vi } from "vitest";
import { Capabilities, SPACE_ORDER } from "../contracts";
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

  it.each(["userRole", "programApplication", "programRole"] as const)("propagates %s read failures instead of returning partial grants", async (table) => {
    const { db, user } = setup({ globalRoles: ["ADMIN"] });
    vi.spyOn(db.query[table], "findMany").mockRejectedValueOnce(new Error("D1 unavailable"));
    await expect(capabilitiesFor(db, user)).rejects.toThrow("D1 unavailable");
  });

});
