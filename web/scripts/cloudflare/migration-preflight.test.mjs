import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

import {
  assertNoBlockingDuplicates,
  collectUniqueIndexConstraints,
  findBlockingDuplicates,
  parseUniqueIndexConstraints,
} from "./migration-preflight.mjs";

function d1Result(rows) {
  return [{ results: rows, success: true }];
}

/**
 * Stubs the D1 query executor: one canned reply for the sqlite_master lookup,
 * then a per-table map of duplicate rows.
 */
function createExecutor({ duplicatesByTable = {}, tables }) {
  return vi.fn(async (_databaseId, sql) => {
    if (sql.includes("sqlite_master")) {
      return d1Result(tables.map((name) => ({ name })));
    }
    const table = /FROM "([^"]+)"/.exec(sql)?.[1];
    return d1Result(duplicatesByTable[table] ?? []);
  });
}

describe("parseUniqueIndexConstraints", () => {
  it("extracts single and composite unique indexes", () => {
    const sql = [
      "CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);",
      "--> statement-breakpoint",
      "CREATE UNIQUE INDEX `UserRoles_userId_roleId_unique` ON `UserRoles` (`userId`,`roleId`);",
    ].join("\n");

    expect(parseUniqueIndexConstraints(sql)).toEqual([
      { columns: ["email"], indexName: "user_email_unique", table: "user" },
      {
        columns: ["userId", "roleId"],
        indexName: "UserRoles_userId_roleId_unique",
        table: "UserRoles",
      },
    ]);
  });

  it("ignores non-unique indexes and other statements", () => {
    const sql = [
      "ALTER TABLE `program` ADD `applicationsOpen` integer DEFAULT false NOT NULL;",
      "CREATE INDEX `program_title_idx` ON `program` (`title`);",
    ].join("\n");

    expect(parseUniqueIndexConstraints(sql)).toEqual([]);
  });

  it("rejects identifiers that cannot be safely interpolated", () => {
    const sql =
      'CREATE UNIQUE INDEX `evil` ON `user"; DROP TABLE user; --` (`email`);';

    expect(() => parseUniqueIndexConstraints(sql)).toThrow(
      /unsafe table identifier/,
    );
  });
});

describe("collectUniqueIndexConstraints", () => {
  it("reads the repository migrations, including the cohort constraints", () => {
    const constraints = collectUniqueIndexConstraints();
    const byName = new Map(constraints.map((c) => [c.indexName, c]));

    expect(byName.get("programApplication_programId_userId_unique")).toEqual({
      columns: ["programId", "userId"],
      indexName: "programApplication_programId_userId_unique",
      table: "programApplication",
    });
    expect(byName.get("UserRoles_userId_roleId_unique")?.columns).toEqual([
      "userId",
      "roleId",
    ]);
    expect(byName.get("user_email_unique")?.table).toBe("user");
  });

  it("deduplicates an index redefined by a later migration", () => {
    const directory = new URL(
      "../../src/lib/db/migrations/",
      import.meta.url,
    );
    const constraints = collectUniqueIndexConstraints(directory);
    const names = constraints.map((constraint) => constraint.indexName);

    expect(new Set(names).size).toBe(names.length);
  });
});

describe("findBlockingDuplicates", () => {
  const constraints = [
    {
      columns: ["programId", "userId"],
      indexName: "programApplication_programId_userId_unique",
      table: "programApplication",
    },
  ];

  it("reports conflicting groups with their row counts", async () => {
    const executeQuery = createExecutor({
      duplicatesByTable: {
        programApplication: [
          { duplicateCount: 2, programId: "prog-1", userId: "user-1" },
        ],
      },
      tables: ["programApplication"],
    });

    await expect(
      findBlockingDuplicates({ constraints, databaseId: "db-1", executeQuery }),
    ).resolves.toEqual([
      {
        ...constraints[0],
        samples: [{ duplicateCount: 2, programId: "prog-1", userId: "user-1" }],
      },
    ]);
  });

  it("returns nothing when the database is clean", async () => {
    const executeQuery = createExecutor({ tables: ["programApplication"] });

    await expect(
      findBlockingDuplicates({ constraints, databaseId: "db-1", executeQuery }),
    ).resolves.toEqual([]);
  });

  it("skips tables that do not exist yet", async () => {
    const executeQuery = createExecutor({ tables: [] });

    await expect(
      findBlockingDuplicates({ constraints, databaseId: "db-1", executeQuery }),
    ).resolves.toEqual([]);
    expect(executeQuery).toHaveBeenCalledTimes(1);
  });

  it("ignores groups where an indexed column is NULL", async () => {
    const executeQuery = createExecutor({ tables: ["programApplication"] });

    await findBlockingDuplicates({
      constraints,
      databaseId: "db-1",
      executeQuery,
    });

    const [, sql] = executeQuery.mock.calls[1];
    expect(sql).toContain(
      'WHERE "programId" IS NOT NULL AND "userId" IS NOT NULL',
    );
  });

  it("groups by the constraint columns without interpolating user input", async () => {
    const executeQuery = createExecutor({ tables: ["programApplication"] });

    await findBlockingDuplicates({
      constraints,
      databaseId: "db-1",
      executeQuery,
    });

    const [, sql, params] = executeQuery.mock.calls[1];
    expect(sql).toContain('FROM "programApplication"');
    expect(sql).toContain('GROUP BY "programId", "userId"');
    expect(sql).toContain("HAVING COUNT(*) > 1");
    expect(params).toEqual([]);
  });

  it("requires a database id and a query executor", async () => {
    await expect(
      findBlockingDuplicates({ constraints, databaseId: "", executeQuery: vi.fn() }),
    ).rejects.toThrow(/database ID is required/);
    await expect(
      findBlockingDuplicates({ constraints, databaseId: "db-1" }),
    ).rejects.toThrow(/query executor is required/);
  });
});

