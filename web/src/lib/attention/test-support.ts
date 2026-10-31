import { readdirSync } from "node:fs";
import type { SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import type { CapabilityCase } from "@/lib/platform/server/capabilities.fixtures";
import type { PlatformCapabilities } from "@/lib/platform/server/capabilities";
import { SPACE_ORDER } from "@/lib/platform/contracts";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

export const allSpaces: PlatformCapabilities = {
  spaces: [...SPACE_ORDER], cohortIds: ["cohort-a"], mentorCohortIds: [], isAdmin: false, isMentor: false, isInstitution: false,
};

export function attentionDatabase(fixture: Partial<CapabilityCase> = {}) {
  const { database, db: d1 } = createSqliteD1();
  for (const file of readdirSync(new URL("../db/migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).toSorted()) database.exec(readMigration(file));
  database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId) VALUES ('cohort-a','Cohort A','Test','curriculum'),('cohort-b','Cohort B','Test','curriculum');`);
  for (const id of ["synthetic-wanjiku", "synthetic-otieno"]) {
    database.prepare("INSERT INTO user(id,name,email) VALUES (?,?,?)").run(id, id === "synthetic-wanjiku" ? "Wanjiku Njeri" : "Otieno Ouma", id + "@example.test");
    database.prepare("INSERT INTO studentProfile(id,userId,handle) VALUES (?,?,?)").run(id, id, id);
  }
  for (const role of fixture.globalRoles ?? []) {
    database.prepare("INSERT OR IGNORE INTO Roles(id,name) VALUES (?,?)").run(role, role);
    database.prepare("INSERT INTO UserRoles(id,userId,roleId) SELECT ?,'synthetic-wanjiku',id FROM Roles WHERE name=?").run("role-" + role, role);
  }
  for (const [i, application] of (fixture.applications ?? []).entries()) database.prepare(
    "INSERT INTO programApplication(id,userId,programId,status,application) VALUES (?,'synthetic-wanjiku',?,?,'{}')",
  ).run("application-" + i, application.programId, application.status);
  for (const [i, assignment] of (fixture.assignments ?? []).entries()) database.prepare(
    "INSERT INTO programRole(id,userId,programId,name) VALUES (?,'synthetic-wanjiku',?,?)",
  ).run("assignment-" + i, assignment.programId, assignment.name);

  // Preserve duplicate column names, just like D1 raw(), for joined projections.
  const relational = Object.assign(Object.create(d1) as D1Database, { prepare(query: string) {
    const statement = d1.prepare(query);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values: unknown[]) => Object.assign(bind(...values), { async raw() {
      const native = database.prepare(query);
      native.setReturnArrays(true);
      return native.all(...values as SQLInputValue[]);
    } });
    return statement;
  } });
  const queries: string[] = [];
  const parameters: SQLInputValue[][] = [];
  const db = drizzle(relational, { schema, logger: { logQuery(query, values) {
    queries.push(query); parameters[queries.length - 1] = values as SQLInputValue[];
  } } });
  function seed(id: string, options: { userId?: string; createdAt?: number; readAt?: number | null; space?: string; category?: string } = {}) {
    database.prepare("INSERT INTO profileContact(id,profileId,fromName,fromEmail,message) VALUES (?,?,'Visitor','visitor@example.test','Hello')")
      .run(id, options.userId ?? "synthetic-wanjiku");
    database.prepare(`INSERT INTO attention_item
      (id,userId,eventKey,kind,space,category,subjectKind,subjectId,subjectHref,subjectLabel,summary,createdAt,readAt)
      VALUES (?,?,?,'visitor_message',?,?,'visitorMessage',?,'/dashboard/leads','Visitor message','New visitor message',?,?)`)
      .run(id, options.userId ?? "synthetic-wanjiku", id, options.space ?? "profile", options.category ?? "updates", id,
        options.createdAt ?? 1000, options.readAt ?? null);
  }
  const explain = (index: number) => database.prepare("EXPLAIN QUERY PLAN " + queries[index]).all(...parameters[index]);
  return { database, db, queries, seed, explain };
}
