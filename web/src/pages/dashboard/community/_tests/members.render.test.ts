import { readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRaw } from "@/lib/attention/test-support";
import { memberCards, memberProfiles } from "@/components/platform/members/fixtures";

/*
 * The Members directory and a member's page, through the real middleware and the pages, on SQLite with
 * every migration for the spaces context. The directory's reads are the backend's
 * (src/lib/members/directory.ts, tested there); here they are mocked, to pin what the pages ask for and
 * how they show every answer: a page of people, none, a later page, a failure, and a null profile.
 */
const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>, getSession: vi.fn(), listMembers: vi.fn(), readMember: vi.fn(), readOwnMemberCard: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});
vi.mock("@/lib/members/directory", () => ({
  listMembers: mocks.listMembers, readMember: mocks.readMember, readOwnMemberCard: mocks.readOwnMemberCard,
}));

const { onRequest } = await import("@/middleware");
const { default: Directory } = await import("../members/index.astro");
const { default: Profile } = await import("../members/[handle].astro");

const STUDENT = "synthetic-wanjiku";
const INSTITUTION = "synthetic-joseph";
const ORIGIN = "https://ttv.invalid";
const PATH = "/dashboard/community/members";
const NAMES: Record<string, string> = { [STUDENT]: "Wanjiku Mwangi", [INSTITUTION]: "Joseph Mutua" };
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seeded({ spaces = "ALL" }: { spaces?: "ALL" | "OFF" } = {}) {
  const { database: sqlite, db } = createSqliteD1();
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`${Object.entries(NAMES).map(([id, name]) => `INSERT INTO user(id,name,email) VALUES ('${id}','${name}','${id}@example.test');`).join("\n")}
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'role-joseph','${INSTITUTION}',id FROM Roles WHERE name='INSTITUTION';
    UPDATE feature_flag SET audience='ALL';
    UPDATE feature_flag SET audience='${spaces}' WHERE key='spaces';`);
  Object.assign(mocks.env, { DB: withRaw(sqlite, db), DEPLOYMENT_ENVIRONMENT: "production" });
  return sqlite;
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  mocks.listMembers.mockReset().mockResolvedValue({ members: [memberCards.achieng, memberCards.kevin], nextCursor: null, total: 2 });
  mocks.readOwnMemberCard.mockReset().mockResolvedValue(memberCards.faith);
  mocks.readMember.mockReset().mockResolvedValue(memberProfiles.achieng);
});

