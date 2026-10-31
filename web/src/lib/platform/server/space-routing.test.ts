import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import { readMigration } from "@/test/sqlite-d1";
import { createCapabilityDatabase } from "./capabilities.test-support";
import { CAPABILITY_ROLE_MATRIX } from "./capabilities.fixtures";
import { SPACE_PATHS, SPACE_REDIRECTS } from "./space-routes";

const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
import { routeSpaceRequest } from "./space-routing";
import { getSpaceContext } from "./space-context";

let fixture: ReturnType<typeof createCapabilityDatabase>;
function setup(input: Parameters<typeof createCapabilityDatabase>[0] = {}) {
  fixture?.database.close();
  fixture = createCapabilityDatabase(input);
  for (const migration of ["0002_married_microbe.sql", "0003_absurd_argent.sql", "0017_community_discovery.sql", "0021_feature_flags.sql", "0023_attention_items.sql"]) fixture.database.exec(readMigration(migration));
  fixture.database.exec("UPDATE feature_flag SET audience='ALL' WHERE key='spaces'");
  Object.assign(mocks.env, { DB: fixture.db.$client, DEPLOYMENT_ENVIRONMENT: "production", PLATFORM_FLAGS_OVERRIDE: undefined });
}
beforeEach(() => setup({ globalRoles: ["MENTOR", "INSTITUTION", "ADMIN"], applications: [{ programId: "cohort-a", status: "APPROVED" }] }));
afterEach(() => { fixture.database.close(); fixture = undefined as never; vi.restoreAllMocks(); });

function context(path: string, { cookie = "", method = "GET", body }: { cookie?: string; method?: string; body?: string } = {}) {
  const url = new URL(path, "https://example.test");
  const ctx = { url, request: new Request(url, { method, body, headers: { cookie } }),
    locals: { user: { id: "synthetic-wanjiku", name: "Wanjiku Njeri", image: null }, personalAccessToken: null },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  } as APIContext;
  const next = vi.fn(async (_rewrite?: unknown) => new Response("Existing page", { headers: { Vary: "Accept-Encoding" } }));
  return { ctx, next };
}

