import { readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRaw } from "@/lib/attention/test-support";

/*
 * /dashboard/mentoring/availability on the style guide: a server-rendered kit form that saves without
 * JavaScript, through the real middleware, the page and the API's own handler, on SQLite with every
 * migration. Authentication is mocked. The browser journeys are e2e/platform-mentors.spec.ts (harness)
 * and platform-mentor-requests.spec.ts (the page, without JavaScript).
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", () => ({ createAuth: () => ({ api: { getSession: mocks.getSession } }) }));

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../availability.astro");

const MENTOR = "synthetic-david";
const ORIGIN = "https://ttv.invalid";
const PATH = "/dashboard/mentoring/availability";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seeded() {
  const { database: sqlite, db } = createSqliteD1();
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO user(id,name,email) VALUES ('${MENTOR}','David Kamau','david@example.test');
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'mentor-role','${MENTOR}',id FROM Roles WHERE name='MENTOR';
    INSERT INTO mentor_profile(userId,headline,bio,areas,formats,monthlyCapacity,paused) VALUES
      ('${MENTOR}','Backend engineer · fintech','Reviews APIs and data models.','["Code review","API design"]','["WRITTEN_REVIEW","CALL_30_MIN"]',3,0);
    UPDATE feature_flag SET audience='ALL';`);
  Object.assign(mocks.env, { DB: withRaw(sqlite, db), DEPLOYMENT_ENVIRONMENT: "production" });
  return sqlite;
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

type Form = Record<string, string | string[]>;
const FORM: Form = {
  headline: "Backend engineer · payments", areas: "Code review\n\n  API design  \nTesting\n", formats: ["WRITTEN_REVIEW", "QUICK_QUESTION"],
  monthlyCapacity: "4", bio: "Reviews APIs.", paused: "on",
};

/** One signed-in request through the middleware and the page. */
async function visit(init: { method?: string; query?: string; form?: Form; origin?: string | null } = {}) {
  const { method = "GET", query = "", form, origin = ORIGIN } = init;
  const url = new URL(`${PATH}${query}`, ORIGIN);
  const body = form ? new URLSearchParams(Object.entries(form).flatMap(([key, value]) => [value].flat().map((v) => [key, v]))) : undefined;
  const request = () => new Request(url, {
    method,
    headers: { ...body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}, ...origin ? { Origin: origin } : {} },
    body: body?.toString(),
  });
  const user = { id: MENTOR, name: "David Kamau", email: "david@example.test", image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${MENTOR}-session`, userId: MENTOR, userAgent: "Mozilla/5.0" } });
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

const profile = (sqlite: DatabaseSync) => sqlite.prepare("SELECT headline, bio, areas, formats, monthlyCapacity, paused FROM mentor_profile WHERE userId = ?").get(MENTOR);
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;
const field = (body: string, name: string) => new RegExp(`<div data-field="${name}"[\\s\\S]*?(?=<div data-field=|<fieldset|<div data-choice=)`).exec(body)?.[0] ?? "";

describe("the availability page", () => {
  it("renders the saved availability as a kit form with no island, and one peach action", async () => {
    seeded();
    const { status, headers, body } = await visit();
    expect(status).toBe(200);
    expect(headers.get("Cache-Control")).toBe("no-store");
    // The shell's own islands only: the page itself hydrates nothing.
    const islands = [...body.matchAll(/<astro-island[^>]*component-url="([^"]+)"/g)].map(([, url]) => url);
    expect(islands.toSorted()).toEqual(["@/components/feedback/FeedbackWidget", "@/components/platform/overlays/PlatformOverlays", "@/components/platform/shell/SpacesShell"]);
    expect(body).toMatch(/<form method="POST"[^>]*data-availability-form/);
    expect(body).toMatch(/<input[^>]*name="headline"[^>]*value="Backend engineer · fintech"/);
    expect(body).toMatch(/<textarea[^>]*name="areas"[^>]*>Code review\nAPI design<\/textarea>/);
    expect(body).toMatch(/<input[^>]*id="formats-WRITTEN_REVIEW"[^>]*checked=""|<input[^>]*checked=""[^>]*id="formats-WRITTEN_REVIEW"/);
    expect(body).not.toMatch(/<input[^>]*checked=""[^>]*id="formats-QUICK_QUESTION"/);
    expect(body).toMatch(/<input[^>]*type="number"[^>]*value="3"|<input[^>]*value="3"[^>]*type="number"/);
    expect(body).toMatch(/<textarea[^>]*name="bio"[^>]*>Reviews APIs and data models\.<\/textarea>/);
    // A native checkbox, never a switch role.
    expect(body).toMatch(/<input[^>]*name="paused"[^>]*type="checkbox"/);
    expect(body).not.toContain('role="switch"');
    expect(body).toMatch(/data-listing="listed"[\s\S]*?data-chip="success"[^>]*>[\s\S]*?Listed</);
    expect(body).toContain("Members can find you in the mentor directory and ask for your time.");
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/<button type="submit" data-variant="primary"[^>]*>Save availability<\/button>/);
    expect(body).toMatch(/<button type="reset" data-variant="quiet"[^>]*>Undo changes<\/button>/);
    const page = /<header[^>]*data-mentor-page-intro[\s\S]*?<\/form>/.exec(body)?.[0] ?? "";
    expect(page).toContain("data-availability-form");
    expect(page).not.toMatch(/<h2[^>]*class="[^"]*(font-semibold|font-body)/);
    expect(page).not.toContain("data-notice");
  });

  it("saves a valid post through the API's handler and redirects (303) to say so", async () => {
    const sqlite = seeded();
    const { status, headers } = await visit({ method: "POST", form: FORM });
    expect(status).toBe(303);
    expect(headers.get("Location")).toBe(`${PATH}?saved=1`);
    expect(profile(sqlite)).toEqual({
      headline: "Backend engineer · payments", bio: "Reviews APIs.", areas: '["Code review","API design","Testing"]',
      formats: '["WRITTEN_REVIEW","QUICK_QUESTION"]', monthlyCapacity: 4, paused: 1,
    });

    const after = await visit({ query: "?saved=1" });
    expect(after.body).toMatch(/<div id="availability-saved"[^>]*data-notice="success"/);
    expect(after.body).toMatch(/<div id="availability-saved"[^>]*autofocus/i);
    expect(after.body).toContain("Availability saved");
    expect(after.body).toMatch(/data-listing="unlisted"[\s\S]*?data-chip="neutral"[^>]*>[\s\S]*?Not listed</);
    expect(after.body).toContain("Paused. You&#39;re not in the mentor directory");
    expect(after.body).toMatch(/<input[^>]*name="paused"[^>]*checked=""|<input[^>]*checked=""[^>]*name="paused"/);
  });

  it("re-renders a rejected post (400) with every value kept, a danger notice that takes focus and each field's error", async () => {
    const sqlite = seeded();
    const before = profile(sqlite);
    const areas = Array.from({ length: 21 }, (_, i) => `Area ${i + 1}`).join("\n");
    const { status, body } = await visit({ method: "POST", form: { ...FORM, headline: "  ", areas, monthlyCapacity: "99" } });
    expect(status).toBe(400);
    expect(profile(sqlite)).toEqual(before);
    expect(body).toMatch(/<title>Error: /);
    const notice = /<div id="availability-errors"[^>]*>[\s\S]*?<\/div><\/div>/.exec(body)?.[0] ?? "";
    expect(notice).toMatch(/autofocus/i);
    expect(notice).toContain('data-notice="danger"');
    expect(notice).toContain("3 things to fix before this can be saved");
    expect(field(body, "headline")).toContain("Write a headline of up to 120 characters.");
    expect(field(body, "headline")).toMatch(/<input[^>]*aria-invalid="true"/);
    expect(field(body, "areas")).toContain("List up to 20 areas, each once and up to 40 characters.");
    expect(field(body, "areas")).toContain(`>${areas}</textarea>`);
    expect(field(body, "monthlyCapacity")).toContain("Choose a number from 0 to 20.");
    expect(field(body, "monthlyCapacity")).toMatch(/value="99"/);
    // What was posted, not what is saved.
    expect(body).toMatch(/<input[^>]*id="formats-QUICK_QUESTION"[^>]*checked=""|<input[^>]*checked=""[^>]*id="formats-QUICK_QUESTION"/);
    expect(body).toMatch(/<textarea[^>]*name="bio"[^>]*>Reviews APIs\.<\/textarea>/);
    expect(body).toMatch(/<input[^>]*name="paused"[^>]*checked=""|<input[^>]*checked=""[^>]*name="paused"/);
    // The listing still says what is saved.
    expect(body).toMatch(/data-listing="listed"/);
  });

  it("asks for at least one format", async () => {
    seeded();
    const { status, body } = await visit({ method: "POST", form: { ...FORM, formats: [] } });
    expect(status).toBe(400);
    expect(body).toContain("One thing to fix before this can be saved");
    expect(body).toMatch(/<fieldset data-field="formats" data-invalid="true"[\s\S]*?Offer at least one way to help\./);
  });

  it("refuses a cross-site post (403) and writes nothing", async () => {
    const sqlite = seeded();
    const before = profile(sqlite);
    for (const origin of ["https://attacker.invalid", null]) {
      const { status } = await visit({ method: "POST", form: FORM, origin });
      expect(status).toBe(403);
    }
    expect(profile(sqlite)).toEqual(before);
  });

  it("answers any other method 405", async () => {
    seeded();
    const { status, headers } = await visit({ method: "PUT", form: FORM });
    expect(status).toBe(405);
    expect(headers.get("Allow")).toBe("GET, HEAD, POST");
  });

  it("does not exist while mentor_requests is off", async () => {
    const sqlite = seeded();
    sqlite.exec("UPDATE feature_flag SET audience='OFF' WHERE key='mentor_requests'");
    expect((await visit()).status).toBe(404);
    expect((await visit({ method: "POST", form: FORM })).status).toBe(404);
  });
});
