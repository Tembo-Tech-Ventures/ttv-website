import { readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { LegacyImportValidationError, MAX_EXPORT_BYTES, exportFromForm, importSummary, reviewExport } from "./data-migration";

const databases: { close(): void }[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seeded() {
  const { database, db } = createSqliteD1();
  databases.push(database);
  for (const file of readdirSync(new URL("../db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO "user"(id,name,email,emailVerified) VALUES ('existing','Amina Hassan','amina@example.test',1);`);
  return db;
}

const EXPORT = {
  version: 1,
  exportedAt: "2026-08-01T12:00:00.000Z",
  users: [
    { id: "legacy-1", name: "Wanjiku Mwangi", email: "wanjiku@example.test" },
    { id: "legacy-2", name: "Brian Otieno", email: "brian@example.test" },
  ],
  roles: [{ id: "role-admin", name: "ADMIN" }],
  userRoles: [{ userId: "legacy-1", roleId: "role-admin" }],
};

const form = (fields: Record<string, string | File>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const json = (value: unknown, name = "export.json") => new File([JSON.stringify(value)], name, { type: "application/json" });

describe("the export the form carries", () => {
  it("reads a chosen JSON file, or the reviewed text sent back", async () => {
    const chosen = await exportFromForm(form({ export: json(EXPORT) }));
    expect(chosen).toMatchObject({ ok: true, payload: EXPORT });
    const carried = await exportFromForm(form({ exportText: JSON.stringify(EXPORT) }));
    expect(carried).toMatchObject({ ok: true, payload: EXPORT });
  });

  it("says what is wrong in words: nothing chosen, too large, or not JSON", async () => {
    expect(await exportFromForm(form({}))).toEqual({ ok: false, error: "Choose the legacy JSON export to review." });
    expect(await exportFromForm(form({ export: new File([new Uint8Array(MAX_EXPORT_BYTES + 1)], "big.json") }))).toMatchObject({ ok: false, error: expect.stringMatching(/larger than 5 MB/) });
    expect(await exportFromForm(form({ export: new File(["{ not json"], "export.json") }))).toEqual({ ok: false, error: "That file isn't JSON. Choose the JSON file the legacy export tool wrote." });
  });
});

describe("reviewing an export, on the real schema", () => {
  it("counts each table as the import would, ignoring privilege records, and writes nothing", async () => {
    const db = seeded();
    const review = await reviewExport(db, EXPORT);
    expect(review.version).toBe(1);
    expect(review.exportedAt.toISOString()).toBe("2026-08-01T12:00:00.000Z");
    expect(review.rows.map((row) => [row.label, row.privilege, row.records])).toEqual([
      ["Users", false, 2], ["Curricula", false, 0], ["Program partners", false, 0], ["Programs", false, 0],
      ["Program roles", false, 0], ["Program applications", false, 0], ["Roles", true, 1], ["User roles", true, 1],
    ]);
    expect({ importable: review.importable, ignored: review.ignored }).toEqual({ importable: 2, ignored: 2 });
    expect((await db.prepare(`SELECT count(*) AS n FROM "user"`).first<{ n: number }>())?.n).toBe(1);
  });

  it("refuses what the import would refuse, before anything is written", async () => {
    const db = seeded();
    await expect(reviewExport(db, { version: 1, exportedAt: "2026-08-01T12:00:00.000Z" })).rejects.toThrow(LegacyImportValidationError);
    await expect(reviewExport(db, [])).rejects.toThrow(LegacyImportValidationError);
    const clash = { ...EXPORT, users: [{ id: "someone-else", name: "Amina", email: "AMINA@example.test" }] };
    await expect(reviewExport(db, clash)).rejects.toMatchObject({ code: "identity_collision" });
  });
});

describe("the import's outcome in words", () => {
  it("says what changed, what was skipped and ignored, and the tables it changed", () => {
    const none = { users: 0, curricula: 0, programPartners: 0, programs: 0, programRoles: 0, programApplications: 0 };
    expect(importSummary({ success: true, totalChanges: 3, totalSkipped: 1, totalIgnored: 2, imported: { ...none, users: 2, curricula: 1 }, skipped: { ...none, users: 1 }, ignored: { roles: 1, userRoles: 1 } }))
      .toBe("3 rows changed, 1 already there and skipped, 2 privilege records ignored. Changed: users 2, curricula 1.");
    expect(importSummary({ success: true, totalChanges: 0, totalSkipped: 0, totalIgnored: 1, imported: none, skipped: none, ignored: { roles: 1, userRoles: 0 } }))
      .toBe("0 rows changed, 0 already there and skipped, 1 privilege records ignored.");
  });
});
