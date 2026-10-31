import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, MINIMAL_AUTH_SCHEMA, readMigration } from "@/test/sqlite-d1";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  getSession: vi.fn(),
  authenticatePersonalAccessToken: vi.fn(),
  recordErrorInBackground: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("@/lib/auth", () => ({ createAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/lib/personal-access-tokens", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/personal-access-tokens")>(),
  authenticatePersonalAccessToken: mocks.authenticatePersonalAccessToken,
}));
vi.mock("@/lib/observability/errors", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/observability/errors")>(),
  recordErrorInBackground: mocks.recordErrorInBackground,
}));

import { onRequest } from "@/middleware";
import { GET } from "@/pages/api/admin/platform-flags/index";
import { PUT } from "@/pages/api/admin/platform-flags/[key]";
import { FlagsAdmin, Flag } from "./flag-contracts";

const ORIGIN = "https://example.test";
const PATH = "/api/admin/platform-flags";
const user = { id: "amina", name: "Amina Hassan", email: "amina@example.test" };
const auth = { user, session: { id: "browser-session", userId: user.id, userAgent: "browser" } };
let setup: ReturnType<typeof createSqliteD1>;

beforeEach(() => {
  vi.clearAllMocks();
  setup = createSqliteD1();
  setup.database.exec(MINIMAL_AUTH_SCHEMA);
  setup.database.exec(readMigration("0021_feature_flags.sql"));
  setup.database.exec(`
    INSERT INTO user(id,name,email) VALUES ('amina','Amina Hassan','amina@example.test');
    INSERT INTO Roles(id,name) VALUES ('admin','ADMIN');
    INSERT INTO UserRoles(id,userId,roleId) VALUES ('role','amina','admin');
  `);
  Object.assign(mocks.env, { DB: setup.db, DEPLOYMENT_ENVIRONMENT: "production" });
  mocks.getSession.mockResolvedValue(auth);
  mocks.authenticatePersonalAccessToken.mockResolvedValue(null);
});
afterEach(() => { setup.database.close(); vi.restoreAllMocks(); });

async function request({
  method = "GET", key = "spaces", body = '{"audience":"STAFF"}', origin = ORIGIN, scopes, cookie,
}: { method?: "GET" | "PUT"; key?: string; body?: string; origin?: string | null; scopes?: string[]; cookie?: string } = {}) {
  const url = new URL(method === "GET" ? PATH : `${PATH}/${key}`, ORIGIN);
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  if (origin !== null) headers.set("Origin", origin);
  if (scopes) {
    headers.set("Authorization", `Bearer ttv_pat_${"1".repeat(64)}`);
    mocks.authenticatePersonalAccessToken.mockResolvedValue({ ...auth, token: { id: "pat", scopes } });
  }
  const ctx = {
    url, params: { key },
    request: new Request(url, { method, headers, ...(method === "PUT" ? { body } : {}) }),
    locals: {},
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  } as unknown as Parameters<typeof GET>[0];
  const next = vi.fn(async () => method === "GET" ? GET(ctx) : PUT(ctx));
  const response = await onRequest(ctx, next);
  if (!(response instanceof Response)) throw new Error("Expected a response");
  return { response, next };
}

