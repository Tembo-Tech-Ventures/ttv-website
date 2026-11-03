/**
 * PERF-2 regression: the D1 reads a representative spaces and admin GET make before and while they
 * render, through the real middleware and the real page, on SQLite with every migration. Each D1 call
 * answers on a later macrotask (d1-round-trips.ts), so `depth` (round trips one after another) is
 * deterministic. Authentication is mocked, so its reads (session and user: two in production) are
 * not counted here. Raise a budget only with a reason: each round trip costs a visitor far from D1
 * 200–300 ms (web/docs/performance.md).
 */
import { readdirSync } from "node:fs";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRoundTrips } from "@/test/d1-round-trips";
import { withRaw } from "@/lib/attention/test-support";

const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", () => ({ createAuth: () => ({ api: { getSession: mocks.getSession } }) }));

const { onRequest } = await import("@/middleware");
const { tracePerf } = await import("@/lib/observability/perf-trace");

const STUDENT = "synthetic-wanjiku";
const ADMIN = "synthetic-amina";
const databases: { close(): void }[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seeded() {
  const { database: sqlite, db } = createSqliteD1();
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES ('cohort-a','Cohort 07','Test','curriculum',0,4102444800);
    INSERT INTO user(id,name,email) VALUES ('${STUDENT}','Wanjiku Njeri','wanjiku@example.test'),('${ADMIN}','Amina Hassan','amina@example.test');
    INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('application','${STUDENT}','cohort-a','APPROVED','{}');
    INSERT OR IGNORE INTO Roles(id,name) VALUES ('ADMIN','ADMIN');
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'admin-role','${ADMIN}',id FROM Roles WHERE name='ADMIN';
    UPDATE feature_flag SET audience='ALL';`);
  const cohortChannel = sqlite.prepare("SELECT slug FROM channel WHERE kind='COHORT' AND programId='cohort-a' ORDER BY position LIMIT 1").get() as { slug: string };
  return { db: withRoundTrips(withRaw(sqlite, db)), cohortChannel: cohortChannel.slug };
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

const PAGES = {
  "cohort overview": { path: () => "/dashboard/cohort", page: () => import("@/pages/dashboard/index.astro"), user: STUDENT },
  "cohort channel": { path: (slug: string) => `/dashboard/cohort/c/${slug}`, page: () => import("@/pages/dashboard/cohort/c/[slug].astro"), user: STUDENT },
  community: { path: () => "/dashboard/community", page: () => import("@/pages/dashboard/community.astro"), user: STUDENT },
  mentors: { path: () => "/dashboard/community/mentors", page: () => import("@/pages/dashboard/community/mentors.astro"), user: STUDENT },
  ask: { path: () => "/dashboard/cohort/ask", page: () => import("@/pages/dashboard/ask.astro"), user: STUDENT },
  "admin home": { path: () => "/admin", page: () => import("@/pages/admin/index.astro"), user: ADMIN },
  account: { path: () => "/dashboard/account", page: () => import("@/pages/dashboard/profile.astro"), user: STUDENT },
  "admin users": { path: () => "/admin/users", page: () => import("@/pages/admin/users/index.astro"), user: ADMIN },
  "admin applications": { path: () => "/admin/applications", page: () => import("@/pages/admin/applications/index.astro"), user: ADMIN },
} as const;
type PageName = keyof typeof PAGES;

/** One signed-in GET through the middleware and the page, traced to the end of its body. */
async function visit(name: PageName) {
  const { db, cohortChannel } = seeded();
  Object.assign(mocks.env, { DB: db, DEPLOYMENT_ENVIRONMENT: "production" });
  const { path, page, user: userId } = PAGES[name];
  const user = { id: userId, name: "Synthetic", email: `${userId}@example.test`, image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${userId}-session`, userId, userAgent: "Mozilla/5.0" } });
  const { default: Page } = await page();
  const url = new URL(path(cohortChannel), "https://ttv.invalid");
  const locals = {} as App.Locals;
  const context = {
    url, request: new Request(url), locals, params: { slug: cohortChannel },
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const { result, summary } = await tracePerf(db, async () => {
    const response = await onRequest(context as never, async () =>
      container.renderToResponse(Page, { request: new Request(url), locals, params: { slug: cohortChannel } })) as Response;
    return { status: response.status, body: await response.text() };
  });
  return { ...result, summary };
}

/**
 * Queries and round trips (depth) per page, auth excluded. Before PERF-2 (main at #329) this test
 * measured, in this order: 23/10, 22/9, 22/9, 26/9, 23/8, 23/14, 19/6, 18/8 and 18/8.
 */
const BUDGETS: Record<PageName, { d1: number; depth: number }> = {
  "cohort overview": { d1: 16, depth: 3 },
  "cohort channel": { d1: 16, depth: 4 },
  community: { d1: 16, depth: 3 },
  mentors: { d1: 20, depth: 3 },
  ask: { d1: 14, depth: 3 },
  "admin home": { d1: 19, depth: 3 },
  account: { d1: 16, depth: 3 },
  "admin users": { d1: 14, depth: 3 },
  "admin applications": { d1: 14, depth: 3 },
};

describe("D1 round trips per page (PERF-2)", () => {
  it.each(Object.keys(PAGES) as PageName[])("%s stays within its budget", async (name) => {
    const { status, body, summary } = await visit(name);
    if (process.env.PERF_PRINT) {
      console.log(`${name}: ${summary.d1} queries, depth ${summary.depth}`);
      for (const query of summary.queries ?? []) console.log(`  ${query.depth} ${query.phase} ${query.sql.slice(0, 120)}`);
    }
    expect({ status, start: status === 200 ? "" : body.slice(0, 300) }).toEqual({ status: 200, start: "" });
    expect(body).toContain("data-space");
    // No read twice: the same statement in one request would be a duplicate round trip (PERF-2 step 6).
    const statements = (summary.queries ?? []).map((query) => query.statement);
    expect(statements.filter((sql, index) => statements.indexOf(sql) !== index)).toEqual([]);
    expect({ d1: summary.d1, depth: summary.depth }).toEqual({
      d1: Math.min(summary.d1, BUDGETS[name].d1), depth: Math.min(summary.depth, BUDGETS[name].depth),
    });
  }, 60_000);
});
