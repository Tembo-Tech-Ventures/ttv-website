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
  for (const migration of ["0002_married_microbe.sql", "0003_absurd_argent.sql", "0017_community_discovery.sql", "0021_feature_flags.sql", "0023_attention_items.sql", "0025_onboarding.sql"]) fixture.database.exec(readMigration(migration));
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
    // A stale admin cookie is ignored: Admin lives at /admin, outside the cookie's Path=/dashboard.
    ["ttv-last-space=mentoring", "/dashboard/mentoring"], ["ttv-last-space=admin", "/dashboard/cohort"],
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

describe("onboarding routing (B-O.4)", () => {
  const T = 1_793_500_000_000;
  const USER = "synthetic-wanjiku";
  const onboarding = (audience: "OFF" | "STAFF" | "ALL") => fixture.database.prepare("UPDATE feature_flag SET audience=? WHERE key='onboarding'").run(audience);
  const stage = (value: "NEW" | "DONE") => fixture.database.prepare(
    "INSERT OR REPLACE INTO member_onboarding (userId,stage,completedAt,createdAt,updatedAt) VALUES (?,?,?,?,?)",
  ).run(USER, value, value === "DONE" ? T : null, T, T);
  const intents = (...values: string[]) => {
    for (const intent of values) fixture.database.prepare("INSERT INTO member_intent (userId,intent,createdAt) VALUES (?,?,?)").run(USER, intent, T);
  };
  const approved = (role: "MENTOR" | "INSTITUTION", seenAt: number | null = null) => fixture.database.prepare(`INSERT INTO access_request
      (id,userId,role,status,note,organisation,scopeAcknowledgedAt,decisionId,decidedBy,decidedAt,requesterSeenAt,createdAt,updatedAt)
      VALUES (?,?,?,'APPROVED','A synthetic request note, long enough.',?,?,?,NULL,?,?,?,?)`)
    .run(`request-${role}`, USER, role, role === "INSTITUTION" ? "Synthetic Org" : null, role === "INSTITUTION" ? T : null, `decision-${role}`, T, seenAt, T, T);
  const seenAt = (role: string) => (fixture.database.prepare("SELECT requesterSeenAt FROM access_request WHERE userId=? AND role=?").get(USER, role) as { requesterSeenAt: number | null }).requesterSeenAt;
  const location = async (path: string, options: Parameters<typeof context>[1] = {}) => {
    const { ctx, next } = context(path, options);
    const response = await routeSpaceRequest(ctx, next);
    return { response, next, location: response.headers.get("Location") };
  };

  it("flag-OFF snapshot: /dashboard is unchanged, whatever onboarding rows exist", async () => {
    const rows: string[] = [];
    // STAFF is off for everyone but admins, for whom onboarding is on.
    for (const audience of ["OFF", "STAFF"] as const) {
      for (const item of CAPABILITY_ROLE_MATRIX.filter(entry => entry.signedIn !== false && (audience === "OFF" || !entry.expected.isAdmin))) {
        setup(item);
        onboarding(audience);
        // Every onboarding signal at once: none of it may steer /dashboard while the flag is off.
        stage("NEW");
        intents("INSTITUTION");
        if (item.expected.isMentor) approved("MENTOR");
        const results: string[] = [];
        // The stale admin cookie is the one deliberate change (#256 review); it has its own test.
        for (const cookie of ["", "ttv-last-space=community", "ttv-last-space=mentoring", "ttv-last-space=profile"]) {
          for (const method of ["GET", "HEAD"]) {
            const { response, next } = await location("/dashboard?from=login", { cookie, method });
            expect(response.status).toBe(302);
            expect(response.headers.has("Set-Cookie")).toBe(false);
            expect(next).not.toHaveBeenCalled();
            if (method === "GET") results.push(response.headers.get("Location")!.replace("?from=login", ""));
          }
          const post = await location("/dashboard", { cookie, method: "POST" });
          expect(post.next).toHaveBeenCalledExactlyOnceWith();
        }
        if (item.expected.isMentor) expect(seenAt("MENTOR")).toBeNull();
        rows.push(`${audience} ${item.name}: ${results.join(" ")}`);
      }
    }
    expect(rows.join("\n")).toMatchInlineSnapshot(`
      "OFF community member: /dashboard/community /dashboard/community /dashboard/community /dashboard/me
      OFF pending applicant: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      OFF rejected applicant: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      OFF applicant without cohort: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      OFF approved: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      OFF audit: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      OFF completed: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      OFF INSTRUCTOR: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      OFF TA: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      OFF per-cohort mentor only: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      OFF global mentor without assignment: /dashboard/community /dashboard/community /dashboard/mentoring /dashboard/me
      OFF institution: /dashboard/community /dashboard/community /dashboard/community /dashboard/me
      OFF admin: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      OFF institution and cohort mentor: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      OFF global mentor and approved student: /dashboard/cohort /dashboard/community /dashboard/mentoring /dashboard/me
      OFF multi-cohort roles deduplicated: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      OFF all global roles and cohort mentor: /dashboard/cohort /dashboard/community /dashboard/mentoring /dashboard/me
      OFF global staff labels do not grant cohort scope: /dashboard/community /dashboard/community /dashboard/community /dashboard/me
      STAFF community member: /dashboard/community /dashboard/community /dashboard/community /dashboard/me
      STAFF pending applicant: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      STAFF rejected applicant: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      STAFF applicant without cohort: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      STAFF approved: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      STAFF audit: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      STAFF completed: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      STAFF INSTRUCTOR: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      STAFF TA: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      STAFF per-cohort mentor only: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      STAFF global mentor without assignment: /dashboard/community /dashboard/community /dashboard/mentoring /dashboard/me
      STAFF institution: /dashboard/community /dashboard/community /dashboard/community /dashboard/me
      STAFF institution and cohort mentor: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      STAFF global mentor and approved student: /dashboard/cohort /dashboard/community /dashboard/mentoring /dashboard/me
      STAFF multi-cohort roles deduplicated: /dashboard/cohort /dashboard/community /dashboard/cohort /dashboard/me
      STAFF global staff labels do not grant cohort scope: /dashboard/community /dashboard/community /dashboard/community /dashboard/me"
    `);
  });

  it.each(["OFF", "STAFF"])("flag-OFF snapshot: spaces %s keeps /dashboard on the legacy page even with onboarding ALL", async spaces => {
    setup();
    fixture.database.prepare("UPDATE feature_flag SET audience=? WHERE key='spaces'").run(spaces);
    onboarding("ALL");
    stage("NEW");
    for (const method of ["GET", "HEAD", "POST"]) {
      const { response, next } = await location("/dashboard", { method });
      expect(response.status).toBe(200);
      expect(response.headers.has("Location")).toBe(false);
      expect(next).toHaveBeenCalledExactlyOnceWith();
    }
  });

  it("ignores a stale admin cookie whenever another space exists (#256 review)", async () => {
    setup({ globalRoles: ["ADMIN"] });
    expect((await location("/dashboard", { cookie: "ttv-last-space=admin" })).location).toBe("/dashboard/cohort");
    onboarding("ALL");
    intents("INSTITUTION");
    expect((await location("/dashboard", { cookie: "ttv-last-space=admin" })).location).toBe("/dashboard/discover");
    // Any other cookie still works as before.
    expect((await location("/dashboard", { cookie: "ttv-last-space=community" })).location).toBe("/dashboard/community");
  });

  describe("GET /dashboard for a NEW account", () => {
    beforeEach(() => {
      setup();
      onboarding("ALL");
      stage("NEW");
    });

    it.each(["GET", "HEAD"])("sends a %s to the welcome step, keeping the query, without a cookie", async method => {
      const { response, next, location: target } = await location("/dashboard?from=login", { cookie: "ttv-last-space=community", method });
      expect(response.status).toBe(302);
      expect(target).toBe("/dashboard/welcome?from=login");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Vary")).toBe("Cookie");
      expect(response.headers.has("Set-Cookie")).toBe(false);
      expect(next).not.toHaveBeenCalled();
    });

    it("never redirects a POST", async () => {
      const { response, next } = await location("/dashboard", { method: "POST", body: "a=1" });
      expect(response.status).toBe(200);
      expect(next).toHaveBeenCalledExactlyOnceWith();
    });

    it.each(["/dashboard/community", "/dashboard/me", "/dashboard/account", "/dashboard/cohort/apply", "/dashboard/apply", "/dashboard/feedback", "/dashboard/attention"])("honours the deep link %s", async path => {
      const { response, location: target } = await location(path);
      expect(target === null || !target.startsWith("/dashboard/welcome")).toBe(true);
      expect(response.status).not.toBe(404);
    });

    it.each([
      ["once onboarding is done", () => stage("DONE"), "/dashboard/community"],
      ["while onboarding is STAFF-only", () => onboarding("STAFF"), "/dashboard/community"],
      ["for an admin", () => fixture.database.exec("INSERT INTO Roles (id,name) VALUES ('ADMIN','ADMIN'); INSERT INTO UserRoles (id,userId,roleId) VALUES ('global-ADMIN','synthetic-wanjiku','ADMIN')"), "/dashboard/cohort"],
      // Inferred intents still steer: a pre-granted role is preferred over SPACE_ORDER.
      ["for a pre-granted mentor", () => fixture.database.exec("INSERT INTO UserRoles (id,userId,roleId) SELECT 'global-MENTOR','synthetic-wanjiku',id FROM Roles WHERE name='MENTOR'"), "/dashboard/mentoring"],
      ["for an applicant", () => fixture.database.exec("INSERT INTO programApplication (id,userId,programId,status,application) VALUES ('a','synthetic-wanjiku','cohort-a','PENDING','{}')"), "/dashboard/cohort"],
      ["for a cohort assignment", () => fixture.database.exec("INSERT INTO programRole (id,userId,programId,name) VALUES ('r','synthetic-wanjiku','cohort-a','TA')"), "/dashboard/cohort"],
    ])("lands in a space instead %s", async (_name, arrange, expected) => {
      arrange();
      expect((await location("/dashboard")).location).toBe(expected);
    });

    it("falls back to the plain choice when onboarding state cannot be read", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      fixture.database.exec("DROP TABLE member_onboarding");
      const { response, location: target } = await location("/dashboard", { cookie: "ttv-last-space=profile" });
      expect(response.status).toBe(302);
      expect(target).toBe("/dashboard/me");
    });
  });

  it("never reads onboarding tables while the flag is off", async () => {
    setup();
    // access_request stays: attention counts read it whatever the flag.
    fixture.database.exec("DROP TABLE member_onboarding; DROP TABLE member_intent");
    const error = vi.spyOn(console, "error");
    expect((await location("/dashboard")).location).toBe("/dashboard/community");
    expect((await location("/dashboard/community")).response.status).toBe(200);
    expect(error).not.toHaveBeenCalled();
  });

  describe("an unseen approval wins over the cookie once", () => {
    beforeEach(() => {
      setup({ globalRoles: ["MENTOR"] });
      onboarding("ALL");
      approved("MENTOR");
    });

    it("lands in the approved space, then the visit marks it seen and the cookie wins again", async () => {
      expect((await location("/dashboard", { cookie: "ttv-last-space=community" })).location).toBe("/dashboard/mentoring");
      expect(seenAt("MENTOR")).toBeNull();
      const visit = await location("/dashboard/mentoring", { cookie: "ttv-last-space=community" });
      expect(visit.response.status).toBe(200);
      expect(visit.response.headers.get("Set-Cookie")).toContain("ttv-last-space=mentoring");
      expect(seenAt("MENTOR")).toBeGreaterThan(0);
      expect((await location("/dashboard", { cookie: "ttv-last-space=community" })).location).toBe("/dashboard/community");
    });

    it("acknowledges after the response through waitUntil, so the page never waits", async () => {
      const { ctx, next } = context("/dashboard/mentoring");
      const background: Promise<unknown>[] = [];
      ctx.locals.cfContext = { waitUntil: (promise: Promise<unknown>) => background.push(promise) } as never;
      expect((await routeSpaceRequest(ctx, next)).status).toBe(200);
      expect(background).toHaveLength(1);
      await Promise.all(background);
      expect(seenAt("MENTOR")).toBeGreaterThan(0);
    });

    it("is acknowledged by any page of that space", async () => {
      expect((await location("/dashboard/mentoring/confirm")).response.status).toBe(200);
      expect(seenAt("MENTOR")).toBeGreaterThan(0);
    });

    it.each<[string, string, string, () => void]>([
      ["a HEAD request", "/dashboard/mentoring", "HEAD", () => undefined],
      ["the legacy URL's redirect", "/dashboard/mentorship", "GET", () => undefined],
      ["another space", "/dashboard/community", "GET", () => undefined],
      ["a visit while onboarding is off", "/dashboard/mentoring", "GET", () => onboarding("OFF")],
    ])("is not acknowledged by %s", async (_name, path, method, arrange) => {
      arrange();
      await location(path, { method });
      expect(seenAt("MENTOR")).toBeNull();
    });

    it("is not acknowledged by an agent session", async () => {
      const { ctx, next } = context("/dashboard/mentoring");
      ctx.locals.session = { userAgent: "ttv-agent:synthetic" } as never;
      expect((await routeSpaceRequest(ctx, next)).status).toBe(200);
      expect(seenAt("MENTOR")).toBeNull();
    });

    it("does not win once the role is revoked, and is never acknowledged then", async () => {
      fixture.database.exec("DELETE FROM UserRoles");
      expect((await location("/dashboard", { cookie: "ttv-last-space=profile" })).location).toBe("/dashboard/me");
      expect((await location("/dashboard/mentoring")).response.status).toBe(403);
      expect(seenAt("MENTOR")).toBeNull();
    });

    it("still serves the page when the acknowledgement cannot be written, in the background or not", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      fixture.database.exec("CREATE TRIGGER refuse_seen BEFORE UPDATE ON access_request BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
      const visit = await location("/dashboard/mentoring");
      expect(visit.response.status).toBe(200);
      const { ctx, next } = context("/dashboard/mentoring");
      const background: Promise<unknown>[] = [];
      ctx.locals.cfContext = { waitUntil: (promise: Promise<unknown>) => background.push(promise) } as never;
      expect((await routeSpaceRequest(ctx, next)).status).toBe(200);
      // The background write settles (it never rejects into the runtime) and changes nothing.
      await expect(Promise.all(background)).resolves.toBeDefined();
      expect(seenAt("MENTOR")).toBeNull();
    });

    it("gives way to a seen approval and to an explicit URL", async () => {
      expect((await location("/dashboard/community")).response.status).toBe(200);
      expect(seenAt("MENTOR")).toBeNull();
      fixture.database.exec("UPDATE access_request SET requesterSeenAt = createdAt");
      expect((await location("/dashboard", { cookie: "ttv-last-space=community" })).location).toBe("/dashboard/community");
    });
  });

  it("prefers the space saved intents point to, below the cookie", async () => {
    setup({ globalRoles: ["MENTOR", "INSTITUTION"] });
    onboarding("ALL");
    stage("DONE");
    intents("INSTITUTION");
    expect((await location("/dashboard")).location).toBe("/dashboard/discover");
    expect((await location("/dashboard", { cookie: "ttv-last-space=mentoring" })).location).toBe("/dashboard/mentoring");
  });

  describe("/dashboard/welcome", () => {
    it.each([
      ["intent=mentor", "/dashboard/mentorship"], ["intent=institution", "/dashboard/discover"], ["intent=member", "/dashboard"],
      ["intent=MENTOR&from=partner", "/dashboard/mentorship"], ["intent=exploring", null], ["intent=admin", null], ["", null],
    ])("while onboarding is off, ?%s takes the legacy route %s (or 404)", async (query, expected) => {
      for (const spaces of ["ALL", "OFF"]) {
        setup({ globalRoles: ["MENTOR"] });
        fixture.database.prepare("UPDATE feature_flag SET audience=? WHERE key='spaces'").run(spaces);
        for (const method of ["GET", "HEAD"]) {
          const { response, next, location: target } = await location(`/dashboard/welcome?${query}`, { method });
          expect(response.status).toBe(expected ? 302 : 404);
          expect(target).toBe(expected);
          expect(response.headers.get("Cache-Control")).toBe("no-store");
          expect(next).not.toHaveBeenCalled();
        }
        const post = await location(`/dashboard/welcome?${query}`, { method: "POST", body: "intents=MENTOR" });
        expect(post.response.status).toBe(404);
        expect(post.next).not.toHaveBeenCalled();
      }
    });

    it("while onboarding is off, a trailing slash behaves the same", async () => {
      setup();
      expect((await location("/dashboard/welcome/?intent=mentor")).location).toBe("/dashboard/mentorship");
    });

    it("when the flags cannot be read, a hinted link still takes its legacy route and the step fails closed", async () => {
      setup();
      fixture.database.exec("DROP TABLE feature_flag");
      expect((await location("/dashboard/welcome?intent=institution")).location).toBe("/dashboard/discover");
      const { ctx, next } = context("/dashboard/welcome");
      await expect(routeSpaceRequest(ctx, next)).rejects.toThrow(/no such table|Failed query/);
      expect(next).not.toHaveBeenCalled();
    });

    describe("while onboarding is on", () => {
      beforeEach(() => {
        setup({ globalRoles: ["MENTOR"] });
        onboarding("ALL");
      });

      it.each([["intent=mentor", "/dashboard/mentoring"], ["intent=Mentor&x=1", "/dashboard/mentoring"]])("?%s for a role already held goes to its space", async (query, expected) => {
        const { response, next, location: target } = await location(`/dashboard/welcome?${query}`, { cookie: "ttv-last-space=community" });
        expect(response.status).toBe(302);
        expect(target).toBe(expected);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(response.headers.has("Set-Cookie")).toBe(false);
        expect(next).not.toHaveBeenCalled();
      });

      it.each(["", "intent=institution", "intent=member", "intent=exploring", "intent=bogus"])("?%s renders the page, which only preselects", async query => {
        const { response, next } = await location(`/dashboard/welcome?${query}`);
        expect(response.status).toBe(200);
        expect(next).toHaveBeenCalledExactlyOnceWith();
        expect(response.headers.get("Vary")).toBe("Accept-Encoding, Cookie");
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(response.headers.has("Set-Cookie")).toBe(false);
      });

      it("passes form posts to the page with their bodies, even with a hint", async () => {
        const { ctx } = context("/dashboard/welcome?intent=mentor", { method: "POST", body: "intents=MENTOR" });
        const next = vi.fn(async (rewrite?: string | URL | Request) => new Response(await (rewrite instanceof Request ? rewrite : ctx.request).text()));
        const response = await routeSpaceRequest(ctx, next);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("intents=MENTOR");
      });

      it("keeps the welcome step for a NEW account without looping", async () => {
        fixture.database.exec("DELETE FROM UserRoles");
        stage("NEW");
        expect((await location("/dashboard")).location).toBe("/dashboard/welcome");
        expect((await location("/dashboard/welcome")).response.status).toBe(200);
      });

      it("refuses personal access tokens", async () => {
        const { ctx, next } = context("/dashboard/welcome?intent=mentor");
        ctx.locals.personalAccessToken = { scopes: ["admin:read"] } as never;
        expect((await routeSpaceRequest(ctx, next)).status).toBe(403);
        expect(next).not.toHaveBeenCalled();
      });
    });
  });
});
