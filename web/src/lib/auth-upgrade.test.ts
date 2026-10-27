import { readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "./auth";
import { createSqliteD1, readMigration } from "../test/sqlite-d1";

const origin = "http://localhost:4321";
const databases: ReturnType<typeof createSqliteD1>[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const { database } of databases.splice(0)) database.close();
});

function fixture(agentAuth = true) {
  const sqlite = createSqliteD1();
  databases.push(sqlite);
  // Seed the existing identity at the original 1.6 schema, then apply every
  // subsequent real migration. 1.7.3+ keeps this identity unchanged: no issuer.
  sqlite.database.exec(readMigration("0000_greedy_carnage.sql"));
  sqlite.database.exec(`
    INSERT INTO user(id,name,email) VALUES ('existing-user','Fictional Amina','amina@example.test');
    INSERT INTO account(id,providerId,accountId,userId,accessToken)
      VALUES ('existing-account','github','12345','existing-user','old-token');
  `);
  const directory = new URL("./db/migrations/", import.meta.url);
  for (const migration of readdirSync(directory).filter(name => name.endsWith(".sql") && !name.startsWith("0000")).toSorted()) {
    sqlite.database.exec(readMigration(migration));
  }
  const auth = createAuth({
    DB: sqlite.db,
    BETTER_AUTH_SECRET: "fictional-test-secret-at-least-thirty-two-characters",
    BETTER_AUTH_URL: origin,
    GITHUB_CLIENT_ID: "fictional-client",
    GITHUB_CLIENT_SECRET: "fictional-secret",
    AGENT_AUTH_ENABLED: String(agentAuth),
    STAGING_DEMO_ENABLED: "false",
    DEPLOYMENT_ENVIRONMENT: agentAuth ? "staging" : "production",
  });
  return { ...sqlite, auth };
}

function cookies(response: Response) {
  return response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
}

function githubProfile(id: number, email: string) {
  // Mock only GitHub's HTTP boundary; exercise the actual built-in provider,
  // OAuth state validation, callback, Drizzle adapter and TTV configuration.
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://github.com/login/oauth/access_token") {
      return Response.json({ access_token: "fictional-github-token", token_type: "bearer", scope: "read:user,user:email" });
    }
    if (url === "https://api.github.com/user") return Response.json({ id, login: "fictional-amina", name: "Fictional Amina", email, avatar_url: null });
    if (url === "https://api.github.com/user/emails") return Response.json([{ email, primary: true, verified: true }]);
    throw new Error(`Unexpected outbound request: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

async function login(auth: ReturnType<typeof createAuth>, corruptState = false) {
  const start = await auth.handler(new Request(`${origin}/api/auth/sign-in/social`, {
    method: "POST", headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ provider: "github", callbackURL: `${origin}/dashboard` }),
  }));
  expect(start.status).toBe(200);
  const { url } = await start.json() as { url: string };
  const authorization = new URL(url);
  expect(authorization.origin).toBe("https://github.com");
  expect(authorization.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback/github`);
  const state = corruptState ? "invalid-state" : authorization.searchParams.get("state")!;
  return auth.handler(new Request(`${origin}/api/auth/callback/github?code=fictional-code&state=${encodeURIComponent(state)}`, {
    headers: { cookie: cookies(start) },
  }));
}

