import { readdirSync } from "node:fs";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

/*
 * /admin/data-migration on the style guide: a server form with no script. An export is reviewed
 * and imported against the real schema in SQLite.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));

const { default: Page } = await import("../data-migration.astro");

const PATH = "/admin/data-migration";
const EXPORT = {
  version: 1,
  exportedAt: "2026-08-01T12:00:00.000Z",
  users: [
    { id: "legacy-1", name: "Wanjiku Mwangi", email: "wanjiku@example.test" },
    { id: "legacy-2", name: "Brian Otieno", email: "brian@example.test" },
  ],
  roles: [{ id: "role-admin", name: "ADMIN" }],
};
const databases: { close(): void }[] = [];
let sqlite: ReturnType<typeof createSqliteD1>["database"];

beforeEach(() => {
  const { database, db } = createSqliteD1();
  databases.push(database);
  for (const file of readdirSync(new URL("../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  sqlite = database;
  Object.assign(mocks.env, { DB: db, DEPLOYMENT_ENVIRONMENT: "staging" });
});
afterEach(() => databases.splice(0).forEach((database) => database.close()));

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

const setCookies = (response: Response): string[] => {
  const cookies = Reflect.get(response, Symbol.for("astro.cookies")) as { consume(): Iterable<string> } | undefined;
  return [...response.headers.getSetCookie(), ...(cookies ? cookies.consume() : [])];
};
type Locals = Record<string, unknown>;
async function visit({ form, locals = {} }: { form?: Record<string, string | File>; locals?: Locals } = {}) {
  let body: FormData | undefined;
  if (form) {
    body = new FormData();
    for (const [name, value] of Object.entries(form)) body.set(name, value);
  }
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid${PATH}`, body ? { method: "POST", body } : undefined),
    locals: { user: { id: "synthetic-admin" }, isAdmin: true, personalAccessToken: null, session: { userAgent: "Mozilla/5.0" }, ...locals } as unknown as App.Locals,
  });
  return { response, status: response.status, location: response.headers.get("location"), body: await response.text() };
}
const file = (value: unknown) => new File([typeof value === "string" ? value : JSON.stringify(value)], "export.json", { type: "application/json" });
const users = () => (sqlite.prepare(`SELECT count(*) AS n FROM "user"`).get() as { n: number }).n;
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;
const APOSTROPHE = "(?:&#39;|&#x27;|')";
const AGENT = { session: { userAgent: "ttv-agent:preview" } };

describe("data migration on the style guide", () => {
  it("is a server form with a kit file field, Notices and one primary, and no script", async () => {
    const { status, body, response } = await visit();
    expect(status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<h1 [^>]*>Data migration<\/h1>/);
    expect(body).toMatch(/data-notice="warning"[\s\S]*?Migration testing only/);
    expect(body).toMatch(/data-testid="privilege-import-policy"><div[^>]*data-notice="info"[\s\S]*?Privilege data is always ignored/);
    expect(body).toMatch(/<form method="POST" action="\/admin\/data-migration" enctype="multipart\/form-data"[^>]*data-review-form>/);
    expect(body).toMatch(/<input (?=[^>]*name="export")(?=[^>]*type="file")(?=[^>]*accept="\.json,application\/json")[^>]*>/);
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/data-variant="primary"[^>]*>Review export<\/button>/);
    expect(body).not.toMatch(/<script|text-white|\btext-primary\b|bg-(red|amber|sky|green|white)|text-(red|amber|sky|green|emerald)-|file:bg-primary|Data Migration|Import Data|Upload Export File|agent-import-warning/);
  });

  it("reviews an export without writing anything, and offers to import what it found as the view's one primary", async () => {
    const { status, body } = await visit({ form: { action: "review", export: file(EXPORT) } });
    expect(status).toBe(200);
    expect(users()).toBe(0);
    const preview = /data-preview>([\s\S]*?)<\/section>/.exec(body)?.[1] ?? "";
    expect(preview).toMatch(/<dt[^>]*>Version<\/dt><dd[^>]*>1<\/dd>/);
    expect(preview).toMatch(/<dt[^>]*>Exported<\/dt><dd[^>]*>1 Aug 2026, 15:00<\/dd>/);
    expect(preview).toMatch(/<dt[^>]*>To import<\/dt><dd[^>]*>2 records<\/dd>/);
    expect(preview).toMatch(/<dt[^>]*>Ignored privilege records<\/dt><dd[^>]*>1 record<\/dd>/);
    expect(preview).toMatch(/<caption[^>]*>Records in this export<\/caption>/);
    expect(preview).toMatch(/Users<\/td><td[^>]*>Checked, then imported<\/td><td[^>]*>2<\/td>/);
    expect(preview).toMatch(/Roles<\/td><td[^>]*>Always ignored<\/td><td[^>]*>1<\/td>/);
    expect(preview).toMatch(/<input type="hidden" name="action" value="import"\/?><input type="hidden" name="exportText" value="\{&quot;version&quot;:1/);
    expect(preview).toMatch(/data-variant="primary"[^>]*>Import 2 records<\/button><a href="\/admin\/data-migration" data-variant="ghost"[^>]*>Choose another file<\/a>/);
    expect(count(body, /data-variant="primary"/g)).toBe(1);
  });

  it("imports what was reviewed with a 303 and a flash that says what changed", async () => {
    const { status, location, response } = await visit({ form: { action: "import", exportText: JSON.stringify(EXPORT) } });
    expect({ status, location }).toEqual({ status: 303, location: PATH });
    expect(users()).toBe(2);
    const flash = decodeURIComponent(setCookies(response)[0]);
    expect(flash).toContain('"title":"Import complete"');
    expect(flash).toContain("2 rows changed, 0 already there and skipped, 1 privilege records ignored. Changed: users 2.");
  });

  it("refuses a bad file or a refused export with a 400 and a focused danger Notice in words", async () => {
    const notJson = await visit({ form: { action: "review", export: file("{ nope") } });
    expect(notJson.status).toBe(400);
    expect(notJson.body).toMatch(/data-title-prefix="Error: "/);
    expect(notJson.body).toMatch(new RegExp(`<div (?=[^>]*autofocus="")(?=[^>]*role="alert")[^>]*data-notice="danger"[\\s\\S]*?The export wasn${APOSTROPHE}t reviewed[\\s\\S]*?That file isn${APOSTROPHE}t JSON\\.`));

    const empty = await visit({ form: { action: "review", export: file({ version: 1, exportedAt: "2026-08-01T12:00:00.000Z" }) } });
    expect(empty.status).toBe(400);
    expect(empty.body).toMatch(new RegExp(`The export can${APOSTROPHE}t be imported[\\s\\S]*?no records were found`));

    const nothing = await visit({ form: { action: "review" } });
    expect(nothing.status).toBe(400);
    expect(nothing.body).toContain("Choose the legacy JSON export to review.");
    expect(users()).toBe(0);
  });

  it("answers 503 in words when the database fails, with nothing imported", async () => {
    sqlite.exec(`CREATE TRIGGER no_users BEFORE INSERT ON "user" BEGIN SELECT RAISE(ABORT, 'D1 down'); END;`);
    const { status, body } = await visit({ form: { action: "import", exportText: JSON.stringify(EXPORT) } });
    expect(status).toBe(503);
    expect(body).toContain("The import failed without applying any changes.");
    expect(users()).toBe(0);
  });

  it("lets an agent session review but not import, and refuses a personal access token outright", async () => {
    const page = await visit({ locals: AGENT });
    expect(page.body).toMatch(/data-testid="agent-import-warning"[\s\S]*?cannot run a legacy import/);
    const review = await visit({ form: { action: "review", export: file(EXPORT) }, locals: AGENT });
    expect(review.status).toBe(200);
    expect(review.body).toContain("Import unavailable for agent sessions");
    expect(review.body).not.toContain('name="exportText"');
    const imported = await visit({ form: { action: "import", exportText: JSON.stringify(EXPORT) }, locals: AGENT });
    expect(imported.status).toBe(403);
    expect(users()).toBe(0);

    for (const form of [undefined, { action: "import", exportText: JSON.stringify(EXPORT) }]) {
      const token = await visit({ form, locals: { personalAccessToken: { id: "pat" } } });
      expect(token.status).toBe(403);
    }
    expect(users()).toBe(0);
  });

  it("says the import is unavailable outside staging and previews, and refuses a POST there", async () => {
    mocks.env.DEPLOYMENT_ENVIRONMENT = "production";
    const page = await visit();
    expect(page.body).toMatch(/data-testid="legacy-import-disabled"><div[^>]*data-notice="warning"[\s\S]*?Legacy import unavailable/);
    expect(page.body).not.toContain("data-review-form");
    const post = await visit({ form: { action: "import", exportText: JSON.stringify(EXPORT) } });
    expect(post.status).toBe(403);
    expect(users()).toBe(0);
  });
});
