import { readdirSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "@/lib/auth";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { handleSamLogin, resolveSamLogin, SAM_SESSION_MARKER, SamLoginAccessError, type SamLoginWorkerEnv } from "./login";
import { SAM_PERSONA_KEYS, type SamPersona } from "./personas";
import { createSigner, NOW, ORIGIN, PROJECT_ID, SAM_USER_ID, samClaims, type TestSigner } from "./test-tokens";

const SECRET = "test-better-auth-secret-at-least-32-characters";
let signer: TestSigner;
let database: ReturnType<typeof createSqliteD1>["database"];
let env: SamLoginWorkerEnv;

beforeAll(async () => {
  signer = await createSigner();
});

beforeEach(() => {
  const created = createSqliteD1();
  database = created.database;
  const migrations = readdirSync(new URL("../db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted();
  for (const name of migrations) database.exec(readMigration(name));
  env = {
    DB: created.db,
    BETTER_AUTH_SECRET: SECRET,
    DEPLOYMENT_ENVIRONMENT: "staging",
    BETTER_AUTH_URL: ORIGIN,
    SAM_LOGIN_PROJECT_ID: PROJECT_ID,
    SAM_LOGIN_USER_IDS: SAM_USER_ID,
  };
});

interface LoginBody {
  persona: SamPersona;
  userId: string;
  loginId: string;
  expiresAt: string;
  cookies: { name: string; value: string; domain: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: string }[];
}

async function request(body: unknown, { token, method = "POST", url = `${ORIGIN}/api/staging/sam-login`, now = NOW } = {} as {
  token?: string; method?: string; url?: string; now?: number;
}) {
  const bearer = token ?? (await signer.sign());
  return handleSamLogin(env, new Request(url, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  }), { keys: signer.keys, now });
}

async function login(persona: SamPersona, extra: Record<string, unknown> = {}) {
  const response = await request({ persona, ...extra });
  const body = (await response.json()) as LoginBody & { error?: string };
  expect({ status: response.status, error: body.error }).toEqual({ status: 200, error: undefined });
  return body;
}

const rows = (sql: string, ...params: (string | number)[]) => database.prepare(sql).all(...params).map((row) => ({ ...row }));
const roles = (userId: string) => rows(`SELECT r.name FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId WHERE ur.userId = ?`, userId).map((row) => row.name);
const cookieHeader = (body: LoginBody) => body.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

describe("handleSamLogin: signing in", () => {
  it("signs in as a persona with a session Better Auth itself accepts", async () => {
    const body = await login("student");
    expect(body).toMatchObject({ persona: "student", userId: "ttv-sam-persona-student", expiresAt: new Date((NOW + 3600) * 1000).toISOString() });
    expect(body.cookies.map((cookie) => cookie.name)).toEqual(["__Secure-better-auth.session_token", "__Secure-better-auth.dont_remember"]);
    expect(body.cookies.every((cookie) => cookie.httpOnly && cookie.secure && cookie.domain === "staging.tembotechventures.com" && cookie.sameSite === "Lax")).toBe(true);

    const auth = createAuth({ ...env, GITHUB_CLIENT_ID: "x", GITHUB_CLIENT_SECRET: "x" } as Parameters<typeof createAuth>[0]);
    // Better Auth checks expiry against the real clock, so read the session as of now.
    database.prepare(`UPDATE session SET expiresAt = unixepoch() + 3600`).run();
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader(body) }) });
    expect(session?.user.id).toBe("ttv-sam-persona-student");
    expect(session?.session.userAgent).toBe(`${SAM_SESSION_MARKER}${body.loginId}`);
  });

  it("records who signed in, from which SAM task, and spends the token", async () => {
    const body = await login("mentor", { ttlMinutes: 30 });
    expect(rows(`SELECT samProjectId, samUserId, samTaskId, samWorkspaceId, samAgentSessionId, persona, userId, createdAt, expiresAt, revokedAt FROM staging_sam_login`)).toEqual([{
      samProjectId: PROJECT_ID, samUserId: SAM_USER_ID, samTaskId: "task-1", samWorkspaceId: "workspace-1", samAgentSessionId: "agent-session-1",
      persona: "mentor", userId: body.userId, createdAt: NOW, expiresAt: NOW + 1800, revokedAt: null,
    }]);
  });

  it("refuses to reuse a token", async () => {
    const token = await signer.sign(samClaims({ jti: "once" }));
    expect((await request({ persona: "student" }, { token })).status).toBe(200);
    const replay = await request({ persona: "admin" }, { token });
    expect(replay.status).toBe(401);
    expect(rows(`SELECT persona FROM staging_sam_login`)).toEqual([{ persona: "student" }]);
  });

  it.each(SAM_PERSONA_KEYS)("seeds the %s persona as described", async (persona) => {
    const { userId } = await login(persona);
    const user = rows(`SELECT email FROM "user" WHERE id = ?`, userId)[0];
    expect(user?.email).toBe(`${userId}@invalid.ttv`);
    const expected: Record<SamPersona, string[]> = { newcomer: [], applicant: [], student: [], alumna: [], community: [], mentor: ["MENTOR"], institution: ["INSTITUTION"], admin: ["ADMIN"] };
    expect(roles(userId)).toEqual(expected[persona]);
    const stage = rows(`SELECT stage FROM member_onboarding WHERE userId = ?`, userId)[0]?.stage;
    expect(stage).toBe(persona === "newcomer" ? "NEW" : "DONE");
  });

  it("puts cohort personas in fictional cohorts around today", async () => {
    for (const persona of ["applicant", "student", "alumna"] as const) await login(persona);
    expect(rows(`SELECT a.userId, a.status, p.applicationsOpen, p.startDate <= ? AS started, p.endDate < ? AS ended
      FROM programApplication a JOIN program p ON p.id = a.programId ORDER BY a.userId`, NOW, NOW)).toEqual([
      { userId: "ttv-sam-persona-alumna", status: "COMPLETED", applicationsOpen: 0, started: 1, ended: 1 },
      { userId: "ttv-sam-persona-applicant", status: "PENDING", applicationsOpen: 1, started: 0, ended: 0 },
      { userId: "ttv-sam-persona-student", status: "APPROVED", applicationsOpen: 0, started: 1, ended: 0 },
    ]);
    // Each fictional cohort gets its channels from the program trigger, as a real one does.
    expect(rows(`SELECT count(DISTINCT programId) AS n FROM channel WHERE programId LIKE 'ttv-sam-persona-%'`)[0]?.n).toBe(3);
  });

  it("gives a newcomer a fresh account every time", async () => {
    const first = await login("newcomer");
    const second = await login("newcomer");
    expect(first.userId).not.toBe(second.userId);
    expect(first.userId).toMatch(/^ttv-sam-persona-newcomer-[a-f0-9]{24}$/);
  });

  it("restores a persona's roles and cohort status on the next login, keeping what it did", async () => {
    const { userId } = await login("student");
    database.prepare(`UPDATE programApplication SET status = 'REJECTED' WHERE userId = ?`).run(userId);
    database.prepare(`INSERT INTO UserRoles (id, userId, roleId) SELECT 'granted', ?, id FROM Roles WHERE name = 'ADMIN'`).run(userId);
    database.prepare(`UPDATE "user" SET name = 'Renamed in the app' WHERE id = ?`).run(userId);
    await login("student");
    expect(roles(userId)).toEqual([]);
    expect(rows(`SELECT status FROM programApplication WHERE userId = ?`, userId)).toEqual([{ status: "APPROVED" }]);
    expect(rows(`SELECT name FROM "user" WHERE id = ?`, userId)).toEqual([{ name: "Renamed in the app" }]);
  });

  it("never seeds or signs in as an account it does not own", async () => {
    database.prepare(`INSERT INTO "user" (id, name, email) VALUES ('ttv-sam-persona-admin', 'Real person', 'real@example.com')`).run();
    const response = await request({ persona: "admin" });
    expect(response.status).toBe(409);
    expect(roles("ttv-sam-persona-admin")).toEqual([]);
    expect(rows(`SELECT count(*) AS n FROM session`)[0]?.n).toBe(0);
  });

  it("limits each SAM user to 60 logins an hour", async () => {
    const insert = database.prepare(`INSERT INTO staging_sam_login (id, jti, samProjectId, samUserId, samSubject, persona, userId, sessionId, createdAt, expiresAt)
      VALUES (?, ?, ?, ?, 's', 'student', 'u', ?, ?, ?)`);
    for (let index = 0; index < 60; index++) insert.run(`l${index}`, `j${index}`, PROJECT_ID, SAM_USER_ID, `s${index}`, NOW - 60, NOW + 60);
    expect((await request({ persona: "student" })).status).toBe(429);
  });
});

