import { readdirSync } from "node:fs";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

/*
 * /admin/programs/new on the style guide: the kit form, and creating a cohort against the real
 * schema in SQLite. Creating one from the cohorts list is e2e/admin-curricula.spec.ts.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));

const { default: Page } = await import("../programs/new.astro");

const PATH = "/admin/programs/new";
const databases: { close(): void }[] = [];
let sqlite: ReturnType<typeof createSqliteD1>["database"];

function seed({ curricula = true } = {}) {
  const { database, db } = createSqliteD1();
  databases.push(database);
  for (const file of readdirSync(new URL("../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  if (curricula) database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Full-stack foundations','Test');`);
  sqlite = database;
  mocks.env.DB = db;
}
beforeEach(() => seed());
afterEach(() => databases.splice(0).forEach((database) => database.close()));

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

const setCookies = (response: Response): string[] => {
  const cookies = Reflect.get(response, Symbol.for("astro.cookies")) as { consume(): Iterable<string> } | undefined;
  return [...response.headers.getSetCookie(), ...(cookies ? cookies.consume() : [])];
};
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
async function visit(form?: Record<string, string>) {
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid${PATH}`, form ? { method: "POST", body: new URLSearchParams(form), headers: FORM } : undefined),
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  return { response, status: response.status, location: response.headers.get("location"), body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;
const cohorts = () => sqlite.prepare("SELECT id, name, description, curriculumId, startDate, endDate, applicationsOpen FROM program").all() as Record<string, unknown>[];
const APOSTROPHE = "(?:&#39;|&#x27;|')";
const COHORT = { name: "Cohort 06", description: "Full-stack, evenings.", curriculumId: "curriculum", startDate: "2027-01-11", endDate: "2027-04-02" };

describe("a new cohort on the style guide", () => {
  it("is one kit form with one primary, under a back link and one display title", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<a href="\/admin\/programs" data-back-link[^>]*>[\s\S]*?<span>Cohorts<\/span><\/a>[\s\S]*?<h1 [^>]*>New cohort<\/h1>/);
    expect(body).toMatch(/<form method="POST" action="\/admin\/programs\/new" class="grid gap-5" data-cohort-form>/);
    expect(body).toMatch(/<option value="" selected="">Choose a curriculum<\/option><option value="curriculum">Full-stack foundations<\/option>/);
    expect(body).toMatch(/<input (?=[^>]*name="startDate")(?=[^>]*type="date")[^>]*>/);
    expect(body).toMatch(/<input (?=[^>]*name="applicationsOpen")(?=[^>]*type="checkbox")(?=[^>]*value="true")(?![^>]*checked)[^>]*>/);
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/data-variant="primary"[^>]*>Create cohort<\/button>/);
    expect(body).not.toMatch(/text-white|\btext-primary\b|text-red-|bg-red-|form-control|data-card="legacy"|Create Cohort|Start Date|Name \*/);
  });

  it("creates the cohort, closed unless ticked, with a 303 and a flash on its page", async () => {
    const closed = await visit(COHORT);
    expect(closed.status).toBe(303);
    const [row] = cohorts();
    expect(closed.location).toBe(`/admin/programs/${row.id}`);
    expect(row).toMatchObject({ name: "Cohort 06", description: "Full-stack, evenings.", curriculumId: "curriculum", startDate: Date.UTC(2027, 0, 11) / 1000, endDate: Date.UTC(2027, 3, 2) / 1000, applicationsOpen: 0 });
    const flash = decodeURIComponent(setCookies(closed.response)[0]);
    expect(flash).toContain('"title":"Cohort created"');
    expect(flash).toContain("Applications are closed until you open them.");

    const open = await visit({ ...COHORT, name: "Cohort 07", applicationsOpen: "true" });
    expect(open.status).toBe(303);
    expect(cohorts().find((cohort) => cohort.name === "Cohort 07")?.applicationsOpen).toBe(1);
    expect(decodeURIComponent(setCookies(open.response)[0])).toContain("Applications are open.");
  });

  it("refuses a bad cohort with a 400 that keeps every value, an error under each field and a focused danger Notice", async () => {
    const { status, body } = await visit({ name: "   ", description: "Kept description.", curriculumId: "missing", startDate: "2027-04-02", endDate: "2027-01-11", applicationsOpen: "true" });
    expect(status).toBe(400);
    expect(body).toMatch(/data-title-prefix="Error: "/);
    expect(body).toMatch(new RegExp(`<div (?=[^>]*autofocus="")(?=[^>]*role="alert")[^>]*data-notice="danger"[\\s\\S]*?The cohort wasn${APOSTROPHE}t created[\\s\\S]*?Fix the fields marked below\\.`));
    expect(body).toContain("Enter a cohort name.");
    expect(body).toContain("End date must be on or after start date.");
    expect(body).toMatch(/<input (?=[^>]*name="name")(?=[^>]*aria-invalid="true")[^>]*value="   "/);
    expect(body).toContain("Kept description.</textarea>");
    expect(body).toMatch(/<input (?=[^>]*name="applicationsOpen")(?=[^>]*checked="")[^>]*>/);
    expect(cohorts()).toEqual([]);
  });

  it("answers 503 in words when the database fails, keeping what was written", async () => {
    sqlite.exec("CREATE TRIGGER no_cohorts BEFORE INSERT ON program BEGIN SELECT RAISE(ABORT, 'D1 down'); END;");
    const { status, body } = await visit(COHORT);
    expect(status).toBe(503);
    expect(body).toMatch(new RegExp(`The database didn${APOSTROPHE}t answer, so the cohort wasn${APOSTROPHE}t created\\.`));
    expect(body).toMatch(/<input (?=[^>]*name="name")[^>]*value="Cohort 06"/);
  });

  it("asks for a curriculum first when there is none, with the way to make one as the one primary", async () => {
    seed({ curricula: false });
    const { body } = await visit();
    expect(body).toMatch(/data-empty-state[\s\S]*?Create a curriculum first[\s\S]*?<a href="\/admin\/curricula\/new" data-variant="primary"[^>]*>New curriculum<\/a>/);
    expect(body).not.toContain("data-cohort-form");
    const refused = await visit(COHORT);
    expect(refused.status).toBe(400);
    expect(refused.body).toContain("Create a curriculum before creating a cohort.");
    expect(cohorts()).toEqual([]);
  });
});
