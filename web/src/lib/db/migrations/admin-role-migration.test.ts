import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL("./0004_seed_admin_role.sql", import.meta.url),
  "utf8"
).replaceAll("--> statement-breakpoint", "");

function createRolesDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE "Roles" (
      "id" text PRIMARY KEY NOT NULL,
      "name" text NOT NULL UNIQUE,
      "createdAt" integer DEFAULT (unixepoch()) NOT NULL,
      "updatedAt" integer DEFAULT (unixepoch()) NOT NULL
    );
  `);
  return database;
}

describe("ADMIN role data migration", () => {
  it("creates ADMIN on a fresh database and remains idempotent", () => {
    const database = createRolesDatabase();

    database.exec(migrationSql);
    database.exec(migrationSql);

    const rows = database
      .prepare('SELECT "id", "name" FROM "Roles" WHERE "name" = ?')
      .all("ADMIN") as Array<{ id: string; name: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{32}$/),
      name: "ADMIN",
    });
    database.close();
  });

  it("preserves an existing ADMIN role and independently seeded role IDs", () => {
    const database = createRolesDatabase();
    database
      .prepare('INSERT INTO "Roles" ("id", "name") VALUES (?, ?)')
      .run("agent-fixture-admin-role", "ADMIN");
    database
      .prepare('INSERT INTO "Roles" ("id", "name") VALUES (?, ?)')
      .run("agent-fixture-student-role", "STUDENT");

    database.exec(migrationSql);

    const rows = database
      .prepare('SELECT "id", "name" FROM "Roles" ORDER BY "name"')
      .all() as Array<{ id: string; name: string }>;
    expect(rows).toEqual([
      { id: "agent-fixture-admin-role", name: "ADMIN" },
      { id: "agent-fixture-student-role", name: "STUDENT" },
    ]);
    database.close();
  });
});
