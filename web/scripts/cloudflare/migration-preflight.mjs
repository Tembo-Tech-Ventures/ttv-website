import { readdirSync, readFileSync } from "node:fs";

/**
 * Migrations that introduce a `CREATE UNIQUE INDEX` fail outright when the
 * target database already holds duplicate rows. On a long-lived environment
 * that failure lands in the middle of `wrangler d1 migrations apply`, after the
 * build and secret upload, with an opaque SQLite message.
 *
 * These helpers read the unique indexes straight out of the migration SQL and
 * check the live database for conflicting rows *before* any migration runs, so
 * the deploy stops early with an actionable report instead. Deriving the
 * constraint list from the migrations themselves keeps the preflight in step
 * with the schema without a second list to maintain.
 */

const MIGRATIONS_DIRECTORY = new URL(
  "../../src/lib/db/migrations/",
  import.meta.url,
);

const UNIQUE_INDEX_PATTERN =
  /CREATE\s+UNIQUE\s+INDEX\s+`([^`]+)`\s+ON\s+`([^`]+)`\s*\(([^)]*)\)/gi;

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Number of conflicting groups reported per constraint before truncating. */
const SAMPLE_LIMIT = 5;

function assertSafeIdentifier(identifier, kind) {
  if (!SAFE_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(
      `Refusing to build a preflight query for unsafe ${kind} identifier: ${identifier}`,
    );
  }
  return identifier;
}

function quote(identifier) {
  return `"${identifier}"`;
}

/**
 * Extracts every unique index declared in a migration SQL string.
 *
 * @param {string} sql
 * @returns {Array<{columns: string[], indexName: string, table: string}>}
 */
export function parseUniqueIndexConstraints(sql) {
  const constraints = [];
  for (const match of sql.matchAll(UNIQUE_INDEX_PATTERN)) {
    const [, indexName, table, rawColumns] = match;
    const columns = rawColumns
      .split(",")
      .map((column) => column.trim().replaceAll("`", ""))
      .filter((column) => column.length > 0);

    if (columns.length === 0) {
      continue;
    }

    constraints.push({
      columns: columns.map((column) => assertSafeIdentifier(column, "column")),
      indexName,
      table: assertSafeIdentifier(table, "table"),
    });
  }
  return constraints;
}

/**
 * Collects the unique indexes declared across every migration, in file order.
 * Later definitions of the same index name win, matching migration replay.
 *
 * @param {URL | string} [directory]
 * @returns {Array<{columns: string[], indexName: string, table: string}>}
 */
export function collectUniqueIndexConstraints(directory = MIGRATIONS_DIRECTORY) {
  const byIndexName = new Map();
  const fileNames = readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  for (const fileName of fileNames) {
    const sql = readFileSync(new URL(fileName, directory), "utf8");
    for (const constraint of parseUniqueIndexConstraints(sql)) {
      byIndexName.set(constraint.indexName, constraint);
    }
  }

  return [...byIndexName.values()];
}

function queryRows(result) {
  const statements = Array.isArray(result) ? result : [result];
  return statements.flatMap((statement) => statement?.results ?? []);
}

async function readExistingTableNames(databaseId, executeQuery) {
  const result = await executeQuery(
    databaseId,
    `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table'`,
    [],
  );
  return new Set(queryRows(result).map((row) => row.name));
}

/**
 * Finds rows that would violate a not-yet-applied unique index.
 *
 * Tables that do not exist yet (a brand new database, or an index whose table
 * was since dropped) are skipped: there is nothing to conflict with.
 *
 * @param {{
 *   constraints?: Array<{columns: string[], indexName: string, table: string}>,
 *   databaseId: string,
 *   executeQuery: (databaseId: string, sql: string, params: unknown[]) => Promise<unknown>,
 * }} options
 * @returns {Promise<Array<{columns: string[], indexName: string, samples: object[], table: string}>>}
 */
export async function findBlockingDuplicates({
  constraints = collectUniqueIndexConstraints(),
  databaseId,
  executeQuery,
}) {
  if (!databaseId) throw new Error("A D1 database ID is required.");
  if (typeof executeQuery !== "function") {
    throw new Error("A D1 query executor is required.");
  }

  const existingTables = await readExistingTableNames(databaseId, executeQuery);
  const conflicts = [];

  for (const constraint of constraints) {
    if (!existingTables.has(constraint.table)) {
      continue;
    }

    const columnList = constraint.columns.map(quote).join(", ");
    const result = await executeQuery(
      databaseId,
      `SELECT ${columnList}, COUNT(*) AS "duplicateCount"
         FROM ${quote(constraint.table)}
        GROUP BY ${columnList}
       HAVING COUNT(*) > 1
        LIMIT ${SAMPLE_LIMIT}`,
      [],
    );

    const samples = queryRows(result);
    if (samples.length > 0) {
      conflicts.push({ ...constraint, samples });
    }
  }

  return conflicts;
}

function describeConflict(conflict) {
  const samples = conflict.samples
    .map((sample) => {
      const key = conflict.columns
        .map((column) => `${column}=${JSON.stringify(sample[column])}`)
        .join(", ");
      return `      - ${key} (${sample.duplicateCount} rows)`;
    })
    .join("\n");

  const truncated =
    conflict.samples.length === SAMPLE_LIMIT
      ? `\n      - ... additional conflicts may exist (showing first ${SAMPLE_LIMIT})`
      : "";

  return `  ${conflict.indexName} on ${conflict.table} (${conflict.columns.join(", ")}):\n${samples}${truncated}`;
}

/**
 * Fails the deploy before migrations run when existing rows would break a
 * unique index, reporting exactly which rows need reconciling.
 *
 * @param {Parameters<typeof findBlockingDuplicates>[0]} options
 */
export async function assertNoBlockingDuplicates(options) {
  const conflicts = await findBlockingDuplicates(options);
  if (conflicts.length === 0) {
    return;
  }

  throw new Error(
    [
      "Migration preflight failed: existing rows conflict with unique indexes " +
        "declared in the migrations.",
      ...conflicts.map(describeConflict),
      "Reconcile these rows in the target database before deploying. " +
        "Migrations were not applied and the worker was not updated.",
    ].join("\n"),
  );
}
