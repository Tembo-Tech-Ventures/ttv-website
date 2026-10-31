import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import type { CapabilityCase } from "./capabilities.fixtures";

export function createCapabilityDatabase(fixture: Partial<CapabilityCase> & { legacySchema?: boolean } = {}, userId = "synthetic-wanjiku") {
  const { database, db: d1 } = createSqliteD1();
  database.exec(readMigration("0000_greedy_carnage.sql"));
  database.exec(readMigration("0005_brief_spiral.sql"));
  if (!fixture.legacySchema) database.exec(readMigration("0022_cohort_mentor_access.sql"));
  database.exec(`INSERT INTO curriculum (id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program (id,name,description,curriculumId) VALUES ('cohort-a','Synthetic cohort A','Test','curriculum'),('cohort-b','Synthetic cohort B','Test','curriculum');`);
  for (const id of [userId, "synthetic-otieno"]) {
    database.prepare('INSERT INTO user (id,name,email) VALUES (?,?,?)').run(id, id === userId ? "Wanjiku Njeri" : "Otieno Ouma", id + "@example.test");
  }
  for (const name of fixture.globalRoles ?? []) {
    database.prepare('INSERT INTO Roles (id,name) VALUES (?,?)').run(name, name);
    database.prepare('INSERT INTO UserRoles (id,userId,roleId) VALUES (?,?,?)').run("global-" + name, userId, name);
  }
  for (const [i, application] of (fixture.applications ?? []).entries()) {
    database.prepare('INSERT INTO programApplication (id,userId,programId,status,application) VALUES (?,?,?,?,?)')
      .run("application-" + i, userId, application.programId, application.status, "{}");
  }
  for (const [i, assignment] of (fixture.assignments ?? []).entries()) {
    database.prepare('INSERT INTO programRole (id,userId,programId,name) VALUES (?,?,?,?)')
      .run("assignment-" + i, userId, assignment.programId, assignment.name);
  }
  const queries: string[] = [];
  const db = relationalDrizzle(d1, queries);
  return { database, db, queries, user: fixture.signedIn === false ? null : { id: userId } };
}

/** Drizzle over the shared SQLite D1 shim, recording each query it issues. */
export function relationalDrizzle(d1: D1Database, queries: string[] = []) {
  // Drizzle's relational reader uses D1 raw(); the shared SQLite adapter
  // supplies all(). Keep this test-only bridge local to the test support.
  const relationalD1 = Object.assign(Object.create(d1) as D1Database, {
    prepare(query: string) {
      const statement = d1.prepare(query);
      const bind = statement.bind.bind(statement);
      statement.bind = (...values: unknown[]) => {
        const bound = bind(...values);
        return Object.assign(bound, {
          async raw() { return (await bound.all()).results.map((row) => Object.values(row)); },
        });
      };
      return statement;
    },
  });
  return drizzle(relationalD1, { schema, logger: { logQuery(query) { queries.push(query); } } });
}
