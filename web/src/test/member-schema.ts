import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { readMigration } from "./sqlite-d1";

/** The real consolidated tables for older focused fixtures that build only a schema slice. */
function loadSchema() {
  const full = new DatabaseSync(":memory:");
  try {
    for (const name of readdirSync(
      new URL("../lib/db/migrations/", import.meta.url),
    )
      .filter((n) => /^\d+.*\.sql$/.test(n))
      .toSorted())
      full.exec(readMigration(name));
    const profile = full
      .prepare("SELECT sql FROM sqlite_master WHERE name='studentProfile'")
      .get() as { sql: string };
    return {
      sql: profile.sql,
      columns: full.prepare("PRAGMA table_info(studentProfile)").all() as {
        name: string;
        type: string;
        dflt_value: string | null;
      }[],
    };
  } finally {
    full.close();
  }
}
const consolidated = loadSchema();
export function addMemberSchema(database: DatabaseSync) {
  database.exec(
    consolidated.sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"),
  );
  const present = new Set(
    (
      database.prepare("PRAGMA table_info(studentProfile)").all() as {
        name: string;
      }[]
    ).map((c) => c.name),
  );
  for (const c of consolidated.columns) {
    if (!present.has(c.name))
      database.exec(
        `ALTER TABLE studentProfile ADD COLUMN "${c.name}" ${c.type}${c.dflt_value === null ? "" : ` DEFAULT ${c.dflt_value}`}`,
      );
  }
  database.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS studentProfile_userId_unique ON studentProfile(userId); CREATE UNIQUE INDEX IF NOT EXISTS studentProfile_handle_unique ON studentProfile(handle)",
  );
  const columns = new Set(
    (
      database.prepare("PRAGMA table_info(communityJourney)").all() as {
        name: string;
      }[]
    ).map((c) => c.name),
  );
  for (const statement of readMigration(
    "0039_member_profiles_and_work.sql",
  ).split(";")) {
    const add = statement.match(
      /ALTER TABLE communityJourney ADD COLUMN (\w+)[\s\S]*/,
    );
    if (add && !columns.has(add[1])) database.exec(add[0]);
  }
}