/**
 * The preflight is only useful if its verdict matches what SQLite actually
 * does. These run the generated query and the real CREATE UNIQUE INDEX against
 * the same in-memory database and assert the two always agree.
 */
describe("preflight verdict matches real SQLite index creation", () => {
  const constraint = {
    columns: ["programId", "userId"],
    indexName: "programApplication_programId_userId_unique",
    table: "programApplication",
  };

  /** Executes the preflight's own SQL against a real SQLite database. */
  const sqliteExecutor = (database) => async (_databaseId, sql) => [
    { results: database.prepare(sql).all(), success: true },
  ];

  function seed(rows) {
    const database = new DatabaseSync(":memory:");
    database.exec(
      `CREATE TABLE "programApplication" (
         "id" text PRIMARY KEY NOT NULL,
         "programId" text,
         "userId" text NOT NULL
       )`,
    );
    const insert = database.prepare(
      'INSERT INTO "programApplication" VALUES (?, ?, ?)',
    );
    rows.forEach(([programId, userId], index) =>
      insert.run(`row-${index}`, programId, userId),
    );
    return database;
  }

  function indexCreationSucceeds(database) {
    try {
      database.exec(
        `CREATE UNIQUE INDEX "ix" ON "programApplication" ("programId", "userId")`,
      );
      return true;
    } catch {
      return false;
    }
  }

  const cases = [
    { name: "no duplicates", rows: [["p-1", "u-1"], ["p-1", "u-2"]] },
    { name: "a genuine duplicate", rows: [["p-1", "u-1"], ["p-1", "u-1"]] },
    {
      name: "repeated NULL programId (distinct to a unique index)",
      rows: [[null, "u-1"], [null, "u-1"]],
    },
    {
      name: "NULL rows alongside a genuine duplicate",
      rows: [[null, "u-1"], [null, "u-1"], ["p-1", "u-2"], ["p-1", "u-2"]],
    },
  ];

  for (const { name, rows } of cases) {
    it(`agrees with SQLite for ${name}`, async () => {
      const database = seed(rows);
      const conflicts = await findBlockingDuplicates({
        constraints: [constraint],
        databaseId: "db-1",
        executeQuery: sqliteExecutor(database),
      });

      expect(conflicts.length > 0).toBe(!indexCreationSucceeds(database));
      database.close();
    });
  }
});

describe("assertNoBlockingDuplicates", () => {
  const constraints = [
    {
      columns: ["userId", "roleId"],
      indexName: "UserRoles_userId_roleId_unique",
      table: "UserRoles",
    },
  ];

  it("passes silently when nothing conflicts", async () => {
    const executeQuery = createExecutor({ tables: ["UserRoles"] });

    await expect(
      assertNoBlockingDuplicates({
        constraints,
        databaseId: "db-1",
        executeQuery,
      }),
    ).resolves.toBeUndefined();
  });

  it("fails with the offending rows so an operator can reconcile them", async () => {
    const executeQuery = createExecutor({
      duplicatesByTable: {
        UserRoles: [{ duplicateCount: 3, roleId: "role-1", userId: "user-1" }],
      },
      tables: ["UserRoles"],
    });

    await expect(
      assertNoBlockingDuplicates({
        constraints,
        databaseId: "db-1",
        executeQuery,
      }),
    ).rejects.toThrow(
      /UserRoles_userId_roleId_unique on UserRoles \(userId, roleId\)[\s\S]*userId="user-1", roleId="role-1" \(3 rows\)[\s\S]*Migrations were not applied/,
    );
  });
});
