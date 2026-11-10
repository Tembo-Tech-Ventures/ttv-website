import { readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { Window } from "happy-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRaw } from "@/lib/attention/test-support";

/*
 * /dashboard/me/writing on the style guide (S15): the sections are Maven h2s ("Drafts", "Published"),
 * not uppercase eyebrows; each post is a kit card with its state as a status chip and a row action
 * named for the post; "New post" is the one peach action, and an empty list has one too, in its empty
 * state, never two. A profile that isn't published sees what opens writing, and no post is read for
 * it. Through the real middleware and page on SQLite with every migration; authentication is mocked.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../writing/index.astro");

const BUILDER = "synthetic-achieng";
const ORIGIN = "https://ttv.invalid";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

const POSTS = `INSERT INTO blogPost(id,profileId,slug,title,contentMarkdown,status,readingMinutes,publishedAt,updatedAt) VALUES
    ('draft','profile','ledgers','What ledgers taught me','Fictional.','DRAFT',3,NULL,2),
    ('live','profile','first-cohort','My first cohort','Fictional.','PUBLISHED',5,1794000000,1);`;

function seeded({ status = "PUBLISHED", posts = POSTS }: { status?: "PUBLISHED" | "DRAFT"; posts?: string } = {}) {
  const { database: sqlite, db } = createSqliteD1();
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO user(id,name,email) VALUES ('${BUILDER}','Achieng Otieno','achieng@example.test');
    INSERT INTO studentProfile(id,userId,handle,status) VALUES ('profile','${BUILDER}','achieng-otieno','${status}');
    UPDATE feature_flag SET audience='ALL';
    ${posts}`);
  Object.assign(mocks.env, { DB: withRaw(sqlite, db), DEPLOYMENT_ENVIRONMENT: "production" });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

async function visit() {
  const url = new URL("/dashboard/me/writing", ORIGIN);
  const user = { id: BUILDER, name: "Achieng Otieno", email: "achieng@example.test", image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${BUILDER}-session`, userId: BUILDER, userAgent: "Mozilla/5.0" } });
  const locals = {} as App.Locals;
  const context = {
    url, request: new Request(url), locals, params: {},
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () =>
    container.renderToResponse(Page, { request: new Request(url), locals })) as Response;
  const { document } = new Window();
  document.body.innerHTML = await response.text();
  return { status: response.status, page: document.body.querySelector("#spaces-main")! };
}

const primaries = (page: Awaited<ReturnType<typeof visit>>["page"]) => [...page.querySelectorAll("[data-variant='primary']")];

describe("Writing", () => {
  it("lists drafts and published posts under Maven headings, as kit cards with named row actions", async () => {
    seeded();
    const { status, page } = await visit();
    expect(status).toBe(200);
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    expect(page.querySelector(".uppercase")).toBeNull();
    const sections = [...page.querySelectorAll("[data-writing-section]")];
    expect(sections.map((section) => section.querySelector("h2")?.textContent)).toEqual(["Drafts", "Published"]);
    const [drafts, published] = sections;
    expect(drafts?.querySelector("[data-card] h3")?.textContent).toBe("What ledgers taught me");
    expect(drafts?.querySelector("[data-status]")?.textContent).toBe("Draft");
    const edit = drafts?.querySelector("[data-row-action]");
    expect(edit?.getAttribute("href")).toBe("/dashboard/me/writing/draft");
    expect(edit?.textContent).toBe("Edit What ledgers taught me");
    expect(published?.querySelector("[data-status]")?.textContent).toBe("Published");
    expect(published?.querySelector("a[href='/blog/achieng-otieno/first-cohort']")?.textContent).toBe("View live (opens in a new tab)");
    const [newPost, ...others] = primaries(page);
    expect(others).toEqual([]);
    expect(newPost?.textContent).toBe("New post");
    expect(newPost?.getAttribute("href")).toBe("/dashboard/me/writing/new");
  });

  it("has one peach action when there are no posts: the empty state's", async () => {
    seeded({ posts: "" });
    const { page } = await visit();
    const [start, ...others] = primaries(page);
    expect(others).toEqual([]);
    expect(start?.textContent).toBe("Start writing");
    expect(page.querySelector("[data-empty-state]")?.contains(start!)).toBe(true);
  });

  it("tells a draft profile what opens writing, and reads none of its posts", async () => {
    seeded({ status: "DRAFT" });
    const { page } = await visit();
    const empty = page.querySelector("[data-empty-state]");
    expect(empty?.querySelector("h2")?.textContent).toBe("Your profile isn't published yet");
    expect(empty?.querySelector("a")?.getAttribute("href")).toBe("/dashboard/me/portfolio");
    expect(page.textContent).not.toContain("What ledgers taught me");
    expect(primaries(page)).toEqual([]);
  });
});
