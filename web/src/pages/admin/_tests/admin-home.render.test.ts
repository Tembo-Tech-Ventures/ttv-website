import { readdirSync } from "node:fs";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

/*
 * /admin on the style guide: the page's markup, over SQLite with every migration (its counts are its
 * own queries). Its D1 round trips are round-trips.render.test.ts; the attention list's rules are
 * lib/admin/attention.test.ts.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));

const { default: Page } = await import("../index.astro");

const databases: { close(): void }[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seed(sql = "") {
  const { database, db } = createSqliteD1();
  databases.push(database);
  for (const file of readdirSync(new URL("../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO user(id,name,email) VALUES ('synthetic-admin','Amina Hassan','amina@example.test'),('synthetic-wanjiku','Wanjiku Njeri','wanjiku@example.test');
    INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES ('cohort-a','Cohort 07','Test','curriculum',0,4102444800);
    ${sql}`);
  Object.assign(mocks.env, { DB: db, DEPLOYMENT_ENVIRONMENT: "production" });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

async function visit() {
  const response = await container.renderToResponse(Page, {
    request: new Request("https://ttv.invalid/admin"),
    locals: { user: { id: "synthetic-admin", name: "Amina Hassan" }, isAdmin: true } as unknown as App.Locals,
  });
  return { status: response.status, body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;

describe("Admin home on the style guide", () => {
  it("has one display title, Maven h2 sections, and sentence-case totals on kit Cards", async () => {
    seed(`INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('application','synthetic-wanjiku','cohort-a','APPROVED','{}');`);
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<h1 [^>]*>Admin home<\/h1>/);
    for (const heading of ["Attention", "Totals", "Follow-up", "Applications by status"]) {
      expect(body).toMatch(new RegExp(`<h2 id="[^"]+" class="[^"]*">${heading}</h2>`));
    }
    expect(body).toMatch(/>Users<\/p><p class="[^"]*text-ink-primary">2<\/p>/);
    expect(body).toMatch(/>Applications<\/p><p class="[^"]*">1<\/p>/);
    expect(body).toMatch(/>Cohorts<\/p><p class="[^"]*">1<\/p>/);
    expect(count(body, /data-card/g)).toBeGreaterThanOrEqual(10);
    expect(body).not.toMatch(/Total Users|Applications by Status|text-white|divide-white|\btext-primary\b|outline-primary/);
  });

  it("names an approved application as accepted, one word per status", async () => {
    seed(`INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('application','synthetic-wanjiku','cohort-a','APPROVED','{}');`);
    const { body } = await visit();
    const statuses = /<h2 id="applications-heading"[\s\S]*?<\/section>/.exec(body)?.[0] ?? "";
    expect([...statuses.matchAll(/<p class="text-sm text-ink-secondary">([^<]+)<\/p>/g)].map((match) => match[1]))
      .toEqual(["Pending", "Accepted", "Rejected", "Audit", "Completed"]);
    expect(statuses).not.toMatch(/capitalize|approved/i);
  });

  it("says what fills an empty attention list, and links to follow-up with full targets", async () => {
    seed();
    const { body } = await visit();
    expect(body).toMatch(/data-empty-state[\s\S]*?<h3[^>]*>Nothing needs you right now<\/h3>/);
    expect(body).toMatch(/<a href="\/admin\/profiles#moderation" class="[^"]*min-h-11[^"]*text-peach-ink[^"]*">\s*View flagged profiles/);
    expect(body).toMatch(/<a href="\/admin\/projects\?status=PENDING" class="[^"]*min-h-11[^"]*">\s*View pending projects/);
  });

  it("dates attention items as voice.md does", async () => {
    seed(`INSERT INTO access_request(id,userId,role,status,note,createdAt,updatedAt) VALUES
      ('request','synthetic-wanjiku','MENTOR','PENDING','Backend reviews: SQL, APIs and tests.',${Date.UTC(2026, 10, 3, 9, 13)},${Date.UTC(2026, 10, 3, 9, 13)});`);
    const { body } = await visit();
    expect(body).toMatch(/<time datetime="[^"]+" class="[^"]*">3 Nov, 0?9:13 UTC<\/time>/);
  });
});
