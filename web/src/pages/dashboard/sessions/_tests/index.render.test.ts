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
 * /dashboard/cohort/sessions on the style guide: the kit's title, an EmptyState until a recording
 * exists, then kit cards whose links show the focus ring and whose state is a StatusChip in words.
 * Through the real middleware and page (dashboard/sessions/index.astro) on SQLite with every
 * migration; authentication is mocked.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../index.astro");

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

const RECORDINGS = `INSERT INTO recording (id, programId, title, durationSeconds, recordedAt, processingStatus) VALUES
  ('ready', 'cohort-a', 'Week 3: Testing a service', 3600, 1794000000, 'complete'),
  ('working', 'cohort-a', 'Week 4: Deploying', 1800, 1794600000, 'transcribing'),
  ('broken', 'cohort-a', 'Week 5: Observability', 1200, 1795200000, 'failed');`;

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

async function visit() {
  const url = new URL("/dashboard/cohort/sessions", ORIGIN);
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
function main(html: string) {
  const { document } = new Window();
  document.body.innerHTML = html;
  return document.body.querySelector("#spaces-main")!;
}

describe("the Sessions page", () => {
  it("says what will appear, in an EmptyState, before any recording exists", async () => {
    seeded();
    const { status, body } = await visit();
    expect(status).toBe(200);
    const page = main(body);
    expect(page.querySelector("h1")?.textContent).toBe("Sessions");
    const empty = page.querySelector("[data-empty-state]");
    expect(empty?.querySelector("h2")?.textContent).toBe("No recordings yet");
    expect(empty?.textContent).toContain("after each session");
    expect(page.querySelector("[data-session-list]")).toBeNull();
  });

  it("lists recordings newest first as kit cards, each a focusable link to its space path", async () => {
    seeded(RECORDINGS);
    const page = main((await visit()).body);
    const cards = [...page.querySelectorAll("[data-session-card]")];
    expect(cards.map((card) => card.querySelector("h2")?.textContent)).toEqual([
      "Week 5: Observability", "Week 4: Deploying", "Week 3: Testing a service",
    ]);
    for (const card of cards) {
      expect(card.getAttribute("href")).toMatch(/^\/dashboard\/cohort\/sessions\/(broken|working|ready)$/);
      expect(card.className).toContain("focus-visible:outline-peach-ink");
      expect(card.querySelector("[data-card]")).not.toBeNull();
    }
  });

  it("says each recording's state in words, in the shared recording tones", async () => {
    seeded(RECORDINGS);
    const page = main((await visit()).body);
    const chips = [...page.querySelectorAll("[data-session-card] [data-chip]")].map((chip) => [chip.getAttribute("data-chip"), chip.textContent]);
    expect(chips).toEqual([["danger", "Failed"], ["neutral", "Transcribing"], ["success", "Ready"]]);
  });

  it("uses no legacy card and no off-palette colour", async () => {
    seeded(RECORDINGS);
    const html = main((await visit()).body).innerHTML;
    expect(html).not.toMatch(/emerald-|red-\d|text-white|bg-dark\/80|shadow-lg/);
  });
});