describe("server routing with actual flags, capabilities and context", () => {
  it.each(SPACE_REDIRECTS)("redirects %s permanently to %s only when enabled", async (old, target) => {
    for (const method of ["GET", "HEAD"]) {
      const { ctx, next } = context(old.replace(":id", "synthetic-id") + "?t=123&filter=a%2Bb", { method });
      const response = await routeSpaceRequest(ctx, next);
      expect(response.status).toBe(301);
      expect(response.headers.get("Location")).toBe(target.replace(":id", "synthetic-id") + "?t=123&filter=a%2Bb");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Vary")).toBe("Cookie");
      expect(next).not.toHaveBeenCalled();
    }
  });

  it.each(SPACE_REDIRECTS)("renders the canonical destination for %s without a redirect loop", async (old, target) => {
    const { ctx, next } = context(target.replace(":id", "synthetic-id") + "?t=123");
    const response = await routeSpaceRequest(ctx, next);
    expect(response.status).toBe(200);
    const rewrite = next.mock.calls[0]?.[0];
    expect(rewrite).toBeInstanceOf(Request);
    expect((rewrite as Request).url).toBe("https://example.test" + old.replace(":id", "synthetic-id") + "?t=123");
    expect(response.headers.get("Vary")).toBe("Accept-Encoding, Cookie");
  });

  it.each([
    ["", "/dashboard/cohort"], ["ttv-last-space=profile", "/dashboard/me"],
    ["ttv-last-space=mentoring", "/dashboard/mentoring"], ["ttv-last-space=admin", "/admin"],
    ["ttv-last-space=%70rofile", "/dashboard/cohort"], ["ttv-last-space=evil", "/dashboard/cohort"],
    ["ttv-last-space=profile; ttv-last-space=community", "/dashboard/cohort"],
  ])("selects no-JavaScript default from cookie %s", async (cookie, expected) => {
    const { ctx, next } = context("/dashboard?from=login", { cookie });
    const response = await routeSpaceRequest(ctx, next);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(expected + "?from=login");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  it("explicit authorized URL wins and persists only the plain enum without JavaScript", async () => {
    const { ctx, next } = context("/dashboard/me", { cookie: "better-auth.session_token=SECRET; ttv-last-space=cohort" });
    const response = await routeSpaceRequest(ctx, next);
    expect(response.headers.get("Set-Cookie")).toBe("ttv-last-space=profile; Path=/dashboard; SameSite=Lax; Max-Age=31536000; Secure");
    expect(await response.text()).not.toContain("SECRET");
    expect(JSON.stringify(await getSpaceContext(ctx))).not.toContain("SECRET");
  });

  it("ignores a formerly authorized cookie and never falls back from an explicit forbidden route", async () => {
    setup();
    let call = context("/dashboard", { cookie: "ttv-last-space=mentoring" });
    expect((await routeSpaceRequest(call.ctx, call.next)).headers.get("Location")).toBe("/dashboard/community");
    call = context("/dashboard/mentoring", { cookie: "ttv-last-space=community" });
    expect((await routeSpaceRequest(call.ctx, call.next)).status).toBe(403);
    expect(call.next).not.toHaveBeenCalled();
  });

  it.each(CAPABILITY_ROLE_MATRIX.filter(item => item.signedIn !== false))("guards every space for $name", async item => {
    setup(item);
    for (const space of ["cohort", "community", "mentoring", "discover", "profile"] as const) {
      const { ctx, next } = context(SPACE_PATHS[space]);
      const response = await routeSpaceRequest(ctx, next);
      const allowed = item.expected.spaces.includes(space) || (space === "mentoring" && item.expected.isAdmin);
      expect(response.status).toBe(allowed ? 200 : 403);
      expect(next.mock.calls.length).toBe(allowed ? 1 : 0);
    }
  });

  it("preserves admin mentor review without granting mentoring membership or a preference cookie", async () => {
    setup({ globalRoles: ["ADMIN"] });
    for (const [path, status] of [["/dashboard/mentorship", 301], ["/dashboard/mentoring", 200], ["/dashboard/mentoring/confirm", 200]] as const) {
      const { ctx, next } = context(path);
      const response = await routeSpaceRequest(ctx, next);
      expect(response.status).toBe(status);
      expect(response.headers.has("Set-Cookie")).toBe(false);
      expect((await getSpaceContext(ctx)).spaces).not.toContain("mentoring");
    }
  });

  it("preserves applying before any cohort membership, without granting cohort access", async () => {
    setup();
    for (const [path, status] of [["/dashboard/apply", 301], ["/dashboard/cohort/apply", 200], ["/dashboard/cohort", 403], ["/dashboard/sessions", 403]] as const) {
      const { ctx, next } = context(path);
      expect((await routeSpaceRequest(ctx, next)).status).toBe(status);
    }
  });

  it.each([[], ["INSTITUTION"], ["MENTOR"]])("preserves signed-in Ask access for roles %j without cohort authority", async (...roles) => {
    setup({ globalRoles: roles });
    for (const [path, status] of [["/dashboard/ask", 301], ["/dashboard/cohort/ask", 200], ["/dashboard/cohort", 403], ["/dashboard/cohort/sessions", 403]] as const) {
      const { ctx, next } = context(path);
      const response = await routeSpaceRequest(ctx, next);
      expect(response.status).toBe(status);
      expect(response.headers.has("Set-Cookie")).toBe(false);
      const me = await getSpaceContext(ctx);
      expect(me.spaces).not.toContain("cohort");
      expect(me.capabilities.cohortIds).toEqual([]);
    }
  });

  it.each(["OFF", "STAFF"])("preserves every legacy URL for nonstaff when audience is %s", async audience => {
    setup();
    fixture.database.prepare("UPDATE feature_flag SET audience=? WHERE key='spaces'").run(audience);
    fixture.database.exec("DROP TABLE attention_item; DROP TABLE programRole");
    for (const path of ["/dashboard", "/dashboard/community", "/dashboard/discover", ...SPACE_REDIRECTS.map(([old]) => old.replace(":id", "synthetic-id"))]) {
      for (const method of ["GET", "POST"]) {
        const { ctx, next } = context(path, { method });
        const response = await routeSpaceRequest(ctx, next);
        expect(response.status).toBe(200);
        expect(response.headers.has("Location")).toBe(false);
        expect(response.headers.has("Set-Cookie")).toBe(false);
        expect(next).toHaveBeenCalledExactlyOnceWith();
      }
    }
    for (const [, target] of SPACE_REDIRECTS) {
      const { ctx, next } = context(target.replace(":id", "synthetic-id"));
      expect((await routeSpaceRequest(ctx, next)).status).toBe(404);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it("keeps legacy POST bodies in place and canonical POST bodies intact", async () => {
    for (const path of ["/dashboard/profile", "/dashboard/account", "/dashboard/me/writing/new", "/dashboard/cohort/apply"]) {
      const { ctx } = context(path, { method: "POST", body: "name=Wanjiku&_action=save" });
      const next = vi.fn(async (rewrite?: string | URL | Request) => new Response(await (rewrite instanceof Request ? rewrite : ctx.request).text()));
      const response = await routeSpaceRequest(ctx, next);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("name=Wanjiku&_action=save");
      expect(response.headers.has("Location")).toBe(false);
      expect(response.headers.has("Set-Cookie")).toBe(false);
    }
  });

  it("caches the Me payload within a request, not between requests", async () => {
    const { ctx, next } = context("/dashboard/community");
    await routeSpaceRequest(ctx, next);
    fixture.database.exec("DROP TABLE programRole");
    expect((await getSpaceContext(ctx)).spaces).toContain("cohort");
    await expect(getSpaceContext(context("/dashboard/community").ctx)).rejects.toThrow(/no such table|Failed query/);
  });

  it("invalidates a shared context if authentication changes", async () => {
    const { ctx } = context("/dashboard/community");
    expect((await getSpaceContext(ctx)).spaces).toContain("mentoring");
    ctx.locals.user = { ...ctx.locals.user!, id: "synthetic-otieno" };
    expect((await getSpaceContext(ctx)).spaces).toEqual(["community", "profile"]);
    ctx.locals.personalAccessToken = { scopes: ["admin:read"] } as never;
    await expect(getSpaceContext(ctx)).rejects.toMatchObject({ status: 403 });
    ctx.locals.user = null;
    await expect(getSpaceContext(ctx)).rejects.toMatchObject({ status: 404 });
  });

  it.each(["feature_flag", "programRole", "attention_item"])("keeps legacy handlers intact and canonical routes closed on %s database failure", async table => {
    fixture.database.exec(`DROP TABLE ${table}`);
    for (const path of ["/dashboard", "/dashboard/ask", "/dashboard/profile", "/dashboard/discover"]) {
      const { ctx, next } = context(path);
      const response = await routeSpaceRequest(ctx, next);
      expect(response.status).toBe(200);
      expect(response.headers.has("Location")).toBe(false);
      expect(response.headers.has("Set-Cookie")).toBe(false);
      expect(next).toHaveBeenCalledExactlyOnceWith();
    }
    const { ctx, next } = context("/dashboard/account");
    await expect(routeSpaceRequest(ctx, next)).rejects.toThrow(/no such table|Failed query/);
    expect(next).not.toHaveBeenCalled();
  });

  it.each(["/dashboard/community/c/general", "/dashboard/mentoring/requests", "/dashboard/me/certificates", "/dashboard/account/private"])("keeps unimplemented routes dark: %s", async path => {
    const { ctx, next } = context(path);
    expect((await routeSpaceRequest(ctx, next)).status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("does not grant PATs new page access", async () => {
    const { ctx, next } = context("/dashboard/me");
    ctx.locals.personalAccessToken = { scopes: ["admin:read"] } as never;
    expect((await routeSpaceRequest(ctx, next)).status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
