import { readdirSync } from "node:fs";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

/** Every migration, two fictional people (Wairimu and Otieno) and an administrator (Amina). */
export function onboardingDatabase() {
  const setup = createSqliteD1();
  const { database } = setup;
  for (const name of readdirSync(new URL("../db/migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(name));
  }
  database.exec(`INSERT INTO user(id,name,email) VALUES
      ('wairimu','Wairimu Ndung''u','wairimu@example.test'),
      ('otieno','Otieno Ouma','otieno@example.test'),
      ('amina','Amina Hassan','amina@example.test');
    INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId) VALUES ('cohort-a','Cohort A','Test','curriculum');
    INSERT OR IGNORE INTO Roles(id,name) VALUES ('role-admin','ADMIN'),('role-mentor','MENTOR'),('role-institution','INSTITUTION');`);

  // Earlier migrations seed some of these roles under their own ids, so roles are always found by name.
  function grant(userId: string, role: "ADMIN" | "MENTOR" | "INSTITUTION") {
    database.prepare("INSERT INTO UserRoles(id,userId,roleId) SELECT ?,?,id FROM Roles WHERE name=?").run(`${userId}-${role}`, userId, role);
  }
  function revoke(userId: string, role: "ADMIN" | "MENTOR" | "INSTITUTION") {
    database.prepare("DELETE FROM UserRoles WHERE userId=? AND roleId=(SELECT id FROM Roles WHERE name=?)").run(userId, role);
  }
  /** What B-O.3's decision endpoint will write; here only to put requests into decided states. */
  function decide(id: string, decision: "APPROVED" | "DECLINED", at: number, message: string | null = null) {
    database.prepare(`UPDATE access_request SET status=?, decisionId=?, decisionMessage=?, decidedBy='amina', decidedAt=?, updatedAt=?
      WHERE id=? AND status='PENDING'`).run(decision, `decision-${id}`, message, at, at, id);
  }
  const rows = (sql: string, ...params: string[]) => database.prepare(sql).all(...params);
  return { ...setup, grant, revoke, decide, rows };
}
