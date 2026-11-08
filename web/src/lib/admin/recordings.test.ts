import { readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { ADMIN_PAGE_SIZE } from "./paging";
import { readRecordingsPage } from "./recordings";

const databases: { close(): void }[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

/** Every migration, one cohort, and `count` recordings a minute apart, the last one in no cohort. */
function seeded(count: number) {
  const { database, db } = createSqliteD1();
  databases.push(database);
  for (const file of readdirSync(new URL("../db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES ('cohort-07','Cohort 07','Test','curriculum',0,4102444800);`);
  const insert = database.prepare(`INSERT INTO recording(id,programId,title,processingStatus,createdAt) VALUES (?,?,?,?,?)`);
  for (let index = 1; index <= count; index += 1) {
    insert.run(`recording-${index}`, index === count ? null : "cohort-07", `Week ${index}`, index === count ? "transcribing" : "complete", 1_790_000_000 + index * 60);
  }
  return drizzle(db, { schema });
}

describe("the admin's recordings, on the real schema", () => {
  it("lists the newest first, each with its cohort's name, or none", async () => {
    const { rows, total } = await readRecordingsPage(seeded(3), { page: 1 });
    expect(total).toBe(3);
    expect(rows.map((row) => row.id)).toEqual(["recording-3", "recording-2", "recording-1"]);
    expect(rows[0]).toMatchObject({ title: "Week 3", cohort: null, processingStatus: "transcribing" });
    expect(rows[1]).toMatchObject({ cohort: "Cohort 07", processingStatus: "complete" });
  });

  it("reads one page at a time, with the total of the whole list", async () => {
    const db = seeded(ADMIN_PAGE_SIZE + 2);
    const first = await readRecordingsPage(db, { page: 1 });
    const second = await readRecordingsPage(db, { page: 2 });
    expect(first.rows).toHaveLength(ADMIN_PAGE_SIZE);
    expect(second.rows.map((row) => row.id)).toEqual(["recording-2", "recording-1"]);
    expect(second.total).toBe(ADMIN_PAGE_SIZE + 2);
  });
});
