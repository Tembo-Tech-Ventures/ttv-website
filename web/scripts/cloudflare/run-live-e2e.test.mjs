import { EventEmitter } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_PREVIEW_PERSONAS,
  deriveAgentPreviewPersonaToken,
  deriveAgentPreviewToken,
  seedAgentPreviewAccess,
  seedAgentPreviewFixtures,
} from "./agent-preview-auth.mjs";
import {
  PERSONA_TOKEN_VARIABLES,
  main,
  resolvePlaywrightAgentToken,
  resolvePlaywrightPersonaTokens,
} from "./run-live-e2e.mjs";
import { createSqliteD1 } from "../../src/test/sqlite-d1";
import { capabilitiesFor } from "../../src/lib/platform/server/capabilities";
import { relationalDrizzle } from "../../src/lib/platform/server/capabilities.test-support";

const PREVIEW_SECRET = "p".repeat(32);
const preview = {
  AGENT_PREVIEW_SECRET: PREVIEW_SECRET,
  AGENT_PREVIEW_RUN_ID: "github-123-1",
  EXPECTED_DEPLOYMENT_ENVIRONMENT: "agent-pr-55",
};
const personaToken = (persona) =>
  deriveAgentPreviewPersonaToken(PREVIEW_SECRET, "agent-pr-55", persona, "github-123-1");

describe("live browser authentication", () => {
  it("rejects missing run scope instead of deriving legacy preview credentials", () => {
    const environment = { AGENT_PREVIEW_SECRET: "p".repeat(32), EXPECTED_DEPLOYMENT_ENVIRONMENT: "agent-pr-55" };
    expect(() => resolvePlaywrightAgentToken(environment)).toThrow("AGENT_PREVIEW_RUN_ID");
    expect(() => resolvePlaywrightPersonaTokens(environment)).toThrow("AGENT_PREVIEW_RUN_ID");
  });
  it("uses a securely supplied personal access token for live verification", () => {
    expect(
      resolvePlaywrightAgentToken({
        TTV_PERSONAL_ACCESS_TOKEN: `ttv_pat_${"a".repeat(64)}`,
        EXPECTED_DEPLOYMENT_ENVIRONMENT: "production",
      })
    ).toBe(`ttv_pat_${"a".repeat(64)}`);
  });

  it("prefers an explicit PAT over environment-specific delegated auth", () => {
    expect(
      resolvePlaywrightAgentToken({
        TTV_PERSONAL_ACCESS_TOKEN: `ttv_pat_${"b".repeat(64)}`,
        PLAYWRIGHT_AGENT_TOKEN: "staging-session-token",
      })
    ).toBe(`ttv_pat_${"b".repeat(64)}`);
  });

  it("uses an explicitly supplied shared-environment token", () => {
    expect(
      resolvePlaywrightAgentToken({
        PLAYWRIGHT_AGENT_TOKEN: "staging-session-token",
        EXPECTED_DEPLOYMENT_ENVIRONMENT: "staging",
      })
    ).toBe("staging-session-token");
  });

  it("derives the isolated token without printing or persisting it", () => {
    const previewSecret = "p".repeat(32);
    expect(
      resolvePlaywrightAgentToken({
        AGENT_PREVIEW_SECRET: previewSecret,
        AGENT_PREVIEW_RUN_ID: "github-123-1",
        EXPECTED_DEPLOYMENT_ENVIRONMENT: "agent-pr-55",
      })
    ).toBe(deriveAgentPreviewToken(previewSecret, "agent-pr-55", "github-123-1"));
  });

  it("never treats the preview secret as a shared staging token", () => {
    expect(
      resolvePlaywrightAgentToken({
        AGENT_PREVIEW_SECRET: "p".repeat(32),
        AGENT_PREVIEW_RUN_ID: "github-123-1",
        EXPECTED_DEPLOYMENT_ENVIRONMENT: "staging",
      })
    ).toBeUndefined();
  });

  it("supplies deterministic tokens for every isolated preview persona", () => {
    expect(resolvePlaywrightPersonaTokens(preview)).toEqual({
      PLAYWRIGHT_NEW_STUDENT_TOKEN: personaToken("newStudent"),
      PLAYWRIGHT_ACCEPTED_STUDENT_TOKEN: personaToken("acceptedStudent"),
      PLAYWRIGHT_GRADUATE_STUDENT_TOKEN: personaToken("graduateStudent"),
      PLAYWRIGHT_MENTOR_TOKEN: personaToken("mentor"),
      PLAYWRIGHT_INSTITUTION_TOKEN: personaToken("institution"),
    });
    expect(Object.values(PERSONA_TOKEN_VARIABLES).toSorted()).toEqual(Object.keys(AGENT_PREVIEW_PERSONAS).toSorted());
  });

  it.each(["production", "staging"])("never derives persona tokens in %s", (environmentName) => {
    expect(
      resolvePlaywrightPersonaTokens({ ...preview, EXPECTED_DEPLOYMENT_ENVIRONMENT: environmentName })
    ).toEqual({});
  });
});


