import { afterEach, describe, expect, it } from "vitest";
import { createCapabilityDatabase } from "./capabilities.test-support";
import { requestCapabilities } from "./request-capabilities";

const fixtures: ReturnType<typeof createCapabilityDatabase>[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); });

describe("requestCapabilities", () => {
  it("reads capabilities once per request, for every caller that shares its locals", async () => {
    const fixture = createCapabilityDatabase({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    fixtures.push(fixture);
    const locals = { user: { id: "synthetic-wanjiku" } } as App.Locals;
    const [first, second] = await Promise.all([requestCapabilities(fixture.db, locals), requestCapabilities(fixture.db, locals)]);
    expect(second).toBe(first);
    expect(first.cohortIds).toEqual(["cohort-a"]);
    expect(fixture.queries).toHaveLength(3);
  });

  it("never carries capabilities into the next request, or across a change of user", async () => {
    const fixture = createCapabilityDatabase({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    fixtures.push(fixture);
    const locals = { user: { id: "synthetic-wanjiku" } } as App.Locals;
    expect((await requestCapabilities(fixture.db, locals)).cohortIds).toEqual(["cohort-a"]);
    fixture.database.exec("UPDATE programApplication SET status = 'REJECTED'");
    // A new request has new locals: the revoked membership is gone at once.
    expect((await requestCapabilities(fixture.db, { user: { id: "synthetic-wanjiku" } } as App.Locals)).cohortIds).toEqual([]);
    locals.user = { id: "synthetic-otieno" } as App.Locals["user"];
    expect((await requestCapabilities(fixture.db, locals)).cohortIds).toEqual([]);
    locals.user = null;
    expect((await requestCapabilities(fixture.db, locals)).spaces).toEqual([]);
  });
});