describe("Better Auth 1.7 on the migrated D1 schema", () => {
  it("signs an existing GitHub account in repeatedly without duplicating or changing its owner", async () => {
    const { auth, database } = fixture();
    githubProfile(12345, "changed-email@example.test");
    const before = database.prepare("SELECT * FROM account").get();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await login(auth);
      expect(response.headers.get("location")).toBe(`${origin}/dashboard`);
      const session = await auth.api.getSession({ headers: new Headers({ cookie: cookies(response) }) });
      expect(session?.user.id).toBe("existing-user");
    }
    expect(database.prepare("SELECT count(*) AS count FROM user").get()).toMatchObject({ count: 1 });
    expect(database.prepare("SELECT * FROM account").all()).toEqual([expect.objectContaining({
      ...before, accessToken: "fictional-github-token", updatedAt: expect.any(Number),
    })]);
    expect(database.prepare("PRAGMA table_info(account)").all().map(column => column.name)).not.toContain("issuer");
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("creates a new GitHub user, serves a cached cookie session and signs out", async () => {
    const { auth, database } = fixture();
    githubProfile(67890, "new@example.test");
    const response = await login(auth);
    expect(response.headers.get("location")).toBe(`${origin}/dashboard`);
    const headers = new Headers({ cookie: cookies(response), origin });
    const session = await auth.api.getSession({ headers });
    expect(session?.user.email).toBe("new@example.test");
    expect(database.prepare("SELECT userId FROM account WHERE accountId='67890' AND providerId='github'").get()).toMatchObject({ userId: session?.user.id });
    expect(database.prepare("SELECT count(*) AS count FROM user").get()).toMatchObject({ count: 2 });
    expect(cookies(response)).toContain("session_data=");
    const cacheOnly = cookies(response).split("; ").filter(cookie => !cookie.startsWith("better-auth.session_token=")).join("; ");
    expect(await auth.api.getSession({ headers: new Headers({ cookie: cacheOnly }) })).toBeNull();
    expect((await auth.api.signOut({ headers, asResponse: true })).ok).toBe(true);
    expect(database.prepare("SELECT id FROM session WHERE id=?").get(session!.session.id)).toBeUndefined();
    expect(await auth.api.getSession({ headers, query: { disableCookieCache: true } })).toBeNull();
  });

  it("rejects invalid OAuth state before exchanging tokens or creating users", async () => {
    const { auth, database } = fixture();
    const fetch = githubProfile(67890, "new@example.test");
    const response = await login(auth, true);
    expect(response.headers.get("location")).toContain("error=");
    expect(fetch).not.toHaveBeenCalled();
    expect(database.prepare("SELECT count(*) AS count FROM user").get()).toMatchObject({ count: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM session").get()).toMatchObject({ count: 0 });
  });

  it("fails closed on duplicate provider identities without choosing an owner", async () => {
    const { auth, database } = fixture();
    database.exec(`
      INSERT INTO user(id,name,email) VALUES ('other-user','Fictional Kamau','kamau@example.test');
      INSERT INTO account(id,providerId,accountId,userId) VALUES ('duplicate','github','12345','other-user');
    `);
    const context = await auth.$context;
    await expect(context.internalAdapter.findAccountOwnerByKey({ providerId: "github", accountId: "12345" })).rejects.toThrow(/Multiple accounts/);
    expect(database.prepare("SELECT count(*) AS count FROM session").get()).toMatchObject({ count: 0 });
  });

  it("keeps the original synthetic deadline during a real D1 session refresh", async () => {
    const { auth, database } = fixture();
    const now = Math.floor(Date.now() / 1000);
    const deadline = now + 1800;
    database.exec(`INSERT INTO user(id,name,email) VALUES ('ttv-agent-preview-user','Fictional Preview','preview@example.test')`);
    database.prepare(`INSERT INTO session(id,token,userId,userAgent,createdAt,updatedAt,expiresAt) VALUES (?,?,?,?,?,?,?)`).run(
      "ttv-agent-preview-session", "fictional-synthetic-token", "ttv-agent-preview-user", "ttv-agent:isolated-preview", now - 7200, now - 7200, deadline,
    );
    const headers = new Headers({ authorization: "Bearer fictional-synthetic-token" });
    const session = await auth.api.getSession({ headers });
    expect(session?.session.expiresAt.getTime()).toBe(deadline * 1000);
    expect(database.prepare("SELECT expiresAt FROM session WHERE token=?").get("fictional-synthetic-token")).toMatchObject({ expiresAt: deadline });
    database.prepare("UPDATE session SET expiresAt=? WHERE token=?").run(now - 1, "fictional-synthetic-token");
    expect(await auth.api.getSession({ headers })).toBeNull();
  });

  it.each([true, false])("gates bearer authentication on the agent flag (%s)", async enabled => {
    const { auth, database } = fixture(enabled);
    database.prepare("INSERT INTO session(id,token,userId,expiresAt) VALUES (?,?,?,?)").run(
      "test-session", "fictional-bearer-token", "existing-user", Math.floor(Date.now() / 1000) + 3600,
    );
    const headers = new Headers({ authorization: "Bearer fictional-bearer-token" });
    const session = await auth.api.getSession({ headers });
    if (enabled) {
      expect(session?.user.id).toBe("existing-user");
      database.exec("DELETE FROM session WHERE id='test-session'");
      expect(await auth.api.getSession({ headers })).toBeNull();
    } else expect(session).toBeNull();
  });
});
