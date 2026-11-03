import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCommunityService } from "@/lib/community/service";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { loadAccess, loadOwnProfile } from "./community-client";
import { loadJourneyInitial } from "./journey-initial-server";

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

describe("the Community page's journey data", () => {
  it.each(["wanjiru", "otieno", "akinyi"])("matches what the island loads from the API for %s", async (user) => {
    const caller = locals(user);
    const initial = await loadJourneyInitial(new Request(PAGE), caller, runtime.env);
    vi.stubGlobal("fetch", api(caller));
    expect(initial).not.toBeNull();
    expect(initial).toEqual({ access: await loadAccess(), profile: await loadOwnProfile() });
  });

  it("carries the member's own journey and their access", async () => {
    const initial = await loadJourneyInitial(new Request(PAGE), locals("wanjiru"), runtime.env);
    expect(initial?.access).toEqual({ isAdmin: false, isInstitution: false, isMentor: false });
    expect(initial?.profile).toMatchObject({ id: "wanjiru", headline: "Builder", evidenceLoaded: true });
    expect(initial?.profile.claims.map((claim) => claim.title)).toEqual(["Chama savings ledger"]);
  });

  it.each([
    ["nobody is signed in", locals(null), undefined, 401],
    ["a token lacks community:read", locals("wanjiru", { personalAccessToken: { scopes: ["community:write"] } } as never), undefined, 403],
    ["a session request carries an Authorization header", locals("wanjiru"), { Authorization: "Bearer forged" }, 401],
  ])("is null, as the API refuses, when %s", async (_case, caller, headers, status) => {
    for (const path of ["access", "profile", "journey"]) expect((await api(caller, headers)(`/api/community/${path}`)).status).toBe(status);
    expect(await loadJourneyInitial(new Request(PAGE, { headers }), caller, runtime.env)).toBeNull();
  });

  it("is null when one read fails, so the island loads and reports it itself", async () => {
    sql.exec("DROP TABLE communityConfirmation");
    expect((await api(locals("wanjiru"))("/api/community/journey")).status).toBe(500);
    expect(await loadJourneyInitial(new Request(PAGE), locals("wanjiru"), runtime.env)).toBeNull();
  });

  it("goes through the staging QA persona's checks when the request has one", async () => {
    const qa = { runId: "run", userId: "wanjiru", persona: "member", sessionId: "s", expiresAt: 1 };
    runtime.qa.mockResolvedValue(Response.json({ error: "Not available." }, { status: 403 }));
    const caller = locals("wanjiru", { stagingQa: qa } as never);
    expect(await loadJourneyInitial(new Request(PAGE), caller, runtime.env)).toBeNull();
    expect(runtime.qa.mock.calls.map(([request, path, identity]) => [new URL(request.url).pathname, path, identity])).toEqual(
      ["access", "profile", "journey"].map((path) => [`/api/community/${path}`, path, qa]),
    );
    expect((await api(caller)("/api/community/access")).status).toBe(403);
  });
});