describe("handleSamLogin: refusals", () => {
  it.each([
    ["production", { DEPLOYMENT_ENVIRONMENT: "production" }],
    ["staging without users configured", { SAM_LOGIN_USER_IDS: undefined }],
  ])("is not found on %s", async (_, overrides) => {
    env = { ...env, ...overrides };
    expect((await request({ persona: "admin" })).status).toBe(404);
  });

  it("is not found on any other host", async () => {
    expect((await request({ persona: "admin" }, { url: "https://ttv-website-staging.workers.dev/api/staging/sam-login" })).status).toBe(404);
  });

  it("is not found for other methods", async () => {
    expect((await request(undefined, { method: "GET" })).status).toBe(404);
  });

  it("needs a SAM token", async () => {
    const response = await handleSamLogin(env, new Request(`${ORIGIN}/api/staging/sam-login`, { method: "POST", body: "{}" }), { keys: signer.keys, now: NOW });
    expect(response.status).toBe(401);
  });

  it.each([
    ["a token for production", { aud: "https://tembotechventures.com" }, 401],
    ["an expired token", { iat: NOW - 600, exp: NOW - 300 }, 401],
    ["another SAM user", { user_id: "someone-else", sub: `project:${PROJECT_ID}:user:someone-else:profile:p` }, 403],
    ["another SAM project", { project_id: "another-project", sub: `project:another-project:user:${SAM_USER_ID}:profile:p` }, 403],
  ])("refuses %s", async (_, overrides, status) => {
    const response = await request({ persona: "admin" }, { token: await signer.sign(samClaims(overrides)) });
    expect(response.status).toBe(status);
    expect(rows(`SELECT count(*) AS n FROM "user"`)[0]?.n).toBe(0);
  });

  it.each([
    ["an unknown persona", { persona: "root" }],
    ["a real user's id", { persona: "ttv-staging-demo-v1-mentor" }],
    ["an extra field", { persona: "admin", userId: "someone" }],
    ["a long session", { persona: "admin", ttlMinutes: 600 }],
    ["a fractional session", { persona: "admin", ttlMinutes: 7.5 }],
  ])("refuses %s", async (_, body) => {
    expect((await request(body)).status).toBe(400);
  });
});

