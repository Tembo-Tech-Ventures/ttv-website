import { readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { PROJECT_QUEUE, interestLabel, parseProjectStatus, readProjectsPage } from "./projects";

describe("the admin's client project list", () => {
  it("works through every stored status, waiting ones first", () => {
    expect(PROJECT_QUEUE.toSorted()).toEqual([...schema.clientProject.status.enumValues].toSorted());
    expect(PROJECT_QUEUE[0]).toBe("PENDING");
  });

  it("reads a status filter only when it is one a project can have", () => {
    for (const status of PROJECT_QUEUE) expect(parseProjectStatus(status)).toBe(status);
    expect(parseProjectStatus(null)).toBeNull();
    expect(parseProjectStatus("pending")).toBeNull();
  });

  it("says how many builders are interested in words", () => {
    expect(interestLabel(0)).toBe("None yet");
    expect(interestLabel(1)).toBe("1 builder");
    expect(interestLabel(3)).toBe("3 builders");
  });
});

describe("the interest a project's row counts, on the real schema", () => {
  const databases: { close(): void }[] = [];
  afterEach(() => databases.splice(0).forEach((database) => database.close()));

  /** Every migration, two builders and two projects: one with standing and withdrawn interest, one withdrawn only. */
  function seeded() {
    const { database, db } = createSqliteD1();
    databases.push(database);
    for (const file of readdirSync(new URL("../db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
      database.exec(readMigration(file));
    }
    database.exec(`
      INSERT INTO user(id,name,email) VALUES ('synthetic-achieng','Achieng Otieno','achieng@example.test'),('synthetic-baraka','Baraka Mwangi','baraka@example.test');
      INSERT INTO studentProfile(id,userId,handle,status,headline) VALUES
        ('profile-achieng','synthetic-achieng','achieng-otieno','PUBLISHED','Fictional builder'),
        ('profile-baraka','synthetic-baraka','baraka-mwangi','PUBLISHED','Fictional builder');
      INSERT INTO clientProject(id,organization,contactName,contactEmail,title,description,status) VALUES
        ('project-mixed','Chama Savings','Grace Wanjiru','grace@example.test','Member savings tracker','Fictional project.','APPROVED'),
        ('project-withdrawn','Duka Supplies','Peter Kiprono','peter@example.test','Stock counter','Fictional project.','APPROVED');
      INSERT INTO projectInterest(id,projectId,profileId,status) VALUES
        ('interest-standing','project-mixed','profile-achieng','INTERESTED'),
        ('interest-withdrawn','project-mixed','profile-baraka','WITHDRAWN'),
        ('interest-gone','project-withdrawn','profile-achieng','WITHDRAWN');`);
    return drizzle(db, { schema });
  }

  it("counts a builder who is still interested, never one who withdrew", async () => {
    const { rows, total } = await readProjectsPage(seeded(), { status: null, page: 1 });
    const interestOf = (id: string) => interestLabel(rows.find((row) => row.id === id)?.interest ?? Number.NaN);

    expect(total).toBe(2);
    expect(interestOf("project-mixed")).toBe("1 builder");
    expect(interestOf("project-withdrawn")).toBe("None yet");
  });
});
