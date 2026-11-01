import { readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { saveApplicationAnswers } from "./save-application-answers";

/**
 * The answers form's server side, against the real migrations: what a member's
 * POST may and may not write.
 */

const MIGRATIONS = readdirSync(new URL("../db/migrations/", import.meta.url))
  .filter((name) => name.endsWith(".sql"))
  .toSorted();

const QUESTIONS = JSON.stringify({
  version: "1",
  name: "Njeri Wambui",
  partnerId: "partner-1",
  submission: [
    { type: "string", name: "name", label: "Name", value: "Njeri Wambui" },
    { type: "string", name: "partnerId", label: "Partner", value: "partner-1" },
    { type: "requiredBoolean", name: "htmlCssDone", label: "HTML/CSS?", value: true },
    { type: "textarea", name: "project", label: "Your project idea", value: "A chama ledger" },
  ],
});

const VALID = {
  "answer.name": "Njeri Wambui",
  "answer.htmlCssDone": "yes",
  "answer.project": "A matatu route finder",
};

let sqlite: ReturnType<typeof createSqliteD1>;

function form(entries: Record<string, string>) {
  return (field: string) => entries[field] ?? null;
}

function stored(id = "app-njeri") {
  return sqlite.database.prepare('SELECT "status", "application" FROM "programApplication" WHERE "id" = ?').get(id) as
    | { status: string; application: string }
    | undefined;
}

function insertApplication(id: string, userId: string, status: string, application: string, programId = "cohort-06") {
  sqlite.database
    .prepare('INSERT INTO "programApplication" ("id","programId","userId","status","application") VALUES (?,?,?,?,?)')
    .run(id, programId, userId, status, application);
}

function save(entries: Record<string, string>, overrides: { userId?: string; applicationId?: string; programId?: string } = {}) {
  return saveApplicationAnswers({
    db: sqlite.db,
    userId: overrides.userId ?? "njeri",
    applicationId: overrides.applicationId ?? "app-njeri",
    programId: overrides.programId,
    read: form(entries),
  });
}

beforeEach(() => {
  sqlite = createSqliteD1();
  for (const name of MIGRATIONS) sqlite.database.exec(readMigration(name));
  sqlite.database.exec(`
    INSERT INTO "user" ("id","name","email") VALUES ('njeri','Njeri Wambui','njeri@invalid.ttv'), ('wanjiku','Wanjiku Mwangi','wanjiku@invalid.ttv');
    INSERT INTO "curriculum" ("id","title","description") VALUES ('curriculum','Full-stack foundations','Fictional');
    INSERT INTO "program" ("id","name","description","curriculumId","applicationsOpen") VALUES
      ('cohort-06','Cohort 06','Fictional','curriculum',1), ('demo-program','Demo','Fictional','curriculum',1);
  `);
  insertApplication("app-njeri", "njeri", "PENDING", QUESTIONS);
});

afterEach(() => sqlite.database.close());

describe("saveApplicationAnswers", () => {
  it("writes the answers into the member's own pending application", async () => {
    const result = await save(VALID);
    expect(result.kind).toBe("saved");
    const application = JSON.parse(stored()!.application);
    expect(application.submission[3].value).toBe("A matatu route finder");
    expect(application.submission[2].value).toBe(true);
    expect(result.kind === "saved" && result.application).toBe(stored()!.application);
  });

  it("never writes the partner link, even when the form sends one", async () => {
    await save({ ...VALID, "answer.partnerId": "partner-forged" });
    const application = JSON.parse(stored()!.application);
    expect(application.partnerId).toBe("partner-1");
    expect(application.submission[1].value).toBe("partner-1");
  });

  it("returns a rejected form with what was typed and writes nothing", async () => {
    const before = stored()!.application;
    const result = await save({ ...VALID, "answer.htmlCssDone": "", "answer.project": "Typed, then rejected" });
    expect(result).toEqual({
      kind: "invalid",
      drafts: { name: "Njeri Wambui", htmlCssDone: "", project: "Typed, then rejected" },
      errors: { htmlCssDone: "Choose Yes or No." },
    });
    expect(stored()!.application).toBe(before);
  });

  it("ignores a raw JSON field: it is not an answer", async () => {
    const before = stored()!.application;
    const result = await save({ application: '{"enrollment":{"source":"ADMIN","schemaVersion":1}}' });
    expect(result.kind).toBe("invalid");
    expect(stored()!.application).toBe(before);
  });

  it("writes nothing to an application with no questions", async () => {
    insertApplication("app-self", "njeri", "PENDING", "{}", "demo-program");
    const result = await save({ application: '{"about":"written as JSON"}', ...VALID }, { applicationId: "app-self" });
    expect(result).toEqual({ kind: "not-editable" });
    expect(stored("app-self")!.application).toBe("{}");
  });

  it.each(["APPROVED", "AUDIT", "REJECTED", "COMPLETED"])("says it was reviewed, and writes nothing, once it is %s", async (status) => {
    // The form was loaded while PENDING; staff reviewed it before the member pressed Save.
    sqlite.database.prepare('UPDATE "programApplication" SET "status" = ? WHERE "id" = ?').run(status, "app-njeri");
    expect(await save(VALID)).toEqual({ kind: "reviewed" });
    expect(stored()!.application).toBe(QUESTIONS);
  });

  it("treats a reviewed application with no questions as nothing to answer", async () => {
    insertApplication("app-approved", "njeri", "APPROVED", "{}", "demo-program");
    expect(await save(VALID, { applicationId: "app-approved" })).toEqual({ kind: "not-editable" });
  });

  it("writes nothing to another member's application", async () => {
    expect(await save(VALID, { userId: "wanjiku" })).toEqual({ kind: "not-found" });
    expect(stored()!.application).toBe(QUESTIONS);
  });

  it("writes nothing outside the cohort a restricted member may use", async () => {
    expect(await save(VALID, { programId: "demo-program" })).toEqual({ kind: "not-found" });
    expect(stored()!.application).toBe(QUESTIONS);
  });

  /** A D1 whose first UPDATE is preceded by a change to the row, as if staff acted while the form was open. */
  function raceWith(change: string) {
    const prepare = sqlite.db.prepare.bind(sqlite.db);
    let raced = false;
    sqlite.db.prepare = ((sql: string) => {
      if (!raced && sql.startsWith("UPDATE")) {
        raced = true;
        sqlite.database.exec(change);
      }
      return prepare(sql);
    }) as D1Database["prepare"];
  }

  it("is a lost race when the team reviews it between read and write", async () => {
    raceWith(`UPDATE "programApplication" SET "status" = 'APPROVED' WHERE "id" = 'app-njeri'`);
    expect(await save(VALID)).toEqual({ kind: "stale" });
    expect(stored()).toEqual({ status: "APPROVED", application: QUESTIONS });
  });

  it("is a lost race when the answers change between read and write (another tab)", async () => {
    const other = QUESTIONS.replace("A chama ledger", "Saved from another tab");
    raceWith(`UPDATE "programApplication" SET "application" = '${other}' WHERE "id" = 'app-njeri'`);
    expect(await save(VALID)).toEqual({ kind: "stale" });
    expect(stored()!.application).toBe(other);
  });

  it("keeps the typed answers when the database write fails", async () => {
    const prepare = sqlite.db.prepare.bind(sqlite.db);
    sqlite.db.prepare = ((sql: string) => {
      if (sql.startsWith("UPDATE")) throw new Error("D1 unavailable");
      return prepare(sql);
    }) as D1Database["prepare"];
    expect(await save(VALID)).toEqual({ kind: "failed", drafts: { name: "Njeri Wambui", htmlCssDone: "yes", project: "A matatu route finder" } });
    expect(stored()!.application).toBe(QUESTIONS);
  });
});