describe("handleSamLogin: revoking", () => {
  it("ends every live login of the SAM user and deletes their sessions", async () => {
    await login("student");
    await login("admin");
    const response = await request(undefined, { method: "DELETE" });
    expect(await response.json()).toEqual({ revoked: 2 });
    expect(rows(`SELECT count(*) AS n FROM staging_sam_login WHERE revokedAt = ?`, NOW)[0]?.n).toBe(2);
    expect(rows(`SELECT count(*) AS n FROM session`)[0]?.n).toBe(0);
  });
});

describe("resolveSamLogin", () => {
  async function signedIn(persona: SamPersona = "admin") {
    const body = await login(persona);
    const session = rows(`SELECT id, userAgent FROM session WHERE userId = ?`, body.userId)[0] as { id: string; userAgent: string };
    return { body, user: { id: body.userId, email: `${body.userId}@invalid.ttv` }, session };
  }
  const resolve = (input: Awaited<ReturnType<typeof signedIn>>, overrides: Partial<Parameters<typeof resolveSamLogin>[0]> = {}) =>
    resolveSamLogin({ env, user: input.user, session: input.session, viaPersonalAccessToken: false, now: NOW + 60, ...overrides });

  it("leaves every other account alone, without reading the database", async () => {
    const throwing = { ...env, DB: undefined as unknown as D1Database };
    expect(await resolveSamLogin({ env: throwing, user: { id: "real-user", email: "r@example.com" }, session: { id: "s", userAgent: "Mozilla/5.0" }, viaPersonalAccessToken: false })).toBeNull();
  });

  it("accepts a persona session while its login is live", async () => {
    const input = await signedIn();
    expect(await resolve(input)).toMatchObject({ loginId: input.body.loginId, persona: "admin", samUserId: SAM_USER_ID, samTaskId: "task-1", expiresAt: NOW + 3600 });
  });

  it.each([
    ["after the login expires", (input: Awaited<ReturnType<typeof signedIn>>) => resolve(input, { now: NOW + 3600 })],
    ["after a revoke", async (input: Awaited<ReturnType<typeof signedIn>>) => {
      database.prepare(`UPDATE staging_sam_login SET revokedAt = ?`).run(NOW);
      return resolve(input);
    }],
    ["through a personal access token", (input: Awaited<ReturnType<typeof signedIn>>) => resolve(input, { viaPersonalAccessToken: true })],
    ["once SAM login is switched off", (input: Awaited<ReturnType<typeof signedIn>>) => resolve(input, { env: { ...env, SAM_LOGIN_USER_IDS: undefined } })],
    ["once the SAM user is no longer allowed", (input: Awaited<ReturnType<typeof signedIn>>) => resolve(input, { env: { ...env, SAM_LOGIN_USER_IDS: "someone-else" } })],
    ["in production", (input: Awaited<ReturnType<typeof signedIn>>) => resolve(input, { env: { ...env, DEPLOYMENT_ENVIRONMENT: "production" } })],
    ["for any other session of the persona", (input: Awaited<ReturnType<typeof signedIn>>) => {
      database.prepare(`INSERT INTO session (id, expiresAt, token, userAgent, userId) VALUES ('other', ?, 'other-token', 'Mozilla/5.0', ?)`).run(NOW + 9999, input.user.id);
      return resolve(input, { session: { id: "other", userAgent: "Mozilla/5.0" } });
    }],
    ["for a real account whose browser claims the SAM marker", (input: Awaited<ReturnType<typeof signedIn>>) =>
      resolve(input, { user: { id: "real-user", email: "real@example.com" }, session: { id: "real-session", userAgent: `${SAM_SESSION_MARKER}${input.body.loginId}` } })],
  ])("refuses a persona session %s", async (_, attempt) => {
    await expect(attempt(await signedIn())).rejects.toBeInstanceOf(SamLoginAccessError);
  });
});
