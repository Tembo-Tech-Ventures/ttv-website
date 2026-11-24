import { readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRaw } from "@/lib/attention/test-support";

const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));

import { GET } from "./suggestions";

const STUDENT = "synthetic-wanjiku";
const ADMIN = "synthetic-amina";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

/** Every migration, a student in cohort A, an admin, and recordings in each state the policy tells apart. */
function seeded(recordings = "") {
  const { database, db } = createSqliteD1();
  databases.push(database);
  for (const file of readdirSync(new URL("../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId) VALUES ('cohort-a','Cohort A','Test','curriculum'),('cohort-b','Cohort B','Test','curriculum');
    INSERT INTO user(id,name,email) VALUES ('${STUDENT}','Wanjiku Njeri','wanjiku@example.test'),('${ADMIN}','Amina Hassan','amina@example.test');
    INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('application','${STUDENT}','cohort-a','APPROVED','{}');
    INSERT OR IGNORE INTO Roles(id,name) VALUES ('ADMIN','ADMIN');
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'admin-role','${ADMIN}',id FROM Roles WHERE name='ADMIN';
    ${recordings}`);
  mocks.env.DB = withRaw(database, db);
}

const RECORDINGS = `INSERT INTO recording(id,programId,title,processingStatus,recordedAt) VALUES
  ('a1','cohort-a','Customer Discovery','complete',1),('a2','cohort-a','Mentor Hours Aug 15','complete',2),
  ('a-working','cohort-a','Still transcribing','transcribing',3),('b1','cohort-b','Cohort B pricing','complete',4),
  ('loose',NULL,'Unsorted upload','complete',5),('a-deleted','cohort-a','Deleted session','complete',6);
  UPDATE recording SET deletedAt = 1 WHERE id = 'a-deleted';`;

async function suggestionsFor(user: { id: string } | null) {
  const response = await GET({ request: new Request("https://example.com/api/chat/suggestions"), locals: { user } } as never);
  return (await response.json() as { suggestions: string[] }).suggestions;
}

describe("GET /api/chat/suggestions", () => {
  it("returns empty suggestions when not authenticated", async () => {
    seeded();
    expect(await suggestionsFor(null)).toEqual([]);
  });

  it("returns program-discovery prompts to someone with no cohort", async () => {
    seeded(RECORDINGS);
    const suggestions = await suggestionsFor({ id: "synthetic-nobody" });
    expect(suggestions).toHaveLength(3);
    expect(suggestions).toContain("What programs does TTV offer?");
    expect(suggestions).toContain("What's my application status?");
  });

  it("names the newest sessions the person may read, complete ones only", async () => {
    seeded(RECORDINGS);
    expect(await suggestionsFor({ id: STUDENT })).toEqual([
      'What were the key takeaways from "Mentor Hours Aug 15"?',
      'What were the key takeaways from "Customer Discovery"?',
    ]);
  });

  it("names any cohort's sessions, and one with no cohort, to an admin, never a deleted one", async () => {
    seeded(RECORDINGS);
    expect(await suggestionsFor({ id: ADMIN })).toEqual([
      'What were the key takeaways from "Unsorted upload"?',
      'What were the key takeaways from "Cohort B pricing"?',
      'What were the key takeaways from "Mentor Hours Aug 15"?',
    ]);
  });

  it("returns curriculum prompts when enrolled but no recordings exist", async () => {
    seeded();
    const suggestions = await suggestionsFor({ id: STUDENT });
    expect(suggestions).toHaveLength(3);
    expect(suggestions).toContain("Tell me about my program");
  });
});
