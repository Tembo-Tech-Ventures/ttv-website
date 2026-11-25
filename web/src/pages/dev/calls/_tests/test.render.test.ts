import { readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { Window } from "happy-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

/*
 * The test-call page (in-app calls T1) through the real middleware and page. SQLite with every
 * migration; authentication is mocked. Cohort 07 (#cohort-07) has Faith as its TA and Wanjiku as a
 * member; Amina is an admin. The gate is checked as a build outside `astro dev` (DEV off) unless a
 * test says otherwise, and production is checked with DEV on as well: nothing opens it there.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const ORIGIN = "https://ttv.invalid";
const PATH = "/dev/calls/test";
const PEOPLE = { faith: "synthetic-faith", wanjiku: "synthetic-wanjiku", amina: "synthetic-amina" };
const PREVIEW = { DEPLOYMENT_ENVIRONMENT: "agent-pr-435" };

let sqlite: DatabaseSync;
afterEach(() => {
  sqlite?.close();
  vi.unstubAllEnvs();
});

function seeded(env: Record<string, string | undefined> = PREVIEW, { conduct = true } = {}) {
  const created = createSqliteD1();
  sqlite = created.database;
  for (const file of readdirSync(new URL("../../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES ('cohort-a','Cohort 07','Test','curriculum',0,4102444800);
    INSERT INTO user(id,name,email) VALUES ('${PEOPLE.faith}','Faith Njeri','faith@example.test'),
      ('${PEOPLE.wanjiku}','Wanjiku Njeri','wanjiku@example.test'),('${PEOPLE.amina}','Amina Hassan','amina@example.test');
    INSERT INTO programRole(id,userId,programId,name) VALUES ('faith-ta','${PEOPLE.faith}','cohort-a','TA');
    INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('wanjiku-a','${PEOPLE.wanjiku}','cohort-a','APPROVED','{}');
    INSERT OR IGNORE INTO Roles(id,name) VALUES ('ADMIN','ADMIN');
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'admin-role','${PEOPLE.amina}',id FROM Roles WHERE name='ADMIN';
    ${conduct ? `INSERT INTO channel_conduct(userId,version,acknowledgedAt) VALUES ('${PEOPLE.faith}',1,0),('${PEOPLE.amina}',1,0);` : ""}
    UPDATE feature_flag SET audience='ALL';`);
  for (const key of Object.keys(mocks.env)) delete mocks.env[key];
  Object.assign(mocks.env, { DB: created.db, ...env });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

/** One request through the middleware and the page: a GET, or a form POST (same origin unless told). */
async function visit(userId: string | null, form?: Record<string, string>, { origin = ORIGIN, json = false, pat = false }: {
  origin?: string | null; json?: boolean; pat?: boolean;
} = {}) {
  const url = new URL(PATH, ORIGIN);
  if (userId) {
    const user = { id: userId, name: "Synthetic", email: `${userId}@example.test`, image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
    mocks.getSession.mockResolvedValue({ user, session: { id: `${userId}-session`, userId, userAgent: "Mozilla/5.0" } });
  } else {
    mocks.getSession.mockResolvedValue(null);
  }
  const request = () => {
    const headers = new Headers(json ? { Accept: "application/json" } : {});
    if (!form) return new Request(url, { headers });
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    if (origin) headers.set("Origin", origin);
    return new Request(url, { method: "POST", body: new URLSearchParams(form), headers });
  };
  const locals = { cfContext: { waitUntil: () => {} } } as unknown as App.Locals;
  const context = {
    url, request: request(), locals, params: {},
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () => {
    // A personal access token is a session the middleware resolved from a bearer header.
    if (pat) locals.personalAccessToken = { id: "pat" } as App.Locals["personalAccessToken"];
    const { default: Page } = await import("../test.astro");
    return container.renderToResponse(Page, { request: request(), locals });
  }) as Response;
  return { status: response.status, body: await response.text(), headers: response.headers };
}

function page(html: string) {
  const { document } = new Window();
  document.body.innerHTML = html;
  return document.body;
}
const meetings = () => sqlite.prepare("SELECT id, channelId, purpose, title, bookedMinutes, limitMinutes, state, createdBy FROM meeting").all() as
  Record<string, unknown>[];
const cohortChannel = () => (sqlite.prepare("SELECT id FROM channel WHERE seedKey = 'cohort:cohort-a:main'").get() as { id: string }).id;

describe("where the test-call page exists", () => {
  it("is a 404 in production, even in a dev build and with every setting that opens it elsewhere", async () => {
    vi.stubEnv("DEV", true);
    seeded({ DEPLOYMENT_ENVIRONMENT: "production", MEETINGS_TEST_CALLS: "on", PLATFORM_FLAGS_OVERRIDE: "all" });
    for (const userId of [PEOPLE.amina, PEOPLE.faith]) {
      expect((await visit(userId)).status).toBe(404);
      const posted = await visit(userId, { channelId: cohortChannel(), title: "Test call", minutes: "2" });
      expect(posted.status).toBe(404);
      expect((await visit(userId, { channelId: cohortChannel(), minutes: "2" }, { json: true })).status).toBe(404);
    }
    expect(meetings()).toEqual([]);
  });

  it("is a 404 on staging until it is switched on there, then a form", async () => {
    vi.stubEnv("DEV", false);
    seeded({ DEPLOYMENT_ENVIRONMENT: "staging" });
    expect((await visit(PEOPLE.amina)).status).toBe(404);
    seeded({ DEPLOYMENT_ENVIRONMENT: "staging", MEETINGS_TEST_CALLS: "on" });
    // Staging offers only the SAM personas' fictional cohorts; this admin still moderates the community channels.
    const form = page((await visit(PEOPLE.amina)).body);
    expect([...form.querySelectorAll("select[name=channelId] option")].map((option) => option.textContent)).toEqual(
      expect.arrayContaining(["Community: an event in #introductions"]));
    expect(form.textContent).not.toContain("Cohort 07");
  });

  it("is a form on an agent preview and in astro dev", async () => {
    vi.stubEnv("DEV", false);
    seeded(PREVIEW);
    const preview = await visit(PEOPLE.faith);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("Cache-Control")).toBe("no-store");
    const form = page(preview.body);
    expect(form.querySelector("h1")?.textContent).toBe("Make a test call");
    expect(form.querySelector("input[name=minutes]")?.getAttribute("value")).toBe("2");
    expect([...form.querySelectorAll("select[name=channelId] option")].map((option) => option.textContent)).toEqual(["Cohort 07: a session in #cohort-07"]);

    vi.stubEnv("DEV", true);
    seeded({ DEPLOYMENT_ENVIRONMENT: "development" });
    expect((await visit(PEOPLE.faith)).status).toBe(200);
  });

  it("is the same 404 for someone signed out, a token, a member who hosts nowhere, the flag off, and a post from elsewhere", async () => {
    vi.stubEnv("DEV", false);
    seeded(PREVIEW);
    expect((await visit(null)).status).toBe(404);
    expect((await visit(PEOPLE.faith, undefined, { pat: true })).status).toBe(404);
    expect((await visit(PEOPLE.wanjiku)).status).toBe(404);
    const form = { channelId: cohortChannel(), title: "Test call", minutes: "2" };
    expect((await visit(PEOPLE.faith, form, { origin: "https://elsewhere.invalid" })).status).toBe(404);
    expect((await visit(PEOPLE.faith, form, { origin: null })).status).toBe(404);
    sqlite.exec("UPDATE feature_flag SET audience = 'OFF' WHERE key = 'meetings'");
    expect((await visit(PEOPLE.faith)).status).toBe(404);
    expect(meetings()).toEqual([]);
  });
});

describe("making a test call", () => {
  it("makes a two-minute session with the TA as host and shows its room", async () => {
    vi.stubEnv("DEV", false);
    seeded(PREVIEW);
    const made = await visit(PEOPLE.faith, { channelId: cohortChannel(), title: "Ends on time", minutes: "2" });
    expect(made.status).toBe(201);
    const [meeting] = meetings();
    expect(meeting).toMatchObject({ purpose: "SESSION", title: "Ends on time", bookedMinutes: 2, limitMinutes: 2, state: "SCHEDULED", createdBy: PEOPLE.faith });
    const result = page(made.body);
    expect(result.querySelector("[data-test-call-room]")?.textContent).toBe(`${ORIGIN}/dashboard/calls/${meeting.id as string}`);
    expect(result.querySelector("a[href^='/dashboard/calls/']")?.textContent).toBe("Open the room");
    expect(result.textContent).toContain("“Ends on time” ends 2 minutes after you open the room.");
  });

  it("answers a script with JSON: the call's id and room, 201", async () => {
    vi.stubEnv("DEV", false);
    seeded(PREVIEW);
    const made = await visit(PEOPLE.amina, { channelId: cohortChannel(), minutes: "1" }, { json: true });
    expect(made.status).toBe(201);
    const body = JSON.parse(made.body) as Record<string, unknown>;
    const [meeting] = meetings();
    expect(body).toEqual({ id: meeting.id, roomPath: `/dashboard/calls/${meeting.id as string}`, roomUrl: `${ORIGIN}/dashboard/calls/${meeting.id as string}`, minutes: 1 });
    expect(meeting).toMatchObject({ title: "Test call", limitMinutes: 1 });
    const refused = await visit(PEOPLE.amina, { channelId: cohortChannel(), minutes: "500" }, { json: true });
    expect(refused.status).toBe(400);
    expect(JSON.parse(refused.body)).toMatchObject({ error: { code: "validation" } });
  });

  it("says why when the length is wrong or the host hasn't agreed to the code of conduct, and makes nothing", async () => {
    vi.stubEnv("DEV", false);
    seeded(PREVIEW, { conduct: false });
    const conduct = await visit(PEOPLE.faith, { channelId: cohortChannel(), title: "Test call", minutes: "2" });
    expect(conduct.status).toBe(403);
    expect(page(conduct.body).querySelector("a[href='/dashboard/community/conduct']")?.textContent).toBe("Read how we talk to each other");
    const length = await visit(PEOPLE.faith, { channelId: cohortChannel(), title: "Test call", minutes: "0" });
    expect(length.status).toBe(400);
    expect(page(length.body).textContent).toContain("A test call lasts 1 to 90 minutes.");
    expect(meetings()).toEqual([]);
  });
});