describe("feedback identity runner integration", () => {
  function child(code = 0) {
    return vi.fn(() => { const emitter = new EventEmitter(); globalThis.queueMicrotask(() => emitter.emit("close", code)); return emitter; });
  }
  it("passes the runtime-only feedback token to the child and awaits cleanup", async () => {
    const spawnImpl = child(); let cleaned = false;
    const withFeedbackWriter = vi.fn(async ({ run }) => { try { await run("fictional-runtime-token"); } finally { cleaned = true; } });
    await main([], { environment: { EXPECTED_DEPLOYMENT_ENVIRONMENT: "agent-pr-171-1" }, spawnImpl, withFeedbackWriter });
    expect(cleaned).toBe(true);
    expect(spawnImpl.mock.calls[0][2].env.PLAYWRIGHT_FEEDBACK_STUDENT_TOKEN).toBe("fictional-runtime-token");
    expect(spawnImpl.mock.calls[0][1].join(" ")).not.toContain("fictional-runtime-token");
  });
  it("propagates child failure through the lifecycle", async () => {
    let cleaned = false;
    await expect(main([], { environment: { EXPECTED_DEPLOYMENT_ENVIRONMENT: "agent-pr-171-1" }, spawnImpl: child(1), withFeedbackWriter: async ({ run }) => { try { await run("fictional"); } finally { cleaned = true; } } })).rejects.toThrow("Playwright exited");
    expect(cleaned).toBe(true);
  });
  it.each(["staging", "production"])("does not provision or forward feedback credentials in %s", async environmentName => {
    const spawnImpl = child(), withFeedbackWriter = vi.fn();
    await main([], { environment: { EXPECTED_DEPLOYMENT_ENVIRONMENT: environmentName, PLAYWRIGHT_FEEDBACK_STUDENT_TOKEN: "do-not-forward" }, spawnImpl, withFeedbackWriter });
    expect(withFeedbackWriter).not.toHaveBeenCalled();
    expect(spawnImpl.mock.calls[0][2].env.PLAYWRIGHT_FEEDBACK_STUDENT_TOKEN).toBe("");
  });
  it("list mode never provisions", async () => {
    const withFeedbackWriter = vi.fn();
    await main(["--list"], { environment: { EXPECTED_DEPLOYMENT_ENVIRONMENT: "agent-pr-171-1" }, spawnImpl: child(), withFeedbackWriter });
    expect(withFeedbackWriter).not.toHaveBeenCalled();
  });
});

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  const migrations = new URL("../../src/lib/db/migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter((n) => n.endsWith(".sql")).toSorted()) {
    database.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  const executeQuery = vi.fn(async (_databaseId, sql, params) => {
    const statement = database.prepare(sql);
    return [{ results: sql.trimStart().startsWith("SELECT") ? statement.all(...params) : (statement.run(...params), []) }];
  });
  return { database, executeQuery };
}

/** The deploy order: the isolated admin first, then the fixtures. */
async function seed(executeQuery, environmentName = "agent-pr-55") {
  const options = {
    databaseId: "db-agent-pr-55", executeQuery, environmentName, previewSecret: PREVIEW_SECRET, runId: "github-123-1",
    now: new Date("2026-10-31T12:00:00.000Z"),
  };
  await seedAgentPreviewAccess(options);
  await seedAgentPreviewFixtures(options);
}

