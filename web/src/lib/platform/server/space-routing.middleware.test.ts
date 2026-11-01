import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import { readMigration } from "@/test/sqlite-d1";
import { DEMO_PERSONAS } from "@/lib/staging-demo-policy";
import { createPersonalAccessToken } from "@/lib/personal-access-tokens";
import { createCapabilityDatabase } from "./capabilities.test-support";
import { SPACE_REDIRECTS } from "./space-routes";

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
  for (const migration of ["0002_married_microbe.sql", "0003_absurd_argent.sql", "0017_community_discovery.sql", "0021_feature_flags.sql", "0023_attention_items.sql", "0025_onboarding.sql"]) fixture.database.exec(readMigration(migration));
  fixture.database.exec("UPDATE feature_flag SET audience='ALL' WHERE key='spaces'");
  Object.assign(mocks.env, { DB: fixture.db.$client, DEPLOYMENT_ENVIRONMENT: "production", PLATFORM_FLAGS_OVERRIDE: undefined, STAGING_RETAINED_READ_PROBE_ENABLED: undefined });
  mocks.getSession.mockResolvedValue(auth);
  mocks.hasQaCookie.mockReturnValue(false);
  mocks.validateDemoSession.mockResolvedValue(null);
  mocks.resolveStagingFixtureIdentity.mockResolvedValue(null);
});
afterEach(() => { fixture.database.close(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function request(path: string, cookie = "", authorization = "", method = "GET") {
  const url = new URL(path, "https://example.test");
  const ctx = { url, request: new Request(url, { method, headers: { cookie, authorization } }), locals: {},
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
    await expect(request("/dashboard/account")).rejects.toThrow(/no such table|Failed query/);
    expect(mocks.recordErrorInBackground).toHaveBeenCalledOnce();
  });

  it("legacy fallback on flag DB failure preserves earlier auth and demo restrictions", async () => {
    fixture.database.exec("UPDATE feature_flag SET audience='OFF'; DROP TABLE feature_flag");
    const legacy = await request("/dashboard/profile");
    expect(legacy.response.status).toBe(200);
    expect(legacy.next).toHaveBeenCalledExactlyOnceWith();
    await expect(request("/dashboard/account")).rejects.toThrow(/no such table|Failed query/);
    mocks.getSession.mockResolvedValue(null);
    expect((await request("/dashboard/ask")).response.status).toBe(302);
    mocks.getSession.mockResolvedValue(auth);
    mocks.validateDemoSession.mockResolvedValue({ persona: "mentor", expiresAt: 123 });
    expect((await request("/dashboard/profile")).response.status).toBe(403);
    expect((await request("/dashboard/account")).response.status).toBe(403);
  });

  it("legacy flag DB fallback cannot bypass community PAT delegation", async () => {
    fixture.database.exec(readMigration("0008_curvy_purifiers.sql"));
    const credential = await createPersonalAccessToken({ db: fixture.db.$client, userId: user.id, label: "Synthetic community", durationHours: 8, scopes: ["community:read"] });
    fixture.database.exec("DROP TABLE feature_flag");
    for (const path of ["/dashboard/ask", "/dashboard/profile", "/dashboard/cohort/ask", "/dashboard/account"]) {
      const { response, next } = await request(path, "", `Bearer ${credential.token}`);
      expect(response.status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it.each(["ALL", "OFF"])("preserves admin PAT legacy page verification when spaces is %s", async audience => {
    fixture.database.exec(readMigration("0008_curvy_purifiers.sql"));
    fixture.database.exec("DELETE FROM UserRoles; DELETE FROM programRole; INSERT INTO Roles (id,name) VALUES ('ADMIN','ADMIN')");
    fixture.database.prepare("INSERT INTO UserRoles (id,userId,roleId) VALUES (?,?,?)").run("admin-pat-role", user.id, "ADMIN");
    fixture.database.prepare("INSERT INTO programApplication (id,userId,programId,status,application) VALUES (?,?,?,?,?)")
      .run("admin-application", user.id, "cohort-a", "APPROVED", "{}");
    fixture.database.prepare("UPDATE feature_flag SET audience=? WHERE key='spaces'").run(audience);
    const credential = await createPersonalAccessToken({ db: fixture.db.$client, userId: user.id, label: "Synthetic page verification", durationHours: 8, scopes: ["admin:read"] });
    const paths = ["/dashboard", "/dashboard/community", "/dashboard/discover", "/dashboard/feedback", ...SPACE_REDIRECTS.map(([path]) => path.replace(":id", "synthetic-id"))];
    for (const path of paths) {
      for (const method of ["GET", "HEAD", "POST"]) {
        const { response, next, ctx } = await request(path, "ttv-last-space=profile", `Bearer ${credential.token}`, method);
        expect(response.status).toBe(200);
        expect(response.headers.has("Location")).toBe(false);
        expect(response.headers.has("Set-Cookie")).toBe(false);
        expect(next).toHaveBeenCalledExactlyOnceWith();
        expect(ctx.locals.personalAccessToken?.scopes).toEqual(["admin:read"]);
      }
    }
    for (const path of ["/dashboard/cohort", "/dashboard/me", "/dashboard/account", "/dashboard/mentoring"]) {
      const { response, next } = await request(path, "", `Bearer ${credential.token}`);
      expect(response.status).toBe(audience === "ALL" ? 403 : 404);
      expect(next).not.toHaveBeenCalled();
    }
    expect(mocks.getSession).not.toHaveBeenCalled();
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
    for (const path of ["/dashboard/cohort/sessions/private", "/dashboard/account", "/dashboard/me"]) expect((await request(path)).response.status).toBe(403);
    // B-1.5: the Apply form opens read-only; submitting stays outside every QA ledger.
    expect((await request("/dashboard/cohort/apply")).response.status).toBe(200);
    for (const path of ["/dashboard/cohort/apply", "/dashboard/apply"]) expect((await request(path, "", "", "POST")).response.status).toBe(403);
  });

  it("fixture aliases add only read-only spaces entries to the existing community surface", async () => {
    mocks.resolveStagingFixtureIdentity.mockResolvedValue({ persona: "mentor" });
    expect((await request("/dashboard/mentoring/confirm")).response.status).toBe(200);
    for (const path of ["/dashboard/cohort", "/dashboard/cohort/apply"]) {
      expect((await request(path)).response.status).toBe(200);
      expect((await request(path, "", "", "POST")).response.status).toBe(403);
    }
    for (const path of ["/dashboard/cohort/sessions", "/dashboard/account", "/dashboard/me"]) expect((await request(path)).response.status).toBe(403);
  });

  it("retained probes remain restricted to discovery", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-25T09:30:00Z"));
    const { resolveStagingFixtureIdentity, retainedProbeMarker } = await vi.importActual<typeof import("@/lib/staging-fixtures")>("@/lib/staging-fixtures");
    mocks.resolveStagingFixtureIdentity.mockImplementation(resolveStagingFixtureIdentity);
    Object.assign(mocks.env, { DEPLOYMENT_ENVIRONMENT: "staging", PLATFORM_FLAGS_OVERRIDE: "all", STAGING_RETAINED_READ_PROBE_ENABLED: "true" });
    for (const migration of ["0008_curvy_purifiers.sql", "0019_staging_fixture_identity.sql"]) fixture.database.exec(readMigration(migration));
    const runId = "a".repeat(24), userId = `ttv-staging-fixture-${runId}-institution`;
    const sessionId = `${userId}-retained-read-probe-session`, now = Math.floor(Date.now() / 1000);
    fixture.database.prepare("INSERT INTO user (id,name,email) VALUES (?,?,?)").run(userId, "Synthetic institution", `${userId}@invalid.ttv`);
    fixture.database.prepare("INSERT INTO UserRoles (id,userId,roleId) VALUES (?,?,?)").run("probe-role", userId, "INSTITUTION");
    fixture.database.prepare("INSERT INTO session (id,userId,token,userAgent,createdAt,expiresAt) VALUES (?,?,?,?,?,?)")
      .run(sessionId, userId, "synthetic-source-session", retainedProbeMarker(runId), now - 10, now + 800);
    fixture.database.prepare("INSERT INTO stagingFixtureIdentity (userId,sessionId,runId,persona,expiresAt) VALUES (?,?,?,?,?)")
      .run(userId, sessionId, runId, "institution", now + 800);
    const credential = await createPersonalAccessToken({ db: fixture.db.$client, userId, label: "Synthetic probe", durationHours: 8, scopes: ["community:read", "institution:read"] });
    for (const [method, path, status] of [["GET", "/dashboard/discover", 200], ["POST", "/dashboard/discover", 403], ["GET", "/dashboard/community", 403], ["GET", "/dashboard/mentoring", 403], ["GET", "/dashboard/me", 403]] as const) {
      const { response, next, ctx } = await request(path, "", `Bearer ${credential.token}`, method);
      expect(response.status).toBe(status);
      expect(next.mock.calls.length).toBe(status === 200 ? 1 : 0);
      if (status === 200) {
        expect(ctx.locals.personalAccessToken?.scopes).toEqual(["community:read", "institution:read"]);
        expect(ctx.locals.stagingFixture?.retainedReadProbe).toBe(true);
      }
    }
    expect(mocks.getSession).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-10-25T11:10:35Z"));
    expect((await request("/dashboard/discover", "", `Bearer ${credential.token}`)).response.status).toBe(403);
  });

  it("demo-derived capabilities do not gain real cohort scope from global roles", async () => {
    const demo = { ...user, id: DEMO_PERSONAS.mentor.userId };
    fixture.database.prepare("INSERT INTO user (id,name,email) VALUES (?,?,?)").run(demo.id, demo.name, "demo@example.test");
    fixture.database.prepare("INSERT INTO programRole (id,userId,programId,name) VALUES (?,?,?,?)").run("demo-assignment", demo.id, "cohort-a", "MENTOR");
    mocks.getSession.mockResolvedValue({ ...auth, user: demo });
    mocks.validateDemoSession.mockResolvedValue({ persona: "mentor" });
    expect((await request("/dashboard/cohort")).response.status).toBe(403);
  });

  describe("onboarding: GET /dashboard sends only a NEW account in its own browser to the welcome step", () => {
    beforeEach(() => {
      fixture.database.exec(`DELETE FROM UserRoles; DELETE FROM programRole;
        UPDATE feature_flag SET audience='ALL' WHERE key='onboarding';
        INSERT INTO member_onboarding (userId,stage,createdAt,updatedAt) VALUES ('synthetic-wanjiku','NEW',1,1)`);
    });
    const grantAdmin = () => fixture.database.exec("INSERT INTO Roles (id,name) VALUES ('ADMIN','ADMIN'); INSERT INTO UserRoles (id,userId,roleId) VALUES ('admin-role','synthetic-wanjiku','ADMIN')");

    it("redirects a person's own browser session (the control case)", async () => {
      const { response, next } = await request("/dashboard", "ttv-last-space=community");
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/dashboard/welcome");
      expect(next).not.toHaveBeenCalled();
    });

    it("never redirects an admin", async () => {
      grantAdmin();
      expect((await request("/dashboard")).response.headers.get("Location")).toBe("/dashboard/cohort");
    });

    it("never redirects an admin personal access token: the legacy page answers", async () => {
      fixture.database.exec(readMigration("0008_curvy_purifiers.sql"));
      grantAdmin();
      const credential = await createPersonalAccessToken({ db: fixture.db.$client, userId: user.id, label: "Synthetic", durationHours: 8, scopes: ["admin:read"] });
      for (const method of ["GET", "HEAD", "POST"]) {
        const { response, next } = await request("/dashboard", "", `Bearer ${credential.token}`, method);
        expect(response.status).toBe(200);
        expect(response.headers.has("Location")).toBe(false);
        expect(next).toHaveBeenCalledExactlyOnceWith();
      }
    });

    it("never redirects a community personal access token: delegation refuses it first", async () => {
      fixture.database.exec(readMigration("0008_curvy_purifiers.sql"));
      const credential = await createPersonalAccessToken({ db: fixture.db.$client, userId: user.id, label: "Synthetic", durationHours: 8, scopes: ["community:read"] });
      const { response, next } = await request("/dashboard", "", `Bearer ${credential.token}`);
      expect(response.status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });

    it.each(["ttv-agent:synthetic-label", "ttv-agent:isolated-preview:persona"])("never redirects an agent session (%s)", async userAgent => {
      mocks.getSession.mockResolvedValue({ ...auth, session: { ...auth.session, userAgent } });
      expect((await request("/dashboard")).response.headers.get("Location")).toBe("/dashboard/community");
    });

    it.each(["member-noncohort", "mentor", "institution"] as const)("never redirects the QA persona %s", async persona => {
      mocks.hasQaCookie.mockReturnValue(true);
      mocks.authenticateQaCookie.mockResolvedValue({ ...auth, qa: { persona } });
      const { response } = await request("/dashboard");
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/dashboard/community");
    });

    it("never redirects a demo persona", async () => {
      mocks.validateDemoSession.mockResolvedValue({ persona: "member-noncohort", expiresAt: 123 });
      expect((await request("/dashboard")).response.headers.get("Location")).toBe("/dashboard/community");
    });

    it("never redirects a fixture persona", async () => {
      mocks.resolveStagingFixtureIdentity.mockResolvedValue({ persona: "member" });
      expect((await request("/dashboard")).response.headers.get("Location")).toBe("/dashboard/community");
    });

    it.each(["/dashboard/community", "/dashboard/me", "/dashboard/account", "/dashboard/feedback", "/dashboard/profile", "/dashboard/apply"])("never redirects the deep link %s", async path => {
      const { response } = await request(path);
      expect(response.headers.get("Location") ?? "").not.toMatch(/welcome/);
      expect(response.status).toBeLessThan(400);
    });

    it.each(["POST", "PUT", "DELETE"])("never redirects a %s", async method => {
      const { response, next } = await request("/dashboard", "", "", method);
      expect(response.status).toBe(200);
      expect(next).toHaveBeenCalledExactlyOnceWith();
    });

    it("sends anonymous visitors to sign in, returning to the welcome step with its hint", async () => {
      mocks.getSession.mockResolvedValue(null);
      const { response } = await request("/dashboard/welcome?intent=mentor");
      expect(response.headers.get("Location")).toBe("/auth/login?next=" + encodeURIComponent("/dashboard/welcome?intent=mentor"));
    });

    it("lets restricted personas read the welcome step but never post to it", async () => {
      mocks.resolveStagingFixtureIdentity.mockResolvedValue({ persona: "member" });
      expect((await request("/dashboard/welcome")).response.status).toBe(200);
      const post = await request("/dashboard/welcome", "", "", "POST");
      expect(post.response.status).toBe(403);
      expect(post.next).not.toHaveBeenCalled();
      mocks.resolveStagingFixtureIdentity.mockResolvedValue(null);
      mocks.hasQaCookie.mockReturnValue(true);
      mocks.authenticateQaCookie.mockResolvedValue({ ...auth, qa: { persona: "member-noncohort" } });
      expect((await request("/dashboard/welcome")).response.status).toBe(200);
      expect((await request("/dashboard/welcome", "", "", "POST")).response.status).toBe(403);
    });

    it("sends a persona's granted hint only to a space its allowlist opens", async () => {
      fixture.database.exec("INSERT INTO UserRoles (id,userId,roleId) VALUES ('mentor-role','synthetic-wanjiku','MENTOR')");
      mocks.hasQaCookie.mockReturnValue(true);
      mocks.authenticateQaCookie.mockResolvedValue({ ...auth, qa: { persona: "mentor" } });
      expect((await request("/dashboard/welcome?intent=mentor")).response.headers.get("Location")).toBe("/dashboard/mentoring");
      // The member QA persona's allowlist never opens Mentoring, so the page answers instead.
      mocks.authenticateQaCookie.mockResolvedValue({ ...auth, qa: { persona: "member-noncohort" } });
      const { response, next } = await request("/dashboard/welcome?intent=mentor");
      expect(response.status).toBe(200);
      expect(next).toHaveBeenCalledOnce();
    });
  });
});
