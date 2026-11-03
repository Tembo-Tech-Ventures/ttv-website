/**
 * PERF-2 through the real middleware: a GET's admin guard, STAFF flag audience and /me share one
 * capability read; other methods read the ADMIN role fresh; nothing is shared across requests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMigration } from "@/test/sqlite-d1";
import { createCapabilityDatabase } from "@/lib/platform/server/capabilities.test-support";
import { ErrorEnvelope, Me, ROUTES } from "@/lib/platform/contracts";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  getSession: vi.fn(),
  authenticatePersonalAccessToken: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("@/lib/auth", () => ({ createAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/lib/personal-access-tokens", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/personal-access-tokens")>(),
  authenticatePersonalAccessToken: mocks.authenticatePersonalAccessToken,
}));
import { onRequest } from "@/middleware";
import { GET as getMe } from "@/pages/api/platform/me";
import { GET as listFlags } from "@/pages/api/admin/platform-flags/index";
import { PUT as putFlag } from "@/pages/api/admin/platform-flags/[key]";

const ADMIN_ROLE_QUERY = /SELECT ur\.id FROM "UserRoles" ur/;
const CAPABILITY_QUERY = /from "programRole"/;
let fixture: ReturnType<typeof createCapabilityDatabase>;
let sql: string[];

const person = (id: string, name: string) => ({ id, name, email: `${id}@example.test`, image: null });
const WANJIKU = person("synthetic-wanjiku", "Wanjiku Njeri");
const OTIENO = person("synthetic-otieno", "Otieno Ouma");

beforeEach(() => {
  vi.clearAllMocks();
  fixture = createCapabilityDatabase({ globalRoles: ["ADMIN"], applications: [{ programId: "cohort-a", status: "APPROVED" }] });
  for (const migration of ["0002_married_microbe.sql", "0003_absurd_argent.sql", "0017_community_discovery.sql", "0021_feature_flags.sql", "0023_attention_items.sql", "0025_onboarding.sql", "0028_channels.sql", "0032_moderation_pipeline.sql", "0036_mentor_requests.sql", "0037_mentor_request_checks.sql"]) {
    fixture.database.exec(readMigration(migration));
  }
  fixture.database.exec("UPDATE feature_flag SET audience='STAFF' WHERE key='spaces'");
  const db = fixture.db.$client;
  sql = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (query: string) => { sql.push(query); return prepare(query); };
  Object.assign(mocks.env, { DB: db, DEPLOYMENT_ENVIRONMENT: "production" });
  // Each request names its caller in a test header, so concurrent requests can be different people.
  mocks.getSession.mockImplementation(async ({ headers }: { headers: Headers }) => {
    const user = headers.get("x-test-user") === OTIENO.id ? OTIENO : WANJIKU;
    return { user, session: { id: `${user.id}-session`, userId: user.id, userAgent: "browser" } };
  });
  mocks.authenticatePersonalAccessToken.mockResolvedValue(null);
});
afterEach(() => { fixture.database.close(); vi.restoreAllMocks(); });

type Handler = (context: never) => Response | Promise<Response>;
async function request(method: string, path: string, handler: Handler, { user = WANJIKU.id, scopes, body }: { user?: string; scopes?: string[]; body?: string } = {}) {
  const url = new URL(path, "https://example.test");
  const headers = new Headers({ "x-test-user": user, Origin: url.origin, "Content-Type": "application/json" });
  if (scopes) {
    headers.set("Authorization", `Bearer ttv_pat_${"1".repeat(64)}`);
    const session = await mocks.getSession({ headers });
    mocks.authenticatePersonalAccessToken.mockResolvedValue({ ...session, token: { id: "synthetic-pat", scopes } });
  }
  const context = {
    url, request: new Request(url, { method, headers, body }), locals: {}, params: { key: "channels" },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () => handler(context as never));
  if (!(response instanceof Response)) throw new Error("Expected a response");
  return response;
}

describe("a GET shares one capability read", () => {
  it("between the admin guard and the admin API", async () => {
    const response = await request("GET", "/api/admin/platform-flags", listFlags as Handler);
    expect(response.status).toBe(200);
    expect(sql.filter((query) => CAPABILITY_QUERY.test(query))).toHaveLength(1);
    expect(sql.some((query) => ADMIN_ROLE_QUERY.test(query))).toBe(false);
  });

  it("between the STAFF audience and /me, with the same answer as before", async () => {
    const response = await request("GET", ROUTES.getMe.path, getMe as Handler);
    expect(response.status).toBe(200);
    const me = Me.parse(await response.json());
    expect([me.flags.spaces, me.capabilities.isAdmin, me.capabilities.cohortIds]).toEqual([true, true, ["cohort-a"]]);
    expect(sql.filter((query) => CAPABILITY_QUERY.test(query))).toHaveLength(1);
    expect(sql.some((query) => ADMIN_ROLE_QUERY.test(query))).toBe(false);
  });

  it("and a revoked ADMIN role applies on the very next request", async () => {
    expect((await request("GET", "/api/admin/platform-flags", listFlags as Handler)).status).toBe(200);
    fixture.database.exec("DELETE FROM UserRoles");
    const refused = await request("GET", "/api/admin/platform-flags", listFlags as Handler);
    expect(refused.status).toBe(403);
    // STAFF stays dark for the former admin: the spaces context is refused exactly as for anyone.
    const me = await request("GET", ROUTES.getMe.path, getMe as Handler);
    expect(me.status).toBe(404);
    expect(ErrorEnvelope.parse(await me.json()).error.code).toBe("flag_off");
  });

  it("never between two concurrent requests from different people", async () => {
    const [wanjiku, otieno] = await Promise.all([
      request("GET", ROUTES.getMe.path, getMe as Handler, { user: WANJIKU.id }),
      request("GET", ROUTES.getMe.path, getMe as Handler, { user: OTIENO.id }),
    ]);
    expect(wanjiku.status).toBe(200);
    expect(Me.parse(await wanjiku.json()).user.id).toBe(WANJIKU.id);
    // Otieno is not staff, so STAFF keeps spaces dark for him, whatever Wanjiku's request read.
    expect(otieno.status).toBe(404);
    expect(sql.filter((query) => CAPABILITY_QUERY.test(query))).toHaveLength(2);
  });
});

describe("other methods read the ADMIN role fresh", () => {
  it("in the admin guard of a PUT, without the shared capabilities", async () => {
    const response = await request("PUT", "/api/admin/platform-flags/channels", putFlag as Handler, { body: '{"audience":"STAFF"}' });
    expect(response.status).toBe(200);
    expect(sql.filter((query) => ADMIN_ROLE_QUERY.test(query)).length).toBeGreaterThan(0);
    expect(sql.some((query) => CAPABILITY_QUERY.test(query))).toBe(false);
  });
});

describe("personal access tokens", () => {
  it("keep the admin guard and its scope check on a GET", async () => {
    expect((await request("GET", "/api/admin/platform-flags", listFlags as Handler, { scopes: ["admin:read"] })).status).toBe(200);
    expect((await request("GET", "/api/admin/platform-flags", listFlags as Handler, { scopes: ["community:read"] })).status).toBe(403);
  });

  it("are refused /me before any capability is read for them", async () => {
    fixture.database.exec("UPDATE feature_flag SET audience='ALL' WHERE key='spaces'");
    const response = await request("GET", ROUTES.getMe.path, getMe as Handler, { scopes: ["admin:read"] });
    expect(response.status).toBe(403);
    expect(ErrorEnvelope.parse(await response.json()).error.code).toBe("forbidden");
    expect(sql.some((query) => CAPABILITY_QUERY.test(query))).toBe(false);
  });
});
