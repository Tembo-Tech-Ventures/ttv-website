import { readdirSync } from "node:fs";
import type { SQLInputValue } from "node:sqlite";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import type { CapabilityCase } from "@/lib/platform/server/capabilities.fixtures";

export function searchDatabase(fixture: Partial<CapabilityCase> = {}, actor = "synthetic-wanjiku") {
  const { database, db: base } = createSqliteD1();
  for (const file of readdirSync(new URL("../db/migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId) VALUES ('cohort-a','Cohort A','Test','curriculum'),('cohort-b','Cohort B','Test','curriculum');`);
  const users = [...new Set([actor, "synthetic-otieno", "synthetic-private", "synthetic-ineligible"])];
  for (const id of users) database.prepare("INSERT INTO user(id,name,email) VALUES (?, 'Private auth name', ?)").run(id, id + "@example.test");
  for (const role of fixture.globalRoles ?? []) {
    database.prepare("INSERT OR IGNORE INTO Roles(id,name) VALUES (?,?)").run(role, role);
    database.prepare("INSERT INTO UserRoles(id,userId,roleId) SELECT ?,?,id FROM Roles WHERE name=?").run("role-" + role, actor, role);
  }
  for (const [i, a] of (fixture.applications ?? []).entries()) database.prepare(
    "INSERT INTO programApplication(id,userId,programId,status,application) VALUES (?,?,?,?,'private admissions note')",
  ).run("application-" + i, actor, a.programId, a.status);
  for (const [i, a] of (fixture.assignments ?? []).entries()) database.prepare(
    "INSERT INTO programRole(id,userId,programId,name) VALUES (?,?,?,?)",
  ).run("assignment-" + i, actor, a.programId, a.name);
  for (const [id, status, completed] of [["synthetic-otieno", "PUBLISHED", true], ["synthetic-private", "DRAFT", true], ["synthetic-ineligible", "PUBLISHED", false]] as const) {
    database.prepare("INSERT INTO studentProfile(id,userId,handle,status,publicName,bio,moderationFlags) VALUES (?,?,?,?,'Otieno Ouma','Webhook builder','secret staff note')").run(id, id, id, status);
    if (completed) database.prepare("INSERT INTO programApplication(id,userId,programId,status,completedAt,application) VALUES (?,?,'cohort-b','COMPLETED',123,'secret admissions note')").run("completion-" + id, id);
    database.prepare("INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility,version) VALUES (?,?, 'Webhook project','Webhook evidence','2026-10-31','institution',3)").run("project-" + id, id);
    // A saved community profile, so institutional callers may discover them.
    database.prepare("INSERT INTO communityProfile(userId,headline) VALUES (?, 'Saved community profile')").run(id);
  }
  database.exec(`INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility)
    VALUES ('private-project','synthetic-otieno','Webhook private','secret project','2026-10-31','private');
    INSERT INTO recording(id,programId,title,processingStatus) VALUES
      ('recording-a','cohort-a','Session A','complete'),('recording-b','cohort-b','Session B','complete'),
      ('recording-pending','cohort-a','Pending recording','pending'),('recording-null',NULL,'Unscoped recording','complete');
    INSERT INTO transcript_segment(id,recordingId,startTime,endTime,text) VALUES
      ('segment-a','recording-a',12.5,20,'Webhook cohort A evidence'),
      ('segment-b','recording-b',5,10,'Webhook cohort B secret'),
      ('segment-pending','recording-pending',0,5,'Webhook pending secret'),
      ('segment-null','recording-null',0,5,'Webhook unscoped secret');`);
  const queries: { sql: string; values: unknown[] }[] = [];
  const retrieved: unknown[] = [];
  const db = Object.assign(Object.create(base) as D1Database, { prepare(sql: string) {
    const statement = base.prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values: unknown[]) => {
      queries.push({ sql, values });
      const bound = bind(...values);
      const all = bound.all.bind(bound);
      return Object.assign(bound, {
        async all() { const result = await all(); retrieved.push(...result.results); return result; },
        async raw() { const native = database.prepare(sql); native.setReturnArrays(true); return native.all(...values as SQLInputValue[]); },
      });
    };
    return statement;
  } });
  return { database, db, queries, retrieved, actor };
}
