import { readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRaw } from "@/lib/attention/test-support";

/*
 * /dashboard/community/mentors on the style guide: the directory rendered on the server with only the
 * requests island hydrated, and the "Ask for time" drawer posting without JavaScript, through the real
 * middleware, the page and the API's own handler, on SQLite with every migration. Authentication is
 * mocked. The island's behaviour is mentors-ui.test.tsx; the browser journeys are
 * e2e/platform-mentors.spec.ts (harness) and platform-mentor-requests.spec.ts (the page).
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../mentors.astro");

const STUDENT = "synthetic-wanjiku";
const INSTITUTION = "synthetic-amani";
const DAVID = "synthetic-david";
const JOSEPH = "synthetic-joseph";
const ORIGIN = "https://ttv.invalid";
const PATH = "/dashboard/community/mentors";
const NAMES: Record<string, string> = { [STUDENT]: "Wanjiku Njeri", [INSTITUTION]: "Amani Wekesa", [DAVID]: "David Kamau", [JOSEPH]: "Joseph Mutua" };
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seeded() {
  const { database: sqlite, db } = createSqliteD1();
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES ('cohort-a','Cohort 07','Test','curriculum',0,4102444800);
    ${Object.entries(NAMES).map(([id, name]) => `INSERT INTO user(id,name,email) VALUES ('${id}','${name}','${id}@example.test');`).join("\n")}
    INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('application','${STUDENT}','cohort-a','APPROVED','{}');
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'role-david','${DAVID}',id FROM Roles WHERE name='MENTOR';
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'role-joseph','${JOSEPH}',id FROM Roles WHERE name='MENTOR';
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'role-amani','${INSTITUTION}',id FROM Roles WHERE name='INSTITUTION';
    INSERT INTO mentor_profile(userId,headline,bio,areas,formats,monthlyCapacity,paused,createdAt,updatedAt) VALUES
      ('${DAVID}','Backend engineer · fintech','Reviews APIs and data models.','["Code review","API design"]','["WRITTEN_REVIEW","CALL_30_MIN"]',3,0,1,1),
      ('${JOSEPH}','Engineering manager','Career conversations.','["Career"]','["CALL_30_MIN"]',2,0,1,1);
    INSERT INTO channel_conduct(userId,version,acknowledgedAt) VALUES ('${STUDENT}',1,0),('${INSTITUTION}',1,0);
    UPDATE feature_flag SET audience='ALL';`);
  Object.assign(mocks.env, { DB: withRaw(sqlite, db), DEPLOYMENT_ENVIRONMENT: "production" });
  return sqlite;
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

/** One signed-in request through the middleware and the page. */
async function visit(init: { method?: string; query?: string; form?: Record<string, string>; user?: string } = {}) {
  const { method = "GET", query = "", form, user: id = STUDENT } = init;
  const url = new URL(`${PATH}${query}`, ORIGIN);
  const body = form ? new URLSearchParams(form).toString() : undefined;
  const request = () => new Request(url, {
    method, body, headers: { Origin: ORIGIN, ...body ? { "Content-Type": "application/x-www-form-urlencoded" } : {} },
  });
  const user = { id, name: NAMES[id], email: `${id}@example.test`, image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${id}-session`, userId: id, userAgent: "Mozilla/5.0" } });
  const locals = {} as App.Locals;
  const context = {
    url, request: request(), locals, params: {},
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () =>
    container.renderToResponse(Page, { request: request(), locals })) as Response;
  return { status: response.status, headers: response.headers, body: await response.text() };
}

const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;
const islands = (body: string) => [...body.matchAll(/<astro-island[^>]*component-url="([^"]+)"/g)].map(([, url]) => url).toSorted();
/** The page's own part: the directory, to the end of the page's main region. */
const directory = (body: string) => /<div class="mentors-directory" data-mentors-directory>[\s\S]*?(?=<\/main>)/.exec(body)?.[0] ?? "";
/** The server-rendered directory after the island: filters, results heading, cards. */
const list = (body: string) => /<nav aria-label="Filter mentors"[\s\S]*$/.exec(directory(body))?.[0] ?? "";
const ASK = { intent: "mentor-request", mentorId: DAVID, note: "Could you check how I handle a payment callback that arrives twice?", project: "", format: "WRITTEN_REVIEW" };

describe("the mentor directory page", () => {
  it("renders the directory on the server and hydrates only the requests island, with no peach action", async () => {
    seeded();
    const { status, headers, body } = await visit();
    expect(status).toBe(200);
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(islands(body)).toEqual([
      "@/components/platform/mentors/DirectoryRequests", "@/components/platform/overlays/PlatformOverlays",
      "@/components/platform/shell/SpacesShell",
    ]);
    // The filters, the results and the cards come after the island, outside it.
    const before = body.slice(0, body.indexOf('<nav aria-label="Filter mentors"'));
    expect(before.lastIndexOf("</astro-island>")).toBeGreaterThan(before.lastIndexOf("<astro-island"));
    const rendered = list(body);
    expect(count(rendered, /data-mentor-card=/g)).toBe(2);
    expect(rendered).toMatch(/<nav aria-label="Area" data-pill-nav[\s\S]*?aria-current="page"[^>]*>All<\/a>/);
    expect(rendered).toMatch(/<h2 id="mentor-results"[^>]*>2 mentors<\/h2>/);
    expect(rendered).not.toMatch(/<h2[^>]*class="[^"]*(font-semibold|font-body)/);
    // Every "Ask for time" is a quiet link to the drawer's own URL, so it works without JavaScript.
    expect(rendered).toMatch(new RegExp(`<a aria-label="Ask for time with David Kamau"[^>]* href="${PATH}\\?ask=${DAVID}" data-variant="quiet"`));
    expect(count(body, /data-variant="primary"/g)).toBe(0);
    expect(directory(body)).not.toContain("data-notice");
  });

  it("filters from its one directory read, with the server's rules", async () => {
    seeded();
    const { body } = await visit({ query: "?area=code%20REVIEW&available=true" });
    const rendered = list(body);
    expect(count(rendered, /data-mentor-card=/g)).toBe(1);
    expect(rendered).toContain(`data-mentor-card="${DAVID}"`);
    expect(rendered).toMatch(/<h2 id="mentor-results"[^>]*>1 mentor · Code review · Has open spots<\/h2>/);
    expect(rendered).toMatch(/aria-current="true"[^>]*data-filter-available/);
    const none = list((await visit({ query: "?format=QUICK_QUESTION" })).body);
    expect(none).toMatch(/data-mentors-empty[\s\S]*?No mentors match these filters[\s\S]*?Show every mentor/);
  });

  it("opens the drawer named by ?ask= as a form, Send its one primary", async () => {
    seeded();
    const { body } = await visit({ query: `?ask=${DAVID}` });
    expect(body).toMatch(new RegExp(`<form method="post" action="${PATH}\\?ask=${DAVID}"`));
    expect(body).toContain("data-mentor-drawer-static");
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/<button[^>]*type="submit"[^>]*data-variant="primary"[^>]*>Send request<\/button>/);
  });

  it("sends without JavaScript and lands on the directory with a success notice that takes focus", async () => {
    const sqlite = seeded();
    const { status, headers } = await visit({ method: "POST", query: `?ask=${DAVID}`, form: ASK });
    expect(status).toBe(303);
    const location = headers.get("Location")!;
    expect(location).toMatch(new RegExp(`^${PATH}\\?sent=`));
    expect(sqlite.prepare("SELECT status, format FROM mentor_request WHERE mentorId = ?").all(DAVID)).toEqual([{ status: "PENDING", format: "WRITTEN_REVIEW" }]);
    const { body } = await visit({ query: location.slice(PATH.length) });
    const notice = /<div class="mb-6" data-request-sent-notice>[\s\S]*?<\/div><\/div><\/div>/.exec(body)?.[0] ?? "";
    expect(notice).toMatch(/autofocus/i);
    expect(notice).toContain('data-notice="success"');
    expect(notice).toContain("Request sent to David Kamau");
    // David's card now says the request waits, where "Ask for time" was.
    expect(list(body)).toMatch(new RegExp(`data-mentor-card="${DAVID}"[\\s\\S]*?data-mentor-standing="waiting"[^>]*>Waiting for David<`));
  });

  it("brings a refused send back (400) with the drawer, what was written, and a danger notice that takes focus", async () => {
    const sqlite = seeded();
    const { status, body } = await visit({ method: "POST", query: `?ask=${DAVID}`, form: { ...ASK, note: "  ", format: "CALL_30_MIN" } });
    expect(status).toBe(400);
    expect(body).toMatch(/<title>Error: /);
    expect(sqlite.prepare("SELECT count(*) AS n FROM mentor_request").get()).toEqual({ n: 0 });
    const refusal = /<div class="w-full" data-request-error="true">[\s\S]*?<\/div><\/div><\/div>/.exec(body)?.[0] ?? "";
    expect(refusal).toMatch(/autofocus/i);
    expect(refusal).toContain('data-notice="danger"');
    expect(refusal.replaceAll("&#x27;", "'")).toContain("Your request wasn't sent. Fix what's marked above, then send it again.");
    expect(body).toMatch(/<textarea[^>]*aria-invalid="true"/);
    expect(body.replaceAll("&#x27;", "'")).toContain("Say what you'd like help with.");
    expect(body).toMatch(/<input[^>]*checked=""[^>]*id="format-CALL_30_MIN"|<input[^>]*id="format-CALL_30_MIN"[^>]*checked=""/);
  });

  it("tells someone in an organisation they can ask as themselves, in one notice", async () => {
    seeded();
    const { body } = await visit({ user: INSTITUTION });
    expect(directory(body)).toMatch(/data-mentors-as-yourself>[\s\S]*?data-notice="info"[\s\S]*?You can ask a mentor for time as yourself\./);
    expect(count(directory(body), /data-notice=/g)).toBe(1);
    expect(list(body)).toContain(`aria-label="Ask for time with David Kamau"`);
  });

  it("does not exist while mentor_requests is off", async () => {
    const sqlite = seeded();
    sqlite.exec("UPDATE feature_flag SET audience='OFF' WHERE key='mentor_requests'");
    expect((await visit()).status).toBe(404);
    expect((await visit({ method: "POST", form: ASK })).status).toBe(404);
  });
});
