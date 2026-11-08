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
 * /dashboard/cohort/sessions/[id] on the style guide: the session's title is the page's h1, above
 * the player, and names the video; transcript lines are links to ?t=; a recording still being
 * processed says so with its StatusChip. Through the real middleware and page
 * (dashboard/sessions/[id].astro) on SQLite with every migration; authentication is mocked.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../[id].astro");

const STUDENT = "synthetic-wanjiku";
const ORIGIN = "https://ttv.invalid";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seeded() {
  const { database: sqlite, db } = createSqliteD1();
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES ('cohort-a','Cohort 07','Test','curriculum',0,4102444800),
      ('cohort-b','Cohort 08','Test','curriculum',0,4102444800);
    INSERT INTO user(id,name,email) VALUES ('${STUDENT}','Wanjiku Njeri','wanjiku@example.test');
    INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('application','${STUDENT}','cohort-a','APPROVED','{}');
    INSERT INTO recording (id, programId, title, processingStatus) VALUES
      ('ready', 'cohort-a', 'Week 3: Testing a service', 'complete'),
      ('working', 'cohort-a', 'Week 4: Deploying', 'transcribing'),
      ('broken', 'cohort-a', 'Week 5: Observability', 'failed'),
      ('elsewhere', 'cohort-b', 'Another cohort', 'complete');
    INSERT INTO transcript_segment (id, recordingId, startTime, endTime, speaker, text) VALUES
      ('s1', 'ready', 0, 4, 'Mentor', 'Welcome back, everyone.'),
      ('s2', 'ready', 75.5, 90, NULL, 'Questions?');
    UPDATE feature_flag SET audience='ALL';`);
  Object.assign(mocks.env, { DB: withRaw(sqlite, db), DEPLOYMENT_ENVIRONMENT: "production" });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

async function visit(id: string, search = "") {
  const url = new URL(`/dashboard/cohort/sessions/${id}${search}`, ORIGIN);
  const user = { id: STUDENT, name: "Wanjiku Njeri", email: "wanjiku@example.test", image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${STUDENT}-session`, userId: STUDENT, userAgent: "Mozilla/5.0" } });
  const locals = {} as App.Locals;
  const params = { id };
  const context = {
    url, request: new Request(url), locals, params,
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () =>
    container.renderToResponse(Page, { request: new Request(url), locals, params })) as Response;
  return { status: response.status, location: response.headers.get("location"), body: await response.text() };
}

/** Parsed with happy-dom: the render config runs in node, where Astro compiles. */
function main(html: string) {
  const { document } = new Window();
  document.body.innerHTML = html;
  return document.body.querySelector("#spaces-main")!;
}

describe("the session viewer", () => {
  it("titles the page with the session, above the player, and names the video by that h1", async () => {
    seeded();
    const { status, body } = await visit("ready");
    expect(status).toBe(200);
    const page = main(body);
    const h1 = page.querySelector("h1")!;
    expect(h1.textContent).toBe("Week 3: Testing a service");
    expect(h1.hasAttribute("data-page-title")).toBe(true);
    const video = page.querySelector("video")!;
    expect(video.getAttribute("aria-labelledby")).toBe(h1.id);
    // Before it in document order: DOCUMENT_POSITION_FOLLOWING.
    expect(h1.compareDocumentPosition(video) & 4).toBe(4);
    expect(page.querySelectorAll("h1")).toHaveLength(1);
  });

  it("leads back to Sessions at its space path with the kit's back link", async () => {
    seeded();
    const back = main((await visit("ready")).body).querySelector("[data-back-link]")!;
    expect(back.getAttribute("href")).toBe("/dashboard/cohort/sessions");
    expect(back.textContent).toBe("Sessions");
    expect(back.className).toContain("focus-visible:outline-peach-ink");
  });

  it("links each transcript line to ?t=, and starts the video there", async () => {
    seeded();
    const page = main((await visit("ready", "?t=75.5")).body);
    const lines = [...page.querySelectorAll("[data-transcript-panel] a")];
    expect(lines.map((line) => line.getAttribute("href"))).toEqual(["?t=0", "?t=75.5"]);
    expect(lines[0]!.textContent).toBe("Play from 0:00MentorWelcome back, everyone.");
    expect(page.querySelector("video")!.getAttribute("src")).toBe("/api/recordings/ready/video#t=75.5");
  });

  it("says a recording is still being processed, with its StatusChip and no player", async () => {
    seeded();
    const page = main((await visit("working")).body);
    expect(page.querySelector("h1")?.textContent).toBe("Week 4: Deploying");
    expect(page.querySelector("[data-chip] [data-status]")?.textContent).toBe("Transcribing");
    expect(page.querySelector("[data-empty-state] h2")?.textContent).toBe("Not ready to watch yet");
    expect(page.querySelector("video")).toBeNull();
  });

  it("says a failed recording couldn't be processed, in the danger tone", async () => {
    seeded();
    const page = main((await visit("broken")).body);
    expect(page.querySelector("[data-chip]")?.getAttribute("data-chip")).toBe("danger");
    expect(page.querySelector("[data-empty-state] h2")?.textContent).toBe("This recording couldn't be processed");
  });

  it("sends a recording outside the person's cohorts, or none, back to Sessions", async () => {
    seeded();
    for (const id of ["elsewhere", "missing"]) {
      expect(await visit(id)).toMatchObject({ status: 302, location: "/dashboard/cohort/sessions" });
    }
  });

  it("uses no legacy card and no off-palette colour", async () => {
    seeded();
    for (const id of ["ready", "working"]) {
      const html = main((await visit(id)).body).innerHTML;
      expect(html).not.toMatch(/bg-black|text-white|border-white|bg-dark\/|shadow-lg|text-primary|outline-primary|bg-teal|uppercase/);
    }
  });
});
