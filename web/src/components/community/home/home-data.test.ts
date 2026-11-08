import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCommunityService } from "@/lib/community/service";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { loadOwnProfile } from "../community-client";
import { loadCommunityHome, sendCommunityWrite } from "./home-data";

const runtime = vi.hoisted(() => ({ env: {} as Env, qa: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: runtime.env }));
vi.mock("@/lib/community/staging-persona-qa", () => ({ handleQaCommunityRequest: runtime.qa }));
const { ALL } = await import("@/pages/api/community/[...path]");

const ORIGIN = "https://tembotechventures.com";
const PAGE = `${ORIGIN}/dashboard/community`;

function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, image TEXT);
    CREATE TABLE Roles (id TEXT PRIMARY KEY, name TEXT UNIQUE, createdAt INTEGER DEFAULT (unixepoch()), updatedAt INTEGER DEFAULT (unixepoch()));
    CREATE TABLE UserRoles (id TEXT PRIMARY KEY, userId TEXT, roleId TEXT, UNIQUE(userId, roleId));
    INSERT INTO user VALUES ('wanjiru', 'Wanjiru Kamau', null), ('otieno', 'Otieno Ouma', null), ('akinyi', 'Akinyi Njeri', null);`);
  for (const name of ["0017_community_discovery.sql", "0018_confirmation_role_snapshot.sql", "0021_feature_flags.sql", "0025_onboarding.sql", "0027_mentor_set_aside.sql"]) sql.exec(readMigration(name));
  for (const [user, role] of [["otieno", "MENTOR"], ["akinyi", "INSTITUTION"]]) sql.prepare("INSERT INTO UserRoles VALUES (?, ?, (SELECT id FROM Roles WHERE name = ?))").run(user, user, role);
  return { sql, db: createSqliteD1(sql).db };
}

function locals(userId: string | null, extra: Partial<App.Locals> = {}) {
  return {
    user: userId ? { id: userId } : null,
    session: userId ? { userAgent: "Mozilla/5.0" } : null,
    personalAccessToken: null,
    stagingDemo: null,
    stagingFixture: null,
    stagingQa: null,
    ...extra,
  } as unknown as App.Locals;
}

/** The API route itself, as the island's fetch reaches it. */
function api(callerLocals: App.Locals, headers?: HeadersInit) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(new URL(String(input), ORIGIN), { ...init, headers: headers ?? init?.headers });
    const path = new URL(request.url).pathname.replace("/api/community/", "");
    return ALL({ request, params: { path }, locals: callerLocals } as never) as Promise<Response>;
  };
}

let sql: DatabaseSync;
beforeEach(async () => {
  const fixture = database();
  sql = fixture.sql;
  runtime.env.DB = fixture.db;
  const member = createCommunityService(fixture.db, "wanjiru");
  await member.updateOwnProfile({ headline: "Builder", bio: "Builds M-Pesa reconciliation tools", skills: ["TypeScript"], opportunityGoals: "First developer role" });
  await member.createJourney({ title: "Chama savings ledger", description: "Built and tested a fictional ledger", evidenceUrl: "https://github.com/example/ledger", occurredAt: "2026-10-24", visibility: "institution" });
});
afterEach(() => {
  sql.close();
  vi.unstubAllGlobals();
  runtime.qa.mockReset();
});

describe("the Community page's own data", () => {
  it.each(["wanjiru", "otieno", "akinyi"])("matches what the API gives the browser for %s", async (user) => {
    const caller = locals(user);
    const home = await loadCommunityHome(new Request(PAGE), caller, runtime.env);
    vi.stubGlobal("fetch", api(caller));
    expect(home).not.toBeNull();
    expect(home).toEqual(await loadOwnProfile());
  });

  it("carries the member's own profile, photo and journey", async () => {
    sql.exec("UPDATE user SET image = 'https://avatars.example.test/wanjiru.png' WHERE id = 'wanjiru'");
    const home = await loadCommunityHome(new Request(PAGE), locals("wanjiru"), runtime.env);
    expect(home).toMatchObject({ id: "wanjiru", name: "Wanjiru Kamau", image: "https://avatars.example.test/wanjiru.png", headline: "Builder", evidenceLoaded: true });
    expect(home?.claims.map((claim) => claim.title)).toEqual(["Chama savings ledger"]);
  });

  it.each([
    ["nobody is signed in", locals(null), undefined, 401],
    ["a token lacks community:read", locals("wanjiru", { personalAccessToken: { scopes: ["community:write"] } } as never), undefined, 403],
    ["a session request carries an Authorization header", locals("wanjiru"), { Authorization: "Bearer forged" }, 401],
  ])("is null, as the API refuses, when %s", async (_case, caller, headers, status) => {
    for (const path of ["profile", "journey"]) expect((await api(caller, headers)(`/api/community/${path}`)).status).toBe(status);
    expect(await loadCommunityHome(new Request(PAGE, { headers }), caller, runtime.env)).toBeNull();
  });

  it("is null when one read fails, so the page says it couldn't load them", async () => {
    sql.exec("DROP TABLE communityConfirmation");
    expect((await api(locals("wanjiru"))("/api/community/journey")).status).toBe(500);
    expect(await loadCommunityHome(new Request(PAGE), locals("wanjiru"), runtime.env)).toBeNull();
  });

  it("goes through the staging QA persona's checks when the request has one", async () => {
    const qa = { runId: "run", userId: "wanjiru", persona: "member", sessionId: "s", expiresAt: 1 };
    runtime.qa.mockResolvedValue(Response.json({ error: "Not available." }, { status: 403 }));
    const caller = locals("wanjiru", { stagingQa: qa } as never);
    expect(await loadCommunityHome(new Request(PAGE), caller, runtime.env)).toBeNull();
    expect(runtime.qa.mock.calls.map(([request, path, identity]) => [new URL(request.url).pathname, path, identity])).toEqual(
      ["profile", "journey"].map((path) => [`/api/community/${path}`, path, qa]),
    );
  });
});

describe("a Community form's save", () => {
  const post = (headers: HeadersInit = { Origin: ORIGIN }) => new Request(PAGE, { method: "POST", headers });

  it("goes through the API's own handler as the browser's same-origin call", async () => {
    const response = await sendCommunityWrite(post({ Origin: ORIGIN, Cookie: "session=1" }), locals("wanjiru"), runtime.env, {
      path: "journey", method: "POST",
      body: { title: "Matatu fare splitter", description: "Wrote the fare-splitting logic and its tests.", evidenceUrl: null, occurredAt: "2026-10-30", visibility: "institution" },
    });
    expect(response.status).toBe(201);
    const home = await loadCommunityHome(new Request(PAGE), locals("wanjiru"), runtime.env);
    expect(home?.claims.map((claim) => claim.title)).toEqual(expect.arrayContaining(["Matatu fare splitter", "Chama savings ledger"]));
  });

  it("is refused, as the API refuses, without the page's own origin", async () => {
    for (const headers of [{}, { Origin: "https://elsewhere.example" }]) {
      const response = await sendCommunityWrite(post(headers), locals("wanjiru"), runtime.env, { path: "profile", method: "PUT", body: { headline: "Changed", bio: "", skills: [], opportunityGoals: "" } });
      expect(response.status).toBe(403);
    }
    expect((await loadCommunityHome(new Request(PAGE), locals("wanjiru"), runtime.env))?.headline).toBe("Builder");
  });

  it("keeps a token's scope: a read-only token cannot save", async () => {
    const caller = locals("wanjiru", { personalAccessToken: { scopes: ["community:read"] } } as never);
    const response = await sendCommunityWrite(post(), caller, runtime.env, { path: "profile", method: "PUT", body: { headline: "Changed", bio: "", skills: [], opportunityGoals: "" } });
    expect(response.status).toBe(403);
  });
});
