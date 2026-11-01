import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * A D1Database backed by an in-memory node:sqlite database, so tests exercise
 * the real SQL (constraints, joins, cascades) instead of a hand-written mock.
 * Covers the subset of the D1 API the app uses: prepare/bind/first/all/run and
 * batch (run inside one transaction, as D1 does). Batches never interleave, as
 * D1 serialises writes: a batch runs synchronously from BEGIN to COMMIT.
 */
export function createSqliteD1(database = new DatabaseSync(":memory:")) {
  database.exec("PRAGMA foreign_keys = ON");

  function prepare(sql: string) {
    const statement = {
      params: [] as SQLInputValue[],
      bind(...values: unknown[]) {
        return Object.assign(Object.create(statement) as typeof statement, {
          params: values.map((value): SQLInputValue => {
            if (value === undefined) return null;
            if (typeof value === "boolean") return Number(value);
            return value as SQLInputValue;
          }),
        });
      },
      async first<T>(column?: string): Promise<T | null> {
        const row = database.prepare(sql).get(...this.params) as
          | Record<string, unknown>
          | undefined;
        if (!row) return null;
        return (column ? row[column] : { ...row }) as T;
      },
      async all<T>() {
        const rows = database.prepare(sql).all(...this.params);
        return {
          results: rows.map((row) => ({ ...row })) as T[],
          success: true,
          meta: {},
        };
      },
      runSync() {
        const result = database.prepare(sql).run(...this.params);
        return {
          results: [],
          success: true,
          meta: { changes: Number(result.changes) },
        };
      },
      async run() {
        return this.runSync();
      },
    };
    return statement;
  }

  async function batch(statements: ReturnType<typeof prepare>[]) {
    database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(statement.runSync());
      database.exec("COMMIT");
      return results;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    database,
    db: { prepare, batch } as unknown as D1Database,
  };
}

export function readMigration(name: string): string {
  return readFileSync(
    new URL(`../lib/db/migrations/${name}`, import.meta.url),
    "utf8"
  ).replaceAll("--> statement-breakpoint", "");
}

/** The slice of the auth schema that feature tables reference. */
export const MINIMAL_AUTH_SCHEMA = `
  CREATE TABLE "user" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "email" text NOT NULL UNIQUE,
    "emailVerified" integer DEFAULT 0 NOT NULL,
    "image" text,
    "createdAt" integer DEFAULT (unixepoch()) NOT NULL,
    "updatedAt" integer DEFAULT (unixepoch()) NOT NULL
  );
  CREATE TABLE "Roles" ("id" text PRIMARY KEY NOT NULL, "name" text NOT NULL UNIQUE);
  CREATE TABLE "UserRoles" (
    "id" text PRIMARY KEY NOT NULL,
    "userId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
    "roleId" text NOT NULL REFERENCES "Roles"("id") ON DELETE cascade
  );
`;
