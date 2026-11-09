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
 * /dashboard/cohort/ask, Ask Tembo privately, on the style guide: one h1, the kit's "Ask Tembo"
 * (visually hidden, the chat keeps the screen), the ChatApp island, said scope, and nothing in the
 * legacy colours. Through the real middleware and page (dashboard/ask.astro) on SQLite with every
 * migration; authentication is mocked. The chat's own behaviour is in components/chat/*.test.tsx and
 * e2e/chat-page.spec.ts.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../../ask.astro");

const STUDENT = "synthetic-wanjiku";
const ORIGIN = "https://ttv.invalid";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seeded(audience: "ALL" | "OFF" = "ALL") {
  const { database: sqlite, db } = createSqliteD1();
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES ('cohort-a','Cohort 07','Test','curriculum',0,4102444800);
    INSERT INTO user(id,name,email) VALUES ('${STUDENT}','Wanjiku Njeri','wanjiku@example.test');
    INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('application','${STUDENT}','cohort-a','APPROVED','{}');
    UPDATE feature_flag SET audience='${audience}';`);
  Object.assign(mocks.env, { DB: withRaw(sqlite, db), DEPLOYMENT_ENVIRONMENT: "production" });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

async function visit(path = "/dashboard/cohort/ask") {
  const url = new URL(path, ORIGIN);
  const user = { id: STUDENT, name: "Wanjiku Njeri", email: "wanjiku@example.test", image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${STUDENT}-session`, userId: STUDENT, userAgent: "Mozilla/5.0" } });
  const locals = {} as App.Locals;
  const context = {
    url, request: new Request(url), locals, params: {},
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () =>
    container.renderToResponse(Page, { request: new Request(url), locals })) as Response;
  return { status: response.status, body: await response.text() };
}

/** Parsed with happy-dom: the render config runs in node, where Astro compiles. */
const dom = (html: string) => {
  const { document } = new Window();
  document.body.innerHTML = html;
  return document.body;
};

const LEGACY = /border-rule|bg-dark\/|bg-bg-raised|text-red-\d|text-white|shadow-2xl|shadow-lg/;

describe("Ask Tembo privately", () => {
  it("has one h1, the kit's Ask Tembo, and the chat island filling the sheet", async () => {
    seeded();
    const { status, body } = await visit();
    expect(status).toBe(200);
    const page = dom(body).querySelector("#spaces-main")!;
    const h1s = [...page.querySelectorAll("h1")];
    expect(h1s.map((h1) => h1.textContent)).toEqual(["Ask Tembo"]);
    expect(h1s[0]!.hasAttribute("data-page-title")).toBe(true);
    expect(h1s[0]!.classList.contains("sr-only")).toBe(true);
    const island = page.querySelector("[data-space-fill] astro-island")!;
    expect(island.getAttribute("component-url")).toContain("ChatApp");
    expect(island.getAttribute("client")).toBe("load");
    // The scope /api/chat gives Tembo, read from the request's capabilities: a cohort member's.
    expect(page.textContent).toContain("your cohorts' recorded sessions");
    expect(page.querySelector('button[data-variant="primary"]')?.getAttribute("aria-label")).toBe("Send message");
  });

  it("uses no legacy colour", async () => {
    seeded();
    const page = dom((await visit()).body).querySelector("#spaces-main")!;
    expect(page.innerHTML).not.toMatch(LEGACY);
    expect(page.innerHTML).not.toContain("uppercase");
  });

  it("keeps its own frame with spaces off, the same h1 and its way back into the dashboard", async () => {
    seeded("OFF");
    const { status, body } = await visit("/dashboard/ask");
    expect(status).toBe(200);
    const page = dom(body);
    expect(page.querySelector(".spaces-shell")).toBeNull();
    expect([...page.querySelectorAll("h1")].map((h1) => h1.textContent)).toEqual(["Ask Tembo"]);
    expect(page.querySelector('a[aria-label="Back to dashboard"]')).not.toBeNull();
    expect(page.querySelector('nav[aria-label="Site"] a[href="/auth/logout"]')).not.toBeNull();
    expect(page.querySelector("astro-island")?.innerHTML ?? "").not.toMatch(LEGACY);
  });
});
