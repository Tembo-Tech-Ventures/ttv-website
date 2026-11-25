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
 * /dashboard/calls/:id (in-app calls P5): the call room page outside the spaces, in the space's tone.
 * The page before joining renders on the server with its one h1, what is recorded and Join, never
 * cached; without JavaScript it says a call needs it. Anyone the call isn't for gets the same 404.
 * "Coming up" on Sessions links to it once a session is about to start. Through the real middleware
 * and pages on SQLite with every migration; authentication is mocked.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: CallPage } = await import("../[id].astro");
const { default: SessionsPage } = await import("../../sessions/index.astro");

const STUDENT = "synthetic-wanjiku";
const OUTSIDER = "synthetic-kevin";
const ORIGIN = "https://ttv.invalid";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seeded({ meetings = "ALL", startsIn = 60 * 60_000 }: { meetings?: "ALL" | "OFF"; startsIn?: number } = {}) {
  const { database: sqlite, db } = createSqliteD1();
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES ('cohort-a','Cohort 04','Test','curriculum',0,4102444800);
    INSERT INTO user(id,name,email) VALUES ('${STUDENT}','Wanjiku Mwangi','wanjiku@example.test'),('${OUTSIDER}','Kevin Omondi','kevin@example.test');
    INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('application','${STUDENT}','cohort-a','APPROVED','{}');
    UPDATE feature_flag SET audience='ALL';
    UPDATE feature_flag SET audience='${meetings}' WHERE key='meetings';`);
  const channel = sqlite.prepare("SELECT id FROM channel WHERE kind='COHORT' AND programId='cohort-a' AND slug LIKE 'cohort-%'").get() as { id: string };
  sqlite.prepare(`INSERT INTO meeting (id, channelId, purpose, title, scheduledStartAt, bookedMinutes, limitMinutes, recordingPolicy, state, createdAt, updatedAt)
    VALUES ('session', ?, 'SESSION', 'Week 4: Deploying', ?, 60, 90, 'ALWAYS', 'SCHEDULED', 0, 0)`).run(channel.id, Date.now() + startsIn);
  Object.assign(mocks.env, { DB: withRaw(sqlite, db), DEPLOYMENT_ENVIRONMENT: "staging", PLATFORM_FLAGS_OVERRIDE: undefined });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

async function visit(path: string, userId: string, Page: typeof CallPage = CallPage, params: Record<string, string> = { id: "session" }) {
  const url = new URL(path, ORIGIN);
  const user = { id: userId, name: "Synthetic", email: `${userId}@example.test`, image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${userId}-session`, userId, userAgent: "Mozilla/5.0" } });
  const locals = {} as App.Locals;
  const context = {
    url, request: new Request(url), locals, params,
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () =>
    container.renderToResponse(Page, { request: new Request(url), locals, params })) as Response;
  const { document } = new Window();
  document.body.innerHTML = await response.text();
  return { status: response.status, headers: response.headers, body: document.body };
}

describe("the call room page", () => {
  it("draws the page before joining on the server: one h1, what is recorded, Join and why it waits, never cached", async () => {
    seeded();
    const { status, headers, body } = await visit("/dashboard/calls/session", STUDENT);
    expect(status).toBe(200);
    expect(headers.get("cache-control")).toBe("private, no-store");
    const headings = [...body.querySelectorAll("h1")];
    expect(headings.map((heading) => heading.textContent)).toEqual(["Week 4: Deploying"]);
    expect(body.querySelector("[data-call-prejoin]")).not.toBeNull();
    expect(body.textContent).toContain("This session is recorded");
    expect(body.textContent).toContain("Everyone in Cohort 04 can watch it");
    const join = body.querySelector("[data-call-join]")!;
    expect(join.textContent).toBe("Join session");
    expect(join.hasAttribute("disabled")).toBe(true);
    expect(body.querySelector("#call-join-reason")!.textContent).toBe("A host hasn't started the session yet");
    expect(body.querySelector("noscript")!.innerHTML).toContain("Calls need JavaScript");
    expect(body.querySelector("astro-island")!.getAttribute("client")).toBe("load");
  });

  it("is the same 404 for someone outside the cohort, a call that doesn't exist, and while `meetings` is off", async () => {
    seeded();
    for (const [path, userId, params] of [
      ["/dashboard/calls/session", OUTSIDER, { id: "session" }],
      ["/dashboard/calls/nothing", STUDENT, { id: "nothing" }],
    ] as const) {
      const { status, body } = await visit(path, userId, CallPage, params);
      expect(status).toBe(404);
      expect(body.textContent).toBe("Not found");
    }
    seeded({ meetings: "OFF" });
    expect((await visit("/dashboard/calls/session", STUDENT)).status).toBe(404);
  });
});

describe("Coming up links to the call", () => {
  it("once a session is about to start, in its own tab, and not before", async () => {
    seeded({ startsIn: 5 * 60_000 });
    const soon = await visit("/dashboard/cohort/sessions", STUDENT, SessionsPage, {});
    const link = soon.body.querySelector("[data-call-link]")!;
    expect(link.getAttribute("href")).toBe("/dashboard/calls/session");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.textContent).toBe("Join session: Week 4: Deploying (opens in a new tab)");
    expect(link.getAttribute("data-variant")).not.toBe("primary");
    seeded({ startsIn: 60 * 60_000 });
    const later = await visit("/dashboard/cohort/sessions", STUDENT, SessionsPage, {});
    expect(later.body.querySelector("[data-call-link]")).toBeNull();
  });
});
