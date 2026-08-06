import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL("./0005_brief_spiral.sql", import.meta.url),
  "utf8",
).replaceAll("--> statement-breakpoint", "");

function createPreMigrationDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(
    `
      CREATE TABLE "program" (
        "id" text PRIMARY KEY NOT NULL
      );
      CREATE TABLE "programApplication" (
        "id" text PRIMARY KEY NOT NULL,
        "programId" text,
        "userId" text NOT NULL
      );
      CREATE TABLE "programRole" (
        "id" text PRIMARY KEY NOT NULL,
        "programId" text NOT NULL,
        "userId" text NOT NULL,
        "name" text NOT NULL
      );
      CREATE TABLE "UserRoles" (
        "id" text PRIMARY KEY NOT NULL,
        "userId" text NOT NULL,
        "roleId" text NOT NULL
      );
    `,
  );
  return database;
}

describe("cohort constraint migration", () => {
  it("closes existing cohorts and defaults new cohorts to closed", () => {
    const database = createPreMigrationDatabase();
    database.prepare('INSERT INTO "program" ("id") VALUES (?)').run("existing");

    database.exec(migrationSql);
    database.prepare('INSERT INTO "program" ("id") VALUES (?)').run("new");

    const rows = database
      .prepare('SELECT "id", "applicationsOpen" FROM "program" ORDER BY "id"')
      .all() as Array<{ applicationsOpen: number; id: string }>;
    expect(rows).toEqual([
      { id: "existing", applicationsOpen: 0 },
      { id: "new", applicationsOpen: 0 },
    ]);
    database.close();
  });

  it("enforces the new assignment and cohort uniqueness constraints", () => {
    const database = createPreMigrationDatabase();
    database.exec(migrationSql);

    database
      .prepare(
        'INSERT INTO "UserRoles" ("id", "userId", "roleId") VALUES (?, ?, ?)',
      )
      .run("ur-1", "user-1", "role-1");
    expect(() =>
      database
        .prepare(
          'INSERT INTO "UserRoles" ("id", "userId", "roleId") VALUES (?, ?, ?)',
        )
        .run("ur-2", "user-1", "role-1"),
    ).toThrow(/UNIQUE constraint failed: UserRoles\.userId, UserRoles\.roleId/);

    database
      .prepare(
        'INSERT INTO "programRole" ("id", "programId", "userId", "name") VALUES (?, ?, ?, ?)',
      )
      .run("pr-1", "program-1", "user-1", "TA");
    expect(() =>
      database
        .prepare(
          'INSERT INTO "programRole" ("id", "programId", "userId", "name") VALUES (?, ?, ?, ?)',
        )
        .run("pr-2", "program-1", "user-1", "TA"),
    ).toThrow(
      /UNIQUE constraint failed: programRole\.programId, programRole\.userId, programRole\.name/,
    );

    database
      .prepare(
        'INSERT INTO "programApplication" ("id", "programId", "userId") VALUES (?, ?, ?)',
      )
      .run("pa-1", "program-1", "user-1");
    expect(() =>
      database
        .prepare(
          'INSERT INTO "programApplication" ("id", "programId", "userId") VALUES (?, ?, ?)',
        )
        .run("pa-2", "program-1", "user-1"),
    ).toThrow(
      /UNIQUE constraint failed: programApplication\.programId, programApplication\.userId/,
    );

    database.close();
  });
});