describe("platform flags admin API through real middleware guards", () => {
  it.each(["GET", "PUT"] as const)("forbids signed-out and non-admin %s requests", async method => {
    mocks.getSession.mockResolvedValue(null);
    const anonymous = await request({ method });
    expect(anonymous.response.status).toBe(403);
    expect(anonymous.next).not.toHaveBeenCalled();
    expect(await anonymous.response.json()).toMatchObject({ error: { code: "forbidden" } });
    mocks.getSession.mockResolvedValue(auth);
    setup.database.exec("DELETE FROM UserRoles");
    const member = await request({ method });
    expect(member.response.status).toBe(403);
    expect(member.next).not.toHaveBeenCalled();
    expect(setup.database.prepare("SELECT DISTINCT audience FROM feature_flag").all()).toEqual([{ audience: "OFF" }]);
  });

  it.each([
    { method: "GET", scopes: ["admin:read"], status: 200 },
    { method: "PUT", scopes: ["admin:read"], status: 403 },
    { method: "PUT", scopes: ["admin:read", "admin:write"], status: 200 },
    { method: "GET", scopes: ["admin:write"], status: 403 },
    { method: "PUT", scopes: ["admin:write"], status: 403 },
    { method: "GET", scopes: ["community:read"], status: 403 },
    { method: "PUT", scopes: ["community:read", "community:write"], status: 403 },
  ] as const)("enforces PAT $scopes on $method", async ({ method, scopes, status }) => {
    const { response } = await request({ method, scopes: [...scopes], origin: null });
    expect(response.status).toBe(status);
    if (status === 403) expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(setup.database.prepare("SELECT audience,updatedBy FROM feature_flag WHERE key='spaces'").get()).toEqual(
      method === "PUT" && status === 200 ? { audience: "STAFF", updatedBy: "amina" } : { audience: "OFF", updatedBy: null }
    );
  });

  it("does not grant ADMIN just because a PAT has admin scopes", async () => {
    setup.database.exec("DELETE FROM UserRoles");
    const { response, next } = await request({ method: "PUT", scopes: ["admin:read", "admin:write"], origin: null });
    expect(response.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([null, "https://evil.test", "null"])("rejects browser writes with origin %s", async origin => {
    const { response, next } = await request({ method: "PUT", origin });
    expect(response.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  it("also rejects a cross-origin PAT write", async () => {
    const { response, next } = await request({ method: "PUT", origin: "https://evil.test", scopes: ["admin:read", "admin:write"] });
    expect(response.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("uses the same denial envelope for expired synthetic QA sessions", async () => {
    const { response, next } = await request({ cookie: "__Host-ttv-retained-qa=expired" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(next).not.toHaveBeenCalled();
  });

  it("lists raw audiences while OFF, even when the preview override is active", async () => {
    Object.assign(mocks.env, { DEPLOYMENT_ENVIRONMENT: "agent-pr-235", PLATFORM_FLAGS_OVERRIDE: "all" });
    // Synthetic identity boundaries are irrelevant for this normal browser session.
    const queries = vi.spyOn(setup.db, "prepare");
    const { response } = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const data = FlagsAdmin.parse(await response.json());
    expect(data.flags).toHaveLength(4);
    expect(data.flags.every(flag => flag.audience === "OFF" && flag.updatedBy === null)).toBe(true);
    expect(data.flags.every(flag => flag.updatedAt > 1_700_000_000_000)).toBe(true);
    expect(queries.mock.calls.filter(([sql]) => sql.startsWith("SELECT key"))).toHaveLength(1);
  });

  it.each(["OFF", "STAFF", "ALL"])("updates %s, records the actor and returns epoch milliseconds", async audience => {
    setup.database.exec("UPDATE feature_flag SET updatedAt=1");
    const { response } = await request({ method: "PUT", body: JSON.stringify({ audience }) });
    expect(response.status).toBe(200);
    const flag = Flag.parse(await response.json());
    expect(flag).toMatchObject({ key: "spaces", audience, updatedBy: "amina" });
    const row = setup.database.prepare("SELECT * FROM feature_flag WHERE key='spaces'").get();
    expect(row).toEqual({ ...flag, updatedAt: flag.updatedAt / 1_000 });
    expect(flag.updatedAt).toBeGreaterThan(1_700_000_000_000);
    expect(setup.database.prepare("SELECT audience,updatedBy FROM feature_flag WHERE key='channels'").get()).toEqual({ audience: "OFF", updatedBy: null });
  });

  it("preserves existing auth IDs that are not CUID2 in the audit field", async () => {
    const actorId = "preview-admin-legacy-ID";
    setup.database.prepare("INSERT INTO user(id,name,email) VALUES (?,'Amina Hassan','legacy@example.test')").run(actorId);
    setup.database.prepare("INSERT INTO UserRoles(id,userId,roleId) VALUES ('legacy-role',?,'admin')").run(actorId);
    mocks.getSession.mockResolvedValue({ ...auth, user: { ...user, id: actorId } });
    const { response } = await request({ method: "PUT" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updatedBy: actorId });
    const listed = await request();
    expect(listed.response.status).toBe(200);
    expect(FlagsAdmin.parse(await listed.response.json()).flags.find(flag => flag.key === "spaces")?.updatedBy).toBe(actorId);
  });

  it.each(["", "{", "null", "[]", "{}", '{"audience":"PUBLIC"}', '{"audience":"all"}', '{"audience":null}', '{"audience":"ALL","updatedBy":"someone-else"}'])(
    "rejects invalid JSON/body %s without changing data", async body => {
      const { response } = await request({ method: "PUT", body });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "validation" } });
      expect(setup.database.prepare("SELECT DISTINCT audience FROM feature_flag").all()).toEqual([{ audience: "OFF" }]);
    }
  );

  it("bounds the streamed body and rejects unknown flag keys", async () => {
    expect((await request({ method: "PUT", body: JSON.stringify({ audience: "x".repeat(2_000) }) })).response.status).toBe(413);
    const unknown = await request({ method: "PUT", key: "not_a_flag" });
    expect(unknown.response.status).toBe(400);
    expect(await unknown.response.json()).toMatchObject({ error: { code: "validation" } });
  });

  it("returns 404 if a known flag row is missing", async () => {
    setup.database.exec("DELETE FROM feature_flag WHERE key='spaces'");
    const { response } = await request({ method: "PUT" });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
    const list = await request();
    expect(list.response.status).toBe(500);
    expect(await list.response.json()).toMatchObject({ error: { code: "server" } });
  });

  it.each(["GET", "PUT"] as const)("returns a safe server envelope on %s DB failure", async method => {
    setup.database.exec("DROP TABLE feature_flag");
    const { response } = await request({ method });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "server" } });
    expect(JSON.stringify(body)).not.toContain("no such table");
    expect(mocks.recordErrorInBackground).toHaveBeenCalledOnce();
  });

  it("keeps route-level denial if called without trusted middleware locals", async () => {
    const ctx = { locals: { user, isAdmin: false } } as unknown as Parameters<typeof GET>[0];
    expect((await GET(ctx)).status).toBe(403);
    expect((await PUT(ctx)).status).toBe(403);
  });
});
