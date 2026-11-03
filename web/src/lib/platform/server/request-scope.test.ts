import { afterEach, describe, expect, it } from "vitest";
import { capabilitiesFor } from "./capabilities";
import { createCapabilityDatabase } from "./capabilities.test-support";
import { requestScopeActive, requestScoped, withRequestScope } from "./request-scope";

const databases: { close(): void }[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function setup() {
  const fixture = createCapabilityDatabase({ globalRoles: ["ADMIN"], applications: [{ programId: "cohort-a", status: "APPROVED" }] });
  databases.push(fixture.database);
  fixture.database.exec(`INSERT INTO programApplication (id,userId,programId,status,application)
    VALUES ('otieno-application','synthetic-otieno','cohort-b','APPROVED','{}')`);
  return fixture;
}
const WANJIKU = { id: "synthetic-wanjiku" };
const OTIENO = { id: "synthetic-otieno" };

describe("withRequestScope", () => {
  it.each(["GET", "HEAD", "get"])("shares one capability read per user in a %s request", async (method) => {
    const { db, queries } = setup();
    const [first, second, other] = await withRequestScope(method, () => Promise.all([
      capabilitiesFor(db, WANJIKU), capabilitiesFor(db, WANJIKU), capabilitiesFor(db, OTIENO),
    ]));
    expect(first).toBe(second);
    expect(first.cohortIds).toEqual(["cohort-a"]);
    expect(other.cohortIds).toEqual(["cohort-b"]);
    // Three tables per user, once each.
    expect(queries).toHaveLength(6);
    expect(Object.isFrozen(first) && Object.isFrozen(first.cohortIds)).toBe(true);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("reads again on every call in a %s request", async (method) => {
    const { db, queries } = setup();
    const [first, second] = await withRequestScope(method, async () => {
      expect(requestScopeActive()).toBe(false);
      return Promise.all([capabilitiesFor(db, WANJIKU), capabilitiesFor(db, WANJIKU)]);
    });
    expect(first).not.toBe(second);
    expect(queries).toHaveLength(6);
  });

  it("ends with the request: a revoked role and assignment apply on the next one", async () => {
    const { db, database } = setup();
    const before = await withRequestScope("GET", () => capabilitiesFor(db, WANJIKU));
    database.exec("DELETE FROM UserRoles; UPDATE programApplication SET status='REJECTED' WHERE userId='synthetic-wanjiku'");
    const after = await withRequestScope("GET", () => capabilitiesFor(db, WANJIKU));
    expect([before.isAdmin, before.cohortIds]).toEqual([true, ["cohort-a"]]);
    expect([after.isAdmin, after.cohortIds]).toEqual([false, []]);
    expect(requestScopeActive()).toBe(false);
    // Outside any request scope nothing is kept either.
    expect(await capabilitiesFor(db, WANJIKU)).not.toBe(await capabilitiesFor(db, WANJIKU));
  });

  it("never shares between concurrent requests, for the same or different users", async () => {
    const { db, queries } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const request = (user: { id: string }) => withRequestScope("GET", async () => {
      const first = await capabilitiesFor(db, user);
      await gate;
      return { first, again: await capabilitiesFor(db, user), key: await requestScoped("k", async () => user.id) };
    });
    const pending = [request(WANJIKU), request(OTIENO), request(WANJIKU)];
    release();
    const [wanjiku, otieno, wanjikuAgain] = await Promise.all(pending);
    expect(wanjiku.again).toBe(wanjiku.first);
    expect(wanjikuAgain.first).not.toBe(wanjiku.first);
    expect([wanjiku.key, otieno.key, wanjikuAgain.key]).toEqual([WANJIKU.id, OTIENO.id, WANJIKU.id]);
    expect([wanjiku.first.isAdmin, otieno.first.isAdmin]).toEqual([true, false]);
    expect(queries).toHaveLength(9);
  });

  it("shares a failed read with every caller in the request, and reads afresh in the next", async () => {
    let calls = 0;
    const read = () => requestScoped("failing", async () => {
      calls += 1;
      if (calls === 1) throw new Error("D1 unavailable");
      return calls;
    });
    await withRequestScope("GET", async () => {
      await expect(read()).rejects.toThrow("D1 unavailable");
      await expect(read()).rejects.toThrow("D1 unavailable");
    });
    expect(await withRequestScope("GET", read)).toBe(2);
  });

  it("never caches a signed-out caller's empty capabilities", async () => {
    const { db, queries } = setup();
    const capabilities = await withRequestScope("GET", () => capabilitiesFor(db, null));
    expect(capabilities.spaces).toEqual([]);
    expect(queries).toHaveLength(0);
  });
});
