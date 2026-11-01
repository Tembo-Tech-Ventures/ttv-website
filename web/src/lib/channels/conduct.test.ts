import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { ConductAcknowledgement } from "@/lib/platform/contracts";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { acknowledgeConduct, CONDUCT_VERSION, getConductAcknowledgement } from "./conduct";

let database: DatabaseSync;
let db: D1Database;
beforeEach(() => {
  ({ database, db } = createSqliteD1());
  database.exec(readMigration("0000_greedy_carnage.sql"));
  database.exec(readMigration("0029_channel_conduct.sql"));
  database.exec(`INSERT INTO "user"(id,name,email) VALUES ('wanjiku','Wanjiku Kamau','wanjiku@example.test'),('otieno','Otieno Ouma','otieno@example.test')`);
});
afterEach(() => { database.close(); vi.restoreAllMocks(); });

describe("channel code of conduct", () => {
  it("starts at version 1", () => {
    expect(CONDUCT_VERSION).toBe(1);
  });

  it("knows nobody has agreed until they do, then returns their agreement", async () => {
    expect(await getConductAcknowledgement(db, "wanjiku")).toBeNull();
    const agreed = await acknowledgeConduct(db, "wanjiku", CONDUCT_VERSION, { now: 1_000 });
    expect(agreed).toEqual({ version: CONDUCT_VERSION, acknowledgedAt: 1_000, current: true });
    expect(ConductAcknowledgement.parse(agreed)).toEqual(agreed);
    expect(await getConductAcknowledgement(db, "wanjiku")).toEqual(agreed);
    // Agreements are per person.
    expect(await getConductAcknowledgement(db, "otieno")).toBeNull();
  });

  it("defaults to the current version and the current time", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_793_539_000_000);
    expect(await acknowledgeConduct(db, "wanjiku")).toEqual({ version: CONDUCT_VERSION, acknowledgedAt: 1_793_539_000_000, current: true });
  });

  it("keeps the original date when someone agrees to the same version again", async () => {
    await acknowledgeConduct(db, "wanjiku", 1, { now: 1_000 });
    expect(await acknowledgeConduct(db, "wanjiku", 1, { now: 9_000 })).toEqual({ version: 1, acknowledgedAt: 1_000, current: true });
  });

  it("after the text changes, asks earlier signers again, records the new agreement, and never moves back", async () => {
    const v2 = { currentVersion: 2 };
    await acknowledgeConduct(db, "wanjiku", 1, { now: 1_000 });
    expect(await getConductAcknowledgement(db, "wanjiku", v2)).toEqual({ version: 1, acknowledgedAt: 1_000, current: false });
    expect(await acknowledgeConduct(db, "wanjiku", 2, { ...v2, now: 5_000 })).toEqual({ version: 2, acknowledgedAt: 5_000, current: true });
    // A stale page posting the old version cannot undo the newer agreement or its date.
    expect(await acknowledgeConduct(db, "wanjiku", 1, { ...v2, now: 9_000 })).toEqual({ version: 2, acknowledgedAt: 5_000, current: true });
    expect(await getConductAcknowledgement(db, "wanjiku", v2)).toEqual({ version: 2, acknowledgedAt: 5_000, current: true });
  });

  it.each([0, -1, 1.5, Number.NaN, CONDUCT_VERSION + 1])("refuses version %s without writing", async (version) => {
    await expect(acknowledgeConduct(db, "wanjiku", version, { now: 1_000 })).rejects.toThrow(RangeError);
    expect(database.prepare("SELECT COUNT(*) AS n FROM channel_conduct").get()).toEqual({ n: 0 });
  });

  it("fails loudly for someone who does not exist, instead of reporting an agreement", async () => {
    await expect(acknowledgeConduct(db, "nobody", 1, { now: 1_000 })).rejects.toThrow(/FOREIGN KEY/);
  });

  it("reads and writes with one statement each", async () => {
    const prepare = vi.spyOn(db, "prepare");
    await getConductAcknowledgement(db, "wanjiku");
    await acknowledgeConduct(db, "wanjiku", 1, { now: 1_000 });
    expect(prepare).toHaveBeenCalledTimes(2);
  });
});
