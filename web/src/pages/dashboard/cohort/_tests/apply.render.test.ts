import { readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { Window } from "happy-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRaw } from "@/lib/attention/test-support";
import { FLASH_COOKIE } from "@/lib/platform/server/flash";
import { APPLICATION_SUBMITTED } from "@/lib/student/apply-page";

/*
 * /dashboard/cohort/apply on the kit (style-guide rollout M11, audit A§14): "Apply to a cohort" in
 * sentence case, each open cohort a kit card with a quiet "Apply to {cohort}", an EmptyState when
 * nothing is left, Notices for what happened, and a submitted application answered 303 to this page
 * with a read-once flash (no `?notice=`). Through the real middleware and page on SQLite with every
 * migration; authentication is mocked. Browser journeys: e2e/platform-application.spec.ts.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../../apply.astro");

const MEMBER = "synthetic-brian";
const ORIGIN = "https://ttv.invalid";
const PATH = "/dashboard/cohort/apply";
const databases: DatabaseSync[] = [];
let sqlite: DatabaseSync;
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seeded(extra = "") {
  const { database, db } = createSqliteD1();
  sqlite = database;
  databases.push(database);
  for (const file of readdirSync(new URL("../../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Full-stack foundations','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate,applicationsOpen) VALUES
      ('open-a','Cohort 08','Learn by building.','curriculum',4102444800,4105036800,1),
      ('open-b','Cohort 09','Another open cohort.','curriculum',4107715200,4110393600,1),
      ('closed','Cohort 07','Closed.','curriculum',0,1,0);
    INSERT INTO user(id,name,email) VALUES ('${MEMBER}','Brian Kiprono','brian@example.test');
    UPDATE feature_flag SET audience='ALL';
    ${extra}`);
  Object.assign(mocks.env, { DB: withRaw(database, db), DEPLOYMENT_ENVIRONMENT: "production" });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

async function visit({ form, cookie }: { form?: Record<string, string>; cookie?: string } = {}) {
  const url = new URL(PATH, ORIGIN);
  mocks.getSession.mockResolvedValue({
    user: { id: MEMBER, name: "Brian Kiprono", email: "brian@example.test", image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) },
    session: { id: `${MEMBER}-session`, userId: MEMBER, userAgent: "Mozilla/5.0" },
  });
  const headers: Record<string, string> = form ? { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN } : {};
  if (cookie) headers.cookie = cookie;
  const request = () => new Request(url, { method: form ? "POST" : "GET", headers, body: form ? new URLSearchParams(form).toString() : undefined });
  const locals = {} as App.Locals;
  const context = {
    url, request: request(), locals, params: {},
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () => container.renderToResponse(Page, { request: request(), locals })) as Response;
  return { status: response.status, headers: response.headers, body: await response.text() };
}

const main = (html: string) => {
  const { document } = new Window();
  document.body.innerHTML = html;
  return document.body.querySelector("#spaces-main")!;
};
const submittedFlash = () => `${FLASH_COOKIE}=${encodeURIComponent(JSON.stringify({ tone: "success", title: APPLICATION_SUBMITTED, path: PATH }))}`;

describe("Apply to a cohort", () => {
  it("lists the open cohorts as kit cards, each with a quiet button that names its cohort", async () => {
    seeded();
    const { status, body } = await visit();
    expect(status).toBe(200);
    const page = main(body);
    expect(page.querySelector("h1")?.textContent).toBe("Apply to a cohort");
    const cards = [...page.querySelectorAll("[data-cohort-id]")];
    expect(cards.map((card) => card.getAttribute("data-cohort-id"))).toEqual(["open-a", "open-b"]);
    const card = cards[0]!;
    expect(card.querySelector("[data-card]")).not.toBeNull();
    expect(card.querySelector("h2")?.textContent).toBe("Cohort 08");
    const apply = card.querySelector("button[type='submit']")!;
    expect(apply.textContent).toBe("Apply to Cohort 08");
    expect(apply.getAttribute("data-variant")).toBe("quiet");
    expect(page.querySelector("[data-variant='primary']")).toBeNull();
    expect(page.innerHTML).not.toMatch(/text-white|bg-green-|text-red-|bg-teal\//);
  });

  it("answers an application with a 303 to this page, with nothing in the address", async () => {
    seeded();
    const { status, headers } = await visit({ form: { programId: "open-a" } });
    expect(status).toBe(303);
    expect(headers.get("location")).toBe(PATH);
    expect(sqlite.prepare("SELECT programId, status FROM programApplication WHERE userId = ?").all(MEMBER)).toEqual([{ programId: "open-a", status: "PENDING" }]);
  });

  it("then says it once, and offers only the other open cohorts", async () => {
    seeded(`INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('mine','${MEMBER}','open-a','PENDING','{}');`);
    const page = main((await visit({ cookie: submittedFlash() })).body);
    const submitted = page.querySelector("[data-application-submitted] [data-notice='success']")!;
    expect(submitted.textContent).toContain(APPLICATION_SUBMITTED);
    expect(submitted.querySelector("a")?.getAttribute("href")).toBe("/dashboard/cohort");
    expect(page.querySelector("h2")?.textContent).toBe("Other open cohorts");
    expect([...page.querySelectorAll("[data-cohort-id]")].map((card) => card.querySelector("h3")?.textContent)).toEqual(["Cohort 09"]);
  });

  it("says when every open cohort has an application, with the way to them", async () => {
    seeded(`INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('a','${MEMBER}','open-a','PENDING','{}'), ('b','${MEMBER}','open-b','PENDING','{}');`);
    const empty = main((await visit()).body).querySelector("[data-apply-empty] [data-empty-state]")!;
    expect(empty.textContent).toContain("You've applied to every cohort that's open right now.");
    expect(empty.querySelector("h2")?.textContent).toBe("You've applied to every cohort that's open right now.");
    const way = empty.querySelector("a")!;
    expect(way.getAttribute("href")).toBe("/dashboard/cohort");
    expect(way.getAttribute("data-variant")).toBe("primary");
  });

  it("says when no cohort is open, with no action to take", async () => {
    seeded("UPDATE program SET applicationsOpen = 0;");
    const page = main((await visit()).body);
    const empty = page.querySelector("[data-apply-empty] [data-empty-state]")!;
    expect(empty.querySelector("h2")?.textContent).toBe("No cohorts are accepting applications right now.");
    expect(empty.querySelector("a")).toBeNull();
    expect(page.querySelector("[data-cohort-id]")).toBeNull();
  });

  it("refuses a closed cohort with a 400 and a danger notice that takes focus", async () => {
    seeded();
    const { status, body } = await visit({ form: { programId: "closed" } });
    expect(status).toBe(400);
    expect(body).toMatch(/<title>Error: /);
    const notice = main(body).querySelector("[data-notice='danger']")!;
    expect(notice.hasAttribute("autofocus")).toBe(true);
    expect(sqlite.prepare("SELECT count(*) AS n FROM programApplication").get()).toEqual({ n: 0 });
  });
});