function personaRows(database, userId) {
  const rows = (sql) => database.prepare(sql).all(userId).map((row) => ({ ...row }));
  return {
    user: rows('SELECT "name", "email" FROM "user" WHERE "id" = ?'),
    roles: rows('SELECT r."name" FROM "UserRoles" ur JOIN "Roles" r ON r."id" = ur."roleId" WHERE ur."userId" = ?').map((row) => row.name),
    sessions: rows('SELECT "token", "userAgent", "expiresAt" - "createdAt" AS "lifetime" FROM "session" WHERE "userId" = ?'),
    cohortRows: ["programRole", "programApplication", "studentProfile"]
      .flatMap((table) => rows(`SELECT "id" FROM "${table}" WHERE "userId" = ?`)),
  };
}

describe("preview mentor and institution personas", () => {
  const { mentor, institution } = AGENT_PREVIEW_PERSONAS;

  it("seeds one global role each, with no cohort rows, and capabilities to match", async () => {
    const { database, executeQuery } = migratedDatabase();
    await seed(executeQuery);

    expect(personaRows(database, mentor.userId)).toEqual({
      user: [{ name: "Fictional Wairimu Kariuki", email: "journey-mentor@invalid.ttv" }],
      roles: ["MENTOR"],
      sessions: [{ token: personaToken("mentor"), userAgent: "ttv-agent:isolated-preview:persona", lifetime: 8 * 60 * 60 }],
      cohortRows: [],
    });
    expect(personaRows(database, institution.userId)).toEqual({
      user: [{ name: "Fictional Kiprono Langat", email: "journey-institution@invalid.ttv" }],
      roles: ["INSTITUTION"],
      sessions: [{ token: personaToken("institution"), userAgent: "ttv-agent:isolated-preview:persona", lifetime: 8 * 60 * 60 }],
      cohortRows: [],
    });

    const db = relationalDrizzle(createSqliteD1(database).db);
    expect(await capabilitiesFor(db, { id: mentor.userId })).toEqual({
      spaces: ["community", "mentoring", "profile"],
      cohortIds: [], mentorCohortIds: [], isMentor: true, isInstitution: false, isAdmin: false,
    });
    // Approval is the role alone: discovery, and no cohort, mentor or admin reach.
    expect(await capabilitiesFor(db, { id: institution.userId })).toEqual({
      spaces: ["community", "discover", "profile"],
      cohortIds: [], mentorCohortIds: [], isMentor: false, isInstitution: true, isAdmin: false,
    });
  });

  it("converges on reseed, discarding roles and cohort rows a journey added", async () => {
    const { database, executeQuery } = migratedDatabase();
    await seed(executeQuery);
    const snapshot = () => [mentor.userId, institution.userId].map((id) => personaRows(database, id));
    const tableCounts = () => ["user", "UserRoles", "session", "programRole", "programApplication",
      "communityProfile", "communityConfirmation", "attention_item", "chat_session", "chat_message"]
      .map((table) => database.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n);
    const first = snapshot();
    const counts = tableCounts();

    database.exec(`
      INSERT INTO "UserRoles" ("id", "userId", "roleId") SELECT 'journey-granted-admin', '${institution.userId}', "id" FROM "Roles" WHERE "name" = 'ADMIN';
      INSERT INTO "programRole" ("id", "programId", "userId", "name") VALUES ('journey-invite', 'ttv-fixture-program-cohort-04', '${mentor.userId}', 'MENTOR');
      INSERT INTO "programApplication" ("id", "programId", "userId", "status", "application") VALUES ('journey-apply', 'ttv-fixture-program-cohort-04', '${institution.userId}', 'APPROVED', '{}');
      INSERT INTO "communityProfile" ("userId", "headline") VALUES ('${institution.userId}', 'Written by a journey');
      INSERT INTO "communityJourney" ("id", "userId", "title", "description", "occurredAt", "visibility") VALUES
        ('journey-own', '${institution.userId}', 'Own entry', 'Written by a journey', '2026-10', 'private'),
        ('journey-other', 'ttv-fixture-user-amina', 'Shared work', 'Another member', '2026-10', 'institution');
      INSERT INTO "communityConfirmation" ("id", "journeyId", "mentorId", "statement", "method", "journeyVersion") VALUES
        ('journey-confirm', 'journey-other', '${mentor.userId}', 'I reviewed this', 'code_review', 1);
      INSERT INTO "attention_item" ("id", "userId", "eventKey", "kind", "space", "category", "subjectKind", "subjectId", "subjectHref", "subjectLabel", "summary", "createdAt")
        VALUES ('journey-attention', '${mentor.userId}', 'journey-event', 'work_confirmed', 'mentoring', 'updates', 'journey', 'journey-other', '/dashboard/mentoring', 'Shared work', 'Confirmed', 1);
      INSERT INTO "chat_session" ("id", "userId", "title") VALUES ('journey-chat', '${institution.userId}', 'Ask Tembo');
      INSERT INTO "chat_message" ("id", "sessionId", "userId", "role", "content") VALUES ('journey-chat-message', 'journey-chat', '${institution.userId}', 'user', 'A question');
    `);
    await seed(executeQuery);

    expect(snapshot()).toEqual(first);
    expect(tableCounts()).toEqual(counts);
    // Their writes go; another member's journey stays.
    expect(database.prepare('SELECT "id" FROM "communityJourney"').all().map((row) => row.id)).toEqual(["journey-other"]);
  });

  it.each([
    ["production", 'must start with "agent-"', 'must start with "agent-"'],
    ["staging", 'must start with "agent-"', 'must start with "agent-"'],
    ["prod", 'must start with "agent-"', 'must start with "agent-"'],
    ["", 'must start with "agent-"', "require both environmentName and previewSecret"],
  ])("refuses to seed for %j before touching the database", async (environmentName, accessError, fixturesError) => {
    const executeQuery = vi.fn();
    const options = { databaseId: "db-1", executeQuery, environmentName, previewSecret: PREVIEW_SECRET, runId: "github-123-1" };
    await expect(seedAgentPreviewAccess(options)).rejects.toThrow(accessError);
    await expect(seedAgentPreviewFixtures(options)).rejects.toThrow(fixturesError);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("never logs a token while seeding or launching the browser run", async () => {
    const output = [];
    const capture = (...parts) => { output.push(parts.map(String).join(" ")); return true; };
    const spies = [
      ...["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(capture)),
      vi.spyOn(process.stdout, "write").mockImplementation(capture),
      vi.spyOn(process.stderr, "write").mockImplementation(capture),
    ];
    const spawnImpl = vi.fn(() => { const emitter = new EventEmitter(); globalThis.queueMicrotask(() => emitter.emit("close", 1)); return emitter; });
    try {
      await seed(migratedDatabase().executeQuery);
      await expect(main(["--list"], { environment: preview, spawnImpl })).rejects.toThrow("Playwright exited with code 1.");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    const tokens = Object.values(resolvePlaywrightPersonaTokens(preview));
    const [, argv, options] = spawnImpl.mock.calls[0];
    expect(options.env).toMatchObject(resolvePlaywrightPersonaTokens(preview));
    for (const token of tokens) {
      expect(argv.join(" ")).not.toContain(token);
      expect(output.join("\n")).not.toContain(token);
    }
  });

  it.each(["production", "staging"])("blanks inherited persona tokens in %s", async (environmentName) => {
    const spawnImpl = vi.fn(() => { const emitter = new EventEmitter(); globalThis.queueMicrotask(() => emitter.emit("close", 0)); return emitter; });
    const inherited = Object.fromEntries(Object.keys(PERSONA_TOKEN_VARIABLES).map((variable) => [variable, "inherited-token"]));
    await main(["--list"], { environment: { ...inherited, EXPECTED_DEPLOYMENT_ENVIRONMENT: environmentName }, spawnImpl });
    for (const variable of Object.keys(PERSONA_TOKEN_VARIABLES)) {
      expect(spawnImpl.mock.calls[0][2].env[variable]).toBe("");
    }
  });
});
