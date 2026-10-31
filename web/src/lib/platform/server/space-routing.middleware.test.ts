import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import { readMigration } from "@/test/sqlite-d1";
import { DEMO_PERSONAS } from "@/lib/staging-demo-policy";
import { createCapabilityDatabase } from "./capabilities.test-support";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>, getSession: vi.fn(), hasQaCookie: vi.fn(), authenticateQaCookie: vi.fn(),
  validateDemoSession: vi.fn(), resolveStagingFixtureIdentity: vi.fn(), recordErrorInBackground: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("@/lib/auth", () => ({ createAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/lib/staging-qa-access", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/staging-qa-access")>(), hasQaCookie: mocks.hasQaCookie, authenticateQaCookie: mocks.authenticateQaCookie }));
vi.mock("@/lib/staging-demo-access", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/staging-demo-access")>(), validateDemoSession: mocks.validateDemoSession }));
vi.mock("@/lib/staging-fixtures", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/staging-fixtures")>(), resolveStagingFixtureIdentity: mocks.resolveStagingFixtureIdentity }));
vi.mock("@/lib/observability/errors", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/observability/errors")>(), recordErrorInBackground: mocks.recordErrorInBackground }));
import { onRequest } from "@/middleware";

let fixture: ReturnType<typeof createCapabilityDatabase>;
const user = { id: "synthetic-wanjiku", name: "Wanjiku Njeri", email: "synthetic@example.test", image: null };
const auth = { user, session: { id: "synthetic-session", userId: user.id, userAgent: "browser" } };
beforeEach(() => {
  vi.clearAllMocks();
  fixture = createCapabilityDatabase({ globalRoles: ["MENTOR", "INSTITUTION"], assignments: [{ programId: "cohort-a", name: "MENTOR" }] });
  for (const migration of ["0002_married_microbe.sql", "0003_absurd_argent.sql", "0017_community_discovery.sql", "0021_feature_flags.sql", "0023_attention_items.sql"]) fixture.database.exec(readMigration(migration));
  fixture.database.exec("UPDATE feature_flag SET audience='ALL' WHERE key='spaces'");
  Object.assign(mocks.env, { DB: fixture.db.$client, DEPLOYMENT_ENVIRONMENT: "production" });
  mocks.getSession.mockResolvedValue(auth);
  mocks.hasQaCookie.mockReturnValue(false);
  mocks.validateDemoSession.mockResolvedValue(null);
  mocks.resolveStagingFixtureIdentity.mockResolvedValue(null);
});
afterEach(() => { fixture.database.close(); vi.restoreAllMocks(); });

async function request(path: string, cookie = "") {
  const url = new URL(path, "https://example.test");
  const ctx = { url, request: new Request(url, { headers: { cookie } }), locals: {},
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  } as APIContext;
  const next = vi.fn(async (_rewrite?: unknown) => new Response("Existing page"));
  const response = await onRequest(ctx, next);
  if (!(response instanceof Response)) throw new Error("Expected a response");
  return { response, next, ctx };
}

describe("space routes through authentication middleware", () => {
  it.each(["/dashboard/cohort/sessions/x?t=12", "/dashboard/me", "/dashboard/account", "/dashboard/mentoring", "/dashboard/sessions"])("keeps anonymous sign-in return paths: %s", async path => {
    mocks.getSession.mockResolvedValue(null);
    const { response, next } = await request(path);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/auth/login?next=" + encodeURIComponent(path));
    expect(next).not.toHaveBeenCalled();
  });

  it("routes authenticated legacy and canonical requests", async () => {
    expect((await request("/dashboard/mentorship")).response.headers.get("Location")).toBe("/dashboard/mentoring/confirm");
    const { response, next } = await request("/dashboard/mentoring/confirm");
    expect(response.status).toBe(200);
    expect((next.mock.calls[0]![0] as Request).url).toBe("https://example.test/dashboard/mentorship");
  });

  it("does not trust a role-bearing cookie", async () => {
    fixture.database.exec("DELETE FROM UserRoles");
    const { response, next } = await request("/dashboard/mentoring", "ttv-last-space=mentoring; role=ADMIN");
    expect(response.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("keeps institution users in community/discover/profile without cohort or mentor grants", async () => {
    fixture.database.exec("DELETE FROM programRole; DELETE FROM UserRoles WHERE roleId='MENTOR'");
    for (const path of ["/dashboard/community", "/dashboard/discover", "/dashboard/me", "/dashboard/account"]) expect((await request(path)).response.status).toBe(200);
    for (const path of ["/dashboard/cohort", "/dashboard/mentoring"]) expect((await request(path)).response.status).toBe(403);
  });

  it("preserves shared URLs when OFF and refuses only new canonical surfaces", async () => {
    fixture.database.exec("UPDATE feature_flag SET audience='OFF'");
    for (const path of ["/dashboard", "/dashboard/mentorship", "/dashboard/profile", "/dashboard/community", "/dashboard/discover"]) {
      const { response, next } = await request(path);
      expect(response.status).toBe(200);
      expect(next).toHaveBeenCalledExactlyOnceWith();
    }
    for (const path of ["/dashboard/me", "/dashboard/account", "/dashboard/cohort", "/dashboard/mentoring"]) expect((await request(path)).response.status).toBe(404);
  });

  it("observes database failure without serving or redirecting the page", async () => {
    fixture.database.exec("DROP TABLE programRole");
    await expect(request("/dashboard/profile")).rejects.toThrow(/no such table|Failed query/);
    expect(mocks.recordErrorInBackground).toHaveBeenCalledOnce();
  });

  it.each(["mentor", "institution", "member-noncohort"] as const)("applies space guards in the separate QA branch: %s", async persona => {
    mocks.hasQaCookie.mockReturnValue(true);
    mocks.authenticateQaCookie.mockResolvedValue({ ...auth, qa: { persona } });
    const { response } = await request("/dashboard", "ttv-last-space=profile");
    // profile is in capabilities but outside the frozen QA allowlist.
    expect(response.headers.get("Location")).toBe("/dashboard/cohort");
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect((await request("/dashboard/account")).response.status).toBe(403);
    expect((await request("/dashboard/mentoring/confirm")).response.status).toBe(persona === "mentor" ? 200 : 403);
    fixture.database.exec("UPDATE feature_flag SET audience='OFF'");
    expect((await request("/dashboard/cohort")).response.status).toBe(404);
    expect((await request("/dashboard")).response.status).toBe(200);
  });

  it("QA allowlist does not replace role authority", async () => {
    mocks.hasQaCookie.mockReturnValue(true);
    mocks.authenticateQaCookie.mockResolvedValue({ ...auth, qa: { persona: "mentor" } });
    fixture.database.exec("DELETE FROM UserRoles WHERE roleId='MENTOR'");
    expect((await request("/dashboard/mentoring/confirm")).response.status).toBe(403);
  });

  it("demo aliases never unlock recordings or account pages", async () => {
    mocks.validateDemoSession.mockResolvedValue({ persona: "mentor", expiresAt: 123 });
    expect((await request("/dashboard/mentoring")).response.status).toBe(200);
    expect((await request("/dashboard/mentoring/confirm")).response.status).toBe(200);
    expect((await request("/dashboard/cohort/sessions")).response.status).toBe(200);
    for (const path of ["/dashboard/cohort/sessions/private", "/dashboard/account", "/dashboard/me", "/dashboard/cohort/apply"]) expect((await request(path)).response.status).toBe(403);
  });

  it("fixture aliases preserve the existing community surface only", async () => {
    mocks.resolveStagingFixtureIdentity.mockResolvedValue({ persona: "mentor" });
    expect((await request("/dashboard/mentoring/confirm")).response.status).toBe(200);
    for (const path of ["/dashboard/cohort", "/dashboard/cohort/sessions", "/dashboard/account", "/dashboard/me"]) expect((await request(path)).response.status).toBe(403);
  });

  it("retained probes remain restricted to discovery", async () => {
    mocks.resolveStagingFixtureIdentity.mockResolvedValue({ retainedReadProbe: true });
    expect((await request("/dashboard/discover")).response.status).toBe(200);
    expect((await request("/dashboard/mentoring")).response.status).toBe(403);
  });

  it("demo-derived capabilities do not gain real cohort scope from global roles", async () => {
    const demo = { ...user, id: DEMO_PERSONAS.mentor.userId };
    fixture.database.prepare("INSERT INTO user (id,name,email) VALUES (?,?,?)").run(demo.id, demo.name, "demo@example.test");
    fixture.database.prepare("INSERT INTO programRole (id,userId,programId,name) VALUES (?,?,?,?)").run("demo-assignment", demo.id, "cohort-a", "MENTOR");
    mocks.getSession.mockResolvedValue({ ...auth, user: demo });
    mocks.validateDemoSession.mockResolvedValue({ persona: "mentor" });
    expect((await request("/dashboard/cohort")).response.status).toBe(403);
  });
});
