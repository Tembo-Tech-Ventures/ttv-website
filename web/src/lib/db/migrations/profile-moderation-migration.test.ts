import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL("./0012_round_punisher.sql", import.meta.url),
  "utf8",
).replaceAll("--> statement-breakpoint", "");
const identitySnapshotMigrationSql = readFileSync(
  new URL("./0013_solid_zzzax.sql", import.meta.url),
  "utf8",
).replaceAll("--> statement-breakpoint", "");
const contentVersionMigrationSql = readFileSync(
  new URL("./0014_fat_omega_red.sql", import.meta.url),
  "utf8",
).replaceAll("--> statement-breakpoint", "");

function createPreMigrationDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE "studentProfile" (
      "id" text PRIMARY KEY NOT NULL,
      "status" text DEFAULT 'DRAFT' NOT NULL,
      "publishedAt" integer
    );
  `);
  return database;
}

describe("profile moderation migration", () => {
  it("adds moderation state without changing existing non-review profiles", () => {
    const database = createPreMigrationDatabase();
    database
      .prepare(
        'INSERT INTO "studentProfile" ("id", "status", "publishedAt") VALUES (?, ?, ?)',
      )
      .run("published", "PUBLISHED", 1_700_000_000);

    database.exec(migrationSql);

    const row = database
      .prepare('SELECT * FROM "studentProfile" WHERE "id" = ?')
      .get("published") as Record<string, unknown>;
    expect(row).toMatchObject({
      status: "PUBLISHED",
      publishedAt: 1_700_000_000,
      moderationOutcome: null,
      moderationFlags: null,
      moderationScores: null,
      moderationCheckedAt: null,
      moderationReviewRequired: 0,
    });
    database.close();
  });

  it("publishes an IN_REVIEW row and flags the unavailable check for an admin", () => {
    const database = createPreMigrationDatabase();
    database
      .prepare(
        'INSERT INTO "studentProfile" ("id", "status", "publishedAt") VALUES (?, ?, NULL)',
      )
      .run("legacy-review", "IN_REVIEW");

    database.exec(migrationSql);

    const row = database
      .prepare('SELECT * FROM "studentProfile" WHERE "id" = ?')
      .get("legacy-review") as Record<string, unknown>;
    expect(row).toMatchObject({
      status: "PUBLISHED",
      moderationOutcome: "error",
      moderationFlags: "[]",
      moderationScores: "{}",
      moderationReviewRequired: 1,
    });
    expect(row.publishedAt).toEqual(expect.any(Number));
    expect(row.moderationCheckedAt).toEqual(expect.any(Number));
    database.close();
  });
});

describe("public identity snapshot migration", () => {
  it("freezes names and only local avatars for published and suspended profiles", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE "user" (
        "id" text PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "image" text
      );
      CREATE TABLE "studentProfile" (
        "id" text PRIMARY KEY NOT NULL,
        "userId" text NOT NULL,
        "status" text DEFAULT 'DRAFT' NOT NULL
      );
      INSERT INTO "user" ("id", "name", "image") VALUES
        ('local-user', 'Local Builder', '/api/avatar/avatars/local-user/photo.webp'),
        ('remote-user', 'Remote Builder', 'https://avatars.githubusercontent.com/u/123'),
        ('suspended-user', 'Suspended Builder', '/api/avatar/avatars/suspended-user/photo.webp'),
        ('draft-user', 'Draft Builder', '/api/avatar/avatars/draft-user/photo.webp');
      INSERT INTO "studentProfile" ("id", "userId", "status") VALUES
        ('local-profile', 'local-user', 'PUBLISHED'),
        ('remote-profile', 'remote-user', 'PUBLISHED'),
        ('suspended-profile', 'suspended-user', 'SUSPENDED'),
        ('draft-profile', 'draft-user', 'DRAFT');
    `);

    database.exec(identitySnapshotMigrationSql);
    database.exec(contentVersionMigrationSql);

    expect(
      database
        .prepare(
          'SELECT "publicName", "publicAvatarUrl" FROM "studentProfile" WHERE "id" = ?',
        )
        .get("local-profile"),
    ).toEqual({
      publicName: "Local Builder",
      publicAvatarUrl: "/api/avatar/avatars/local-user/photo.webp",
    });
    expect(
      database
        .prepare(
          'SELECT "publicName", "publicAvatarUrl" FROM "studentProfile" WHERE "id" = ?',
        )
        .get("remote-profile"),
    ).toEqual({ publicName: "Remote Builder", publicAvatarUrl: null });
    expect(
      database
        .prepare(
          'SELECT "publicName", "publicAvatarUrl" FROM "studentProfile" WHERE "id" = ?',
        )
        .get("suspended-profile"),
    ).toEqual({
      publicName: "Suspended Builder",
      publicAvatarUrl: "/api/avatar/avatars/suspended-user/photo.webp",
    });
    expect(
      database
        .prepare(
          'SELECT "publicName", "publicAvatarUrl" FROM "studentProfile" WHERE "id" = ?',
        )
        .get("draft-profile"),
    ).toEqual({ publicName: null, publicAvatarUrl: null });
    expect(
      database
        .prepare('SELECT "contentVersion" FROM "studentProfile" ORDER BY "id"')
        .all(),
    ).toEqual([
      { contentVersion: 0 },
      { contentVersion: 0 },
      { contentVersion: 0 },
      { contentVersion: 0 },
    ]);
    database.close();
  });
});
