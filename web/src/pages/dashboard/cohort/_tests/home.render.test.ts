import { readFileSync, readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { Window } from "happy-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRaw } from "@/lib/attention/test-support";

/*
 * /dashboard/cohort, the Cohort space's overview, on the style guide: the next step is the one peach
 * action, with no eyebrow over it; the h1 comes before onboarding's cards, which are kit cards whose
 * state is a chip in words, never the mentor colour; every card is the kit's one surface. Through the
 * real middleware and page (dashboard/index.astro) on SQLite with every migration; authentication is
 * mocked. The browser journeys are e2e/student-dashboard-journeys.spec.ts, dashboard-greeting.spec.ts
 * and platform-onboarding-framing.spec.ts.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../../index.astro");

const STUDENT = "synthetic-wanjiku";
const ORIGIN = "https://ttv.invalid";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seeded(extra = "") {
  const { database: sqlite, db } = createSqliteD1();
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES ('cohort-a','Cohort 07','Test','curriculum',0,4102444800);
    INSERT INTO user(id,name,email) VALUES ('${STUDENT}','Wanjiku Njeri','wanjiku@example.test');
    INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('application','${STUDENT}','cohort-a','APPROVED','{}');
    UPDATE feature_flag SET audience='ALL';
    ${extra}`);
  Object.assign(mocks.env, { DB: withRaw(sqlite, db), DEPLOYMENT_ENVIRONMENT: "production" });
}

/** A mentor request still waiting, and an institution request approved and not yet seen. */
const REQUESTS = `INSERT INTO access_request (id, userId, role, status, note, createdAt, updatedAt)
    VALUES ('mentor', '${STUDENT}', 'MENTOR', 'PENDING', 'I review frontend work.', 1, 1);
  INSERT INTO access_request (id, userId, role, status, note, organisation, scopeAcknowledgedAt, decidedAt, createdAt, updatedAt)
    VALUES ('institution', '${STUDENT}', 'INSTITUTION', 'APPROVED', 'We hire junior developers.', 'Savanna Labs', 1, 2, 1, 2);
  INSERT INTO UserRoles(id,userId,roleId) SELECT 'institution-role','${STUDENT}',id FROM Roles WHERE name='INSTITUTION';`;

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

/** One signed-in GET of the overview through the middleware and the page; `visited` sends the greeting's cookie. */
async function visit({ path = "/dashboard/cohort", visited = false } = {}) {
  const url = new URL(path, ORIGIN);
  const user = { id: STUDENT, name: "Wanjiku Njeri", email: "wanjiku@example.test", image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${STUDENT}-session`, userId: STUDENT, userAgent: "Mozilla/5.0" } });
  const headers = visited ? { cookie: `ttv-dashboard-visited=${STUDENT}` } : undefined;
  const locals = {} as App.Locals;
  const context = {
    url, request: new Request(url, { headers }), locals, params: {},
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () =>
    container.renderToResponse(Page, { request: new Request(url, { headers }), locals })) as Response;
  return { status: response.status, body: await response.text() };
}

/** Parsed with happy-dom: the render config runs in node, where Astro compiles. */
const dom = (html: string) => {
  const { document } = new Window();
  document.body.innerHTML = html;
  return document.body;
};

type Root = Pick<ReturnType<typeof dom>, "querySelectorAll">;
const main = (html: string) => dom(html).querySelector("#spaces-main")!;
const primaries = (root: Root) => [...root.querySelectorAll("a, button")].filter((control) =>
  control.getAttribute("data-variant") === "primary" || control.classList.contains("bg-primary"));

describe("the Cohort overview", () => {
  it("has the next step as its one peach action, even beside an approved request's card", async () => {
    seeded(REQUESTS);
    const { status, body } = await visit();
    expect(status).toBe(200);
    const page = main(body);
    const step = page.querySelector("section[aria-labelledby='next-step-title']");
    expect(step?.hasAttribute("data-card")).toBe(true);
    const [primary, ...others] = primaries(page);
    expect(others).toEqual([]);
    expect(step?.contains(primary!)).toBe(true);
    // The approved card's way in is quiet.
    const approved = page.querySelector("[data-onboarding-status='approved']");
    expect(approved?.querySelector("a")?.textContent?.trim()).toBe("Open Discover");
  });

  it("has no eyebrow: no uppercase tracked label, and no 'Your next step'", async () => {
    seeded();
    const page = main((await visit()).body);
    expect(page.textContent).not.toMatch(/your next step/i);
    expect(page.querySelectorAll(".uppercase")).toHaveLength(0);
    expect(page.innerHTML).not.toMatch(/tracking-\[/);
  });

  it("puts the h1 before onboarding's status cards", async () => {
    seeded(REQUESTS);
    const page = main((await visit()).body);
    const notices = page.querySelector("[data-onboarding-notices]");
    expect(notices).not.toBeNull();
    const h1 = page.querySelector("h1")!;
    expect(h1.textContent).toBe("Cohort");
    expect(Boolean(h1.compareDocumentPosition(notices!) & 4 /* DOCUMENT_POSITION_FOLLOWING */)).toBe(true);
    expect(page.querySelector("h1, h2, h3")).toBe(h1);
  });

  it("says a status card's state in a chip, on the kit card, never in ring (the mentor colour)", async () => {
    seeded(REQUESTS);
    const page = main((await visit()).body);
    const pending = page.querySelector("[data-onboarding-status='pending']")!;
    expect(pending.hasAttribute("data-card")).toBe(true);
    expect(pending.querySelector("[data-chip] [data-status]")?.textContent).toBe("In review");
    // Ring stays the mentor marker's own colour, never the card's tone.
    for (const card of page.querySelectorAll("[data-onboarding-status]")) {
      expect(card.className).not.toMatch(/\b(?:border|bg|from|to)-ring\b|bg-linear/);
      expect(card.querySelector("[data-chip]")?.className).not.toMatch(/ring/);
    }
  });

  it("draws every card as the kit's one surface: no dark holes, peach frames or white headings", async () => {
    seeded(REQUESTS);
    const page = main((await visit()).body);
    expect(page.querySelectorAll("[data-card]").length).toBeGreaterThanOrEqual(4);
    expect(page.querySelector("[data-channel-shortcuts] [data-card]")).not.toBeNull();
    expect(page.querySelector("section[aria-labelledby='dashboard-community-title']")?.hasAttribute("data-card")).toBe(true);
    expect(page.innerHTML).not.toMatch(/\bbg-dark\/80\b|\bborder-primary\/|\btext-white\b|\bshadow-lg\b|\btext-primary\b/);
    for (const h2 of page.querySelectorAll("h2")) expect(h2.className).not.toMatch(/font-(semibold|bold|body|display|heading)/);
  });

  it("greets a returning member in a line under the title, never a heading", async () => {
    seeded();
    const page = main((await visit({ visited: true })).body);
    const greeting = [...page.querySelectorAll("p")].find((line) => line.textContent === "Welcome back, Wanjiku");
    expect(greeting).toBeDefined();
    expect([...page.querySelectorAll("h1, h2")].some((heading) => heading.textContent?.includes("Welcome back"))).toBe(false);
  });

  it("has no flag-off branch of its own: no legacy title or older parts", () => {
    const source = readFileSync(new URL("../../index.astro", import.meta.url), "utf8");
    expect(source).not.toMatch(/legacyTag|legacyClass|legacyTitle|common\/(Card|Button)|spaces\/PageTitle/);
  });
});
