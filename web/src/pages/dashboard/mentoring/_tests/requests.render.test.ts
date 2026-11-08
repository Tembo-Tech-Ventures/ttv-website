import { readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRaw } from "@/lib/attention/test-support";

/*
 * /dashboard/mentoring/requests on the style guide: the rail rendered on the server with only the list
 * of requests hydrated, and every answer posting without JavaScript, through the real middleware, the
 * page and the API's own handlers, on SQLite with every migration. Authentication is mocked. The
 * island's behaviour is mentors-ui.test.tsx; the browser journeys are e2e/platform-mentors.spec.ts
 * (harness) and platform-mentor-requests.spec.ts (the page).
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", () => ({ createAuth: () => ({ api: { getSession: mocks.getSession } }) }));

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../requests.astro");

const STUDENT = "synthetic-wanjiku";
const ALUMNA = "synthetic-achieng";
const DAVID = "synthetic-david";
const JOSEPH = "synthetic-joseph";
const ASKED = "request-wanjiku";
const ALSO_ASKED = "request-achieng";
const ORIGIN = "https://ttv.invalid";
const PATH = "/dashboard/mentoring/requests";
const NAMES: Record<string, string> = { [STUDENT]: "Wanjiku Njeri", [ALUMNA]: "Achieng Otieno", [DAVID]: "David Kamau", [JOSEPH]: "Joseph Mutua" };
const databases: DatabaseSync[] = [];
afterEach(async () => {
  // The API's work after the response (attention, Clef) runs on without a waitUntil here: let it settle first.
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  databases.splice(0).forEach((database) => database.close());
});

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
    INSERT INTO mentor_profile(userId,headline,bio,areas,formats,monthlyCapacity,paused,createdAt,updatedAt) VALUES
      ('${DAVID}','Backend engineer · fintech','Reviews APIs and data models.','["Code review","API design"]','["WRITTEN_REVIEW","CALL_30_MIN"]',3,0,1,1),
      ('${JOSEPH}','Engineering manager','Career conversations.','["Career"]','["CALL_30_MIN"]',2,0,1,1);
    INSERT INTO channel_conduct(userId,version,acknowledgedAt) VALUES ('${STUDENT}',1,0),('${ALUMNA}',1,0),('${DAVID}',1,0);
    INSERT INTO mentor_request(id,requesterId,mentorId,format,note) VALUES
      ('${ASKED}','${STUDENT}','${DAVID}','WRITTEN_REVIEW','Could you check how I handle a payment callback that arrives twice?'),
      ('${ALSO_ASKED}','${ALUMNA}','${DAVID}','CALL_30_MIN','Could we talk about API versioning?');
    UPDATE feature_flag SET audience='ALL';`);
  Object.assign(mocks.env, { DB: withRaw(sqlite, db), DEPLOYMENT_ENVIRONMENT: "production" });
  return sqlite;
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

/** One signed-in request through the middleware and the page, as David unless said otherwise. */
async function visit(init: { method?: string; query?: string; form?: Record<string, string>; user?: string; origin?: string } = {}) {
  const { method = "GET", query = "", form, user: id = DAVID, origin = ORIGIN } = init;
  const url = new URL(`${PATH}${query}`, ORIGIN);
  const body = form ? new URLSearchParams(form).toString() : undefined;
  const request = () => new Request(url, {
    method, body, headers: { Origin: origin, ...body ? { "Content-Type": "application/x-www-form-urlencoded" } : {} },
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
/** The page's own part: from its intro to the end of the page's main region. */
const own = (body: string) => /data-mentor-page-intro[\s\S]*?(?=<\/main>)/.exec(body)?.[0] ?? "";
const unescape = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&#39;", "'");
/** One request's card, as the island rendered it on the server. */
const card = (body: string, id: string) => new RegExp(`<li[^>]*data-mentor-request="${id}"[\\s\\S]*?</li>`).exec(body)?.[0] ?? "";
const status = (sqlite: DatabaseSync, id: string) => sqlite.prepare("SELECT status, redirectedToId, responseNote, channelId FROM mentor_request WHERE id = ?").get(id);

describe("the mentor's requests page", () => {
  it("renders the rail on the server and hydrates only the list, with every Accept quiet", async () => {
    seeded();
    const { status: code, headers, body } = await visit();
    expect(code).toBe(200);
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(islands(body)).toEqual([
      "@/components/platform/mentors/MentorRequestsQueue",
      "@/components/platform/overlays/PlatformOverlays", "@/components/platform/shell/SpacesShell",
    ]);
    // The rail comes after the island, outside it, with the spots the island takes over.
    const rail = body.indexOf("data-mentoring-rail");
    expect(rail).toBeGreaterThan(body.lastIndexOf("</astro-island>", rail));
    expect(body.slice(rail)).toMatch(/data-mentor-spots[\s\S]*?data-spots-used="true"[^>]*>2<!-- --> of <!-- -->3</);
    expect(body).toMatch(/<h2 class="text-xl text-ink-primary" data-waiting-count="2">2 requests waiting for you<\/h2>/);
    expect(own(body)).toMatch(/<h2 id="mentoring-month" class="text-lg text-ink-primary">Your (<!-- -->)?[A-Z][a-z]+<\/h2>/);
    expect(own(body)).not.toMatch(/<h2[^>]*class="[^"]*(font-semibold|font-body)/);
    expect(count(body, /data-mentor-request="/g)).toBe(2);
    // No peach action until a panel is open: Accept is quiet on every card, and a real form.
    expect(count(body, /data-variant="primary"/g)).toBe(0);
    const wanjiku = card(body, ASKED);
    expect(wanjiku).toMatch(new RegExp(`<form method="post" action="${PATH}" class="contents"><input type="hidden" name="intent" value="accept"/><input type="hidden" name="requestId" value="${ASKED}"/>`));
    expect(wanjiku).toMatch(/<button[^>]*type="submit"[^>]*data-variant="quiet"[^>]*>.*?Accept<\/button>/);
    expect(wanjiku).toMatch(/<button name="answer" value="decline"[^>]*type="submit"[^>]*>Not this month<\/button>/);
    expect(body).not.toContain("answering needs it");
  });

  it("opens a panel named in the URL as a form, its Send the view's one primary", async () => {
    seeded();
    const { body } = await visit({ query: `?request=${ASKED}&answer=decline` });
    const wanjiku = card(body, ASKED);
    expect(wanjiku).toMatch(/<form method="post" action="\/dashboard\/mentoring\/requests"[^>]*data-decline-request/);
    expect(wanjiku).toMatch(/<textarea[^>]*name="note"/);
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/<button[^>]*type="submit"[^>]*data-variant="primary"[^>]*>Send: not this month<\/button>/);
    // A panel only opens on a request waiting for this mentor.
    expect(count((await visit({ query: "?request=someone-else&answer=decline" })).body, /data-decline-request/g)).toBe(0);
  });

  it("accepts without JavaScript and lands on the queue with a notice that takes focus and opens the conversation", async () => {
    const sqlite = seeded();
    const { status: code, headers } = await visit({ method: "POST", form: { intent: "accept", requestId: ASKED } });
    expect(code).toBe(303);
    expect(headers.get("Location")).toBe(`${PATH}?answered=${ASKED}`);
    const accepted = status(sqlite, ASKED) as { status: string; channelId: string };
    expect(accepted.status).toBe("ACCEPTED");
    const { body } = await visit({ query: `?answered=${ASKED}` });
    const notice = /<div class="mb-6" data-request-answered-notice[\s\S]*?<\/div><\/div><\/div><\/div>/.exec(body)?.[0] ?? "";
    expect(notice).toMatch(/autofocus/i);
    expect(notice).toContain('data-notice="success"');
    expect(unescape(notice)).toContain("You accepted Wanjiku's request");
    expect(notice).toContain(`href="/dashboard/community/dm/${accepted.channelId}"`);
    expect(notice).toContain("Open conversation with Wanjiku");
  });

  it("says not this month with a note, suggests another mentor and reports a note without JavaScript", async () => {
    const sqlite = seeded();
    const declined = await visit({ method: "POST", form: { intent: "decline", requestId: ASKED, note: "I'm travelling. Try me in December?" } });
    expect(declined.status).toBe(303);
    expect(status(sqlite, ASKED)).toMatchObject({ status: "DECLINED", responseNote: "I'm travelling. Try me in December?" });
    expect(unescape((await visit({ query: `?answered=${ASKED}` })).body)).toContain("You told Wanjiku not this month");

    const redirected = await visit({ method: "POST", form: { intent: "redirect", requestId: ALSO_ASKED, [`suggest-${ALSO_ASKED}`]: JOSEPH, note: "" } });
    expect(redirected.status).toBe(303);
    expect(status(sqlite, ALSO_ASKED)).toMatchObject({ status: "REDIRECTED", redirectedToId: JOSEPH, responseNote: null });

    sqlite.exec(`INSERT INTO mentor_request(id,requesterId,mentorId,format,note) VALUES ('request-again','${STUDENT}','${DAVID}','WRITTEN_REVIEW','Text me on my number instead.')`);
    const reported = await visit({ method: "POST", form: { intent: "report", requestId: "request-again", reason: "Asks to move off the platform." } });
    expect(reported.status).toBe(303);
    expect(status(sqlite, "request-again")).toMatchObject({ status: "PENDING" });
    expect(sqlite.prepare("SELECT reason FROM mentor_request_report WHERE requestId = 'request-again'").get()).toEqual({ reason: "Asks to move off the platform." });
    expect(unescape((await visit({ query: "?answered=request-again" })).body)).toContain("You reported Wanjiku's request");
  });

  it("refuses another site's post and a form it can't read, changing nothing", async () => {
    const sqlite = seeded();
    expect((await visit({ method: "POST", form: { intent: "accept", requestId: ASKED }, origin: "https://elsewhere.invalid" })).status).toBe(403);
    expect((await visit({ method: "POST", form: { intent: "withdraw", requestId: ASKED } })).status).toBe(400);
    expect(status(sqlite, ASKED)).toMatchObject({ status: "PENDING" });
  });

  it("brings a refused suggestion back with the API's status, its panel, what was written and a notice that takes focus", async () => {
    const sqlite = seeded();
    // Wanjiku isn't a mentor: the API refuses the suggestion.
    const { status: code, body } = await visit({ method: "POST", form: { intent: "redirect", requestId: ASKED, [`suggest-${ASKED}`]: ALUMNA, note: "Achieng knows this well." } });
    expect(code).toBe(400);
    expect(body).toMatch(/<title>Error: /);
    expect(status(sqlite, ASKED)).toMatchObject({ status: "PENDING" });
    const wanjiku = card(body, ASKED);
    const notice = new RegExp(`<div data-request-answer-error="${ASKED}">[\\s\\S]*?</div></div></div></div>`).exec(wanjiku)?.[0] ?? "";
    expect(notice).toMatch(/autofocus/i);
    expect(notice).toContain('data-notice="danger"');
    expect(notice).toContain("Suggest another mentor who is taking requests.");
    expect(wanjiku).toMatch(/data-suggest-mentor/);
    expect(wanjiku).toMatch(/<textarea[^>]*name="note"[^>]*>Achieng knows this well.<\/textarea>/);
  });

  it("asks for a report's reason, and says when the request moved on before the answer", async () => {
    const sqlite = seeded();
    const empty = await visit({ method: "POST", form: { intent: "report", requestId: ASKED, reason: " " } });
    expect(empty.status).toBe(400);
    expect(card(empty.body, ASKED)).toMatch(/<textarea[^>]*aria-invalid="true"/);
    expect(unescape(card(empty.body, ASKED))).toContain("Say what's wrong with this request, so TTV knows what to check.");

    sqlite.exec(`UPDATE mentor_request SET status='WITHDRAWN', decidedAt=updatedAt WHERE id='${ASKED}'`);
    const moved = await visit({ method: "POST", form: { intent: "accept", requestId: ASKED } });
    expect(moved.status).toBe(409);
    expect(card(moved.body, ASKED)).toContain("This request from Wanjiku Njeri was withdrawn, so nothing changed.");
    expect(card(moved.body, ASKED)).not.toMatch(/data-(decline|suggest|report)-request|value="accept"/);
  });

  it("allows only GET, HEAD and POST, and does not exist while mentor_requests is off", async () => {
    const sqlite = seeded();
    const put = await visit({ method: "PUT" });
    expect(put.status).toBe(405);
    expect(put.headers.get("Allow")).toBe("GET, HEAD, POST");
    // Not a mentor: the router refuses a space the person doesn't hold.
    expect((await visit({ user: STUDENT })).status).toBe(403);
    sqlite.exec("UPDATE feature_flag SET audience='OFF' WHERE key='mentor_requests'");
    expect((await visit()).status).toBe(404);
    expect((await visit({ method: "POST", form: { intent: "accept", requestId: ASKED } })).status).toBe(404);
    expect(status(sqlite, ASKED)).toMatchObject({ status: "PENDING" });
  });
});