/** One signed-in request through the middleware and a page. */
async function visit(path: string, init: { method?: string; user?: string } = {}) {
  const { method = "GET", user: id = STUDENT } = init;
  const url = new URL(path, ORIGIN);
  const handle = /^\/dashboard\/community\/members\/([^/?]+)/.exec(url.pathname)?.[1];
  const request = () => new Request(url, { method, headers: { Origin: ORIGIN } });
  const user = { id, name: NAMES[id], email: `${id}@example.test`, image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${id}-session`, userId: id, userAgent: "Mozilla/5.0" } });
  const locals = {} as App.Locals;
  const params = handle ? { handle } : {};
  const context = {
    url, request: request(), locals, params,
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () =>
    container.renderToResponse(handle ? Profile : Directory, { request: request(), locals, params })) as Response;
  return { status: response.status, headers: response.headers, body: await response.text() };
}

const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;
const islands = (body: string) => [...body.matchAll(/<astro-island[^>]*component-url="([^"]+)"/g)].map(([, url]) => url).toSorted();
/** The page's own part: from its directory wrapper to the end of the main region. */
const page = (body: string) => /<div class="member-directory[\s\S]*?(?=<\/main>)/.exec(body)?.[0] ?? "";

describe("the Members directory", () => {
  it("renders on the server with no island of its own, one h1, the caller's card and a fair, unranked list", async () => {
    seeded();
    const { status, headers, body } = await visit(PATH);
    expect(status).toBe(200);
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(islands(body)).toEqual(["@/components/platform/overlays/PlatformOverlays", "@/components/platform/shell/SpacesShell"]);
    expect(count(body, /<h1[\s>]/g)).toBe(1);
    const own = page(body);
    expect(own).toMatch(/<h1[^>]*>Members<\/h1>/);
    expect(own).toContain("Only people signed in to TTV can see this page.");
    expect(own).toMatch(/data-member-you="listed"/);
    expect(own).toMatch(/<h2 id="member-results"[^>]*>2 members<\/h2>/);
    expect(own).toContain("The order changes every day, so no one is always first.");
    expect(count(own, /data-member-card=/g)).toBe(2);
    expect(own.indexOf('data-member-card="achieng-otieno"')).toBeLessThan(own.indexOf('data-member-card="kevin-omondi"'));
    // One page: no pager. Nothing peach, since the caller is listed already.
    expect(own).not.toContain("data-member-pager");
    expect(count(own, /data-variant="primary"/g)).toBe(0);
    // The Members entry is current in the Community sidebar.
    expect(body).toMatch(/<a[^>]*href="\/dashboard\/community\/members"[^>]*aria-current="page"/);
    // The reads are asked as the caller, with no filters.
    expect(mocks.listMembers).toHaveBeenCalledOnce();
    expect(mocks.listMembers.mock.calls[0]!.slice(1)).toEqual([{ id: STUDENT, isAdmin: false }, {}]);
    expect(mocks.readOwnMemberCard.mock.calls[0]!.slice(1)).toEqual([{ id: STUDENT, isAdmin: false }]);
  });

  it("asks the way to be listed when the caller is not, as the page's one peach action", async () => {
    seeded();
    mocks.readOwnMemberCard.mockResolvedValue(null);
    const own = page((await visit(PATH)).body);
    expect(own).toMatch(/data-member-you="unlisted"/);
    expect(count(own, /data-variant="primary"/g)).toBe(1);
    expect(own).toContain("Open your profile");
  });

  it("passes the address's filters and page to the read, and links the next page with what came before", async () => {
    seeded();
    mocks.listMembers.mockResolvedValue({ members: [memberCards.kevin], nextCursor: "after-kevin", total: 30 });
    const { body } = await visit(`${PATH}?q=%20backend%20&skills=Python,%20django&open=roles&cursor=after-faith&seen=24`);
    expect(mocks.listMembers.mock.calls[0]![2]).toEqual({ q: "backend", skills: ["Python", "django"], openTo: "roles", cursor: "after-faith" });
    const own = page(body);
    // A later page of a search: no "You" card, the filters kept, a way back to the first page and on to the next.
    expect(own).not.toContain("data-member-you");
    expect(own).toMatch(/<h2 id="member-results"[^>]*>30 members match<\/h2>/);
    expect(own).toContain('value="Python, django"');
    expect(own).toContain(">Clear filters</a>");
    const link = (rel: string) => new RegExp(`<a [^>]*rel="${rel}"[^>]*>`).exec(own)?.[0] ?? "";
    expect(link("first")).toContain(`href="${PATH}?q=backend&amp;skills=Python%2C+django&amp;open=roles#member-results"`);
    expect(link("next")).toContain(`href="${PATH}?q=backend&amp;skills=Python%2C+django&amp;open=roles&amp;cursor=after-kevin&amp;seen=25#member-results"`);
    expect(own).toContain("25 of 30");
  });

  it("says when a search finds no one, and the way back to everyone", async () => {
    seeded();
    mocks.listMembers.mockResolvedValue({ members: [], nextCursor: null, total: 0 });
    const own = page((await visit(`${PATH}?skills=COBOL`)).body);
    expect(own).toMatch(/data-empty-state[\s\S]*No members match this search/);
    expect(own).toMatch(new RegExp(`href="${PATH}#member-results"[^>]*>Show everyone`));
    expect(own).not.toContain("The order changes every day");
  });

  it("says when no one is listed yet", async () => {
    seeded();
    mocks.listMembers.mockResolvedValue({ members: [], nextCursor: null, total: 0 });
    const own = page((await visit(PATH)).body);
    expect(own).toMatch(/<h2 id="member-results"[^>]*>0 members<\/h2>/);
    expect(own).toContain("No one else is listed yet");
  });

  it("says a failed read is one, with a 503, records it, and shows no list", async () => {
    const sqlite = seeded();
    mocks.listMembers.mockRejectedValue(new Error("D1 is unavailable"));
    const { status, body } = await visit(PATH);
    expect(status).toBe(503);
    expect(body).toMatch(/<title>Error: Members/);
    const own = page(body);
    expect(own).toContain('data-notice="danger"');
    expect(own).toContain("We couldn&#x27;t load the members");
    expect(own).not.toContain("data-member-card");
    expect(own).not.toContain("data-member-filters");
    expect(sqlite.prepare('SELECT route FROM "errorEvent"').all()).toEqual([expect.objectContaining({ route: PATH })]);
  });

  it("shows institutions the same list, with a quiet way to Discover's tools that others don't get", async () => {
    seeded();
    const institution = page((await visit(PATH, { user: INSTITUTION })).body);
    expect(count(institution, /data-member-card=/g)).toBe(2);
    expect(institution).toMatch(/data-member-discover[\s\S]*href="\/dashboard\/discover"/);
    expect(page((await visit(PATH)).body)).not.toContain("data-member-discover");
    expect(mocks.listMembers.mock.calls.map((call) => call[1])).toEqual([{ id: INSTITUTION, isAdmin: false }, { id: STUDENT, isAdmin: false }]);
  });

  it("answers only GET and HEAD, and is not there without the spaces flag", async () => {
    seeded();
    const post = await visit(PATH, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("Allow")).toBe("GET, HEAD");
    seeded({ spaces: "OFF" });
    expect((await visit(PATH)).status).toBe(404);
    expect((await visit(`${PATH}/achieng-otieno`)).status).toBe(404);
  });
});

describe("a member's page", () => {
  it("shows the member with their work, asked for by handle as the caller", async () => {
    seeded();
    const { status, body } = await visit(`${PATH}/achieng-otieno`);
    expect(status).toBe(200);
    expect(mocks.readMember.mock.calls[0]!.slice(1)).toEqual([{ id: STUDENT, isAdmin: false }, "achieng-otieno"]);
    expect(count(body, /<h1[\s>]/g)).toBe(1);
    expect(body).toMatch(/<h1 id="member-name"[^>]*>Achieng Otieno<\/h1>/);
    expect(body).toMatch(/<title>Achieng Otieno/);
    expect(count(body, /data-member-work=/g)).toBe(2);
    expect(body).toMatch(/<a[^>]*href="\/dashboard\/community\/members"[^>]*aria-current="page"/);
    expect(islands(body)).toEqual(["@/components/platform/overlays/PlatformOverlays", "@/components/platform/shell/SpacesShell"]);
  });

  it("answers the same 404 for anyone it can't show, and never reads a handle out of shape", async () => {
    seeded();
    mocks.readMember.mockResolvedValue(null);
    const missing = await visit(`${PATH}/someone-hidden`);
    expect(missing).toMatchObject({ status: 404, body: "Not found." });
    expect(missing.headers.get("Cache-Control")).toBe("no-store");
    mocks.readMember.mockClear();
    for (const path of [`${PATH}/Achieng`, `${PATH}/achieng-`, `${PATH}/a%2Fb`, `${PATH}/achieng/work`]) {
      expect((await visit(path)).status, `${path}`).toBe(404);
    }
    expect(mocks.readMember).not.toHaveBeenCalled();
  });

  it("says a failed read is one, with a 503 and the way back", async () => {
    seeded();
    mocks.readMember.mockRejectedValue(new Error("D1 is unavailable"));
    const { status, body } = await visit(`${PATH}/achieng-otieno`);
    expect(status).toBe(503);
    expect(count(body, /<h1[\s>]/g)).toBe(1);
    expect(body).toContain("We couldn&#x27;t load this profile");
    expect(body).toMatch(/data-back-link[^>]*>|href="\/dashboard\/community\/members"[^>]*data-back-link/);
  });
});
