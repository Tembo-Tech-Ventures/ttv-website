import { readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { FILTER_MAX, SOURCE_NAME_MAX, expectedEnabled, reviewedCount, setSourceEnabled, sourceFromForm } from "./recording-import";

const databases: { close(): void }[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

const FOLDER = "1AbCdEfGhIjKlMnOp";
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

describe("the new import source form", () => {
  it("takes a name, a listed cohort, a Drive folder by address or ID, and an optional filter", () => {
    const parsed = sourceFromForm(form({ name: " Cohort 05 sessions ", programId: "cohort-05", driveFolder: `https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`, filenameContains: "" }), ["cohort-05"]);
    expect(parsed.errors).toEqual({});
    expect(parsed.source).toEqual({ name: "Cohort 05 sessions", programId: "cohort-05", driveFolderId: FOLDER, filenameContains: null });
    expect(sourceFromForm(form({ name: "C05", programId: "cohort-05", driveFolder: FOLDER, filenameContains: " Cohort 05 " }), ["cohort-05"]).source?.filenameContains).toBe("Cohort 05");
  });

  it("says what is wrong with each field, keeping what was written", () => {
    const empty = sourceFromForm(form({}), ["cohort-05"]);
    expect(empty.source).toBeUndefined();
    expect(empty.errors).toEqual({
      name: "Name the source, such as the cohort it imports for.",
      programId: "Choose the cohort its recordings belong to.",
      driveFolder: "Paste the Drive folder's address, or its ID.",
    });
    const wrong = sourceFromForm(
      form({ name: "x".repeat(SOURCE_NAME_MAX + 1), programId: "cohort-99", driveFolder: "https://example.test/folder", filenameContains: "y".repeat(FILTER_MAX + 1) }),
      ["cohort-05"],
    );
    expect(wrong.values.driveFolder).toBe("https://example.test/folder");
    expect(wrong.errors).toEqual({
      name: `Keep the name to ${SOURCE_NAME_MAX} characters.`,
      programId: "Choose a cohort from the list.",
      driveFolder: "That isn't a Drive folder's address or ID. Copy the address of the folder itself from Drive.",
      filenameContains: `Keep the filter to ${FILTER_MAX} characters.`,
    });
  });
});

describe("what the page posts back", () => {
  it("reads the state it showed and the count it reviewed, and nothing else", () => {
    expect([expectedEnabled("true"), expectedEnabled("false"), expectedEnabled("on"), expectedEnabled(null)]).toEqual([true, false, null, null]);
    expect([reviewedCount("12"), reviewedCount("0"), reviewedCount("-1"), reviewedCount("1e3"), reviewedCount("1234567890"), reviewedCount(null)]).toEqual([12, 0, null, null, null, null]);
  });
});

describe("pausing and turning on a source, on the real schema", () => {
  function seeded() {
    const { database, db } = createSqliteD1();
    databases.push(database);
    for (const file of readdirSync(new URL("../db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
      database.exec(readMigration(file));
    }
    database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
      INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES ('cohort-05','Cohort 05','Test','curriculum',0,4102444800);
      INSERT INTO recording_import_source(id,programId,name,driveFolderId,enabled) VALUES ('source','cohort-05','Cohort 05 sessions','${FOLDER}',0);`);
    return { database, db: drizzle(db, { schema }) };
  }
  const enabled = (database: ReturnType<typeof seeded>["database"]) => (database.prepare("SELECT enabled FROM recording_import_source WHERE id = 'source'").get() as { enabled: number }).enabled;

  it("changes it from the state the page showed", async () => {
    const { database, db } = seeded();
    expect(await setSourceEnabled(db, "source", false)).toEqual({ ok: true, enabled: true });
    expect(enabled(database)).toBe(1);
    expect(await setSourceEnabled(db, "source", true)).toEqual({ ok: true, enabled: false });
    expect(enabled(database)).toBe(0);
  });

  it("leaves a change someone else made, and says when the source is gone", async () => {
    const { database, db } = seeded();
    expect(await setSourceEnabled(db, "source", true)).toEqual({ ok: false, reason: "changed" });
    expect(enabled(database)).toBe(0);
    expect(await setSourceEnabled(db, "missing", false)).toEqual({ ok: false, reason: "missing" });
  });
});
