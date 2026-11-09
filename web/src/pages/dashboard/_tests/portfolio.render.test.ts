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
import { PORTFOLIO_COPY } from "@/lib/student/portfolio-page";

/*
 * /dashboard/me/portfolio on the kit (style-guide rollout M13, audit A§16): kit fields, the profile's
 * state as a Notice with its StatusChip, one primary per state (Create, Publish, or Save changes),
 * no call to GitHub on a GET, and each form answered with a 303 plus a read-once flash, or a refusal
 * that keeps every value beside a focused danger Notice. Through the real middleware and page on
 * SQLite with every migration; authentication is mocked.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../portfolio.astro");

const MEMBER = "synthetic-akinyi";
const ORIGIN = "https://ttv.invalid";
const PATH = "/dashboard/me/portfolio";
const databases: DatabaseSync[] = [];
let sqlite: DatabaseSync;
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seeded(extra = "") {
  const { database, db } = createSqliteD1();
  sqlite = database;
  databases.push(database);
  for (const file of readdirSync(new URL("../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO user(id,name,email) VALUES ('${MEMBER}','Akinyi Otieno','akinyi@example.test');
    UPDATE feature_flag SET audience='ALL';
    ${extra}`);
  Object.assign(mocks.env, { DB: withRaw(database, db), DEPLOYMENT_ENVIRONMENT: "production" });
}

const COMPLETED = `INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Full-stack foundations','Test');
  INSERT INTO program(id,name,description,curriculumId,startDate,endDate,applicationsOpen) VALUES ('cohort','Cohort 05','Done.','curriculum',0,1,0);
  INSERT INTO programApplication(id,userId,programId,status,application,completedAt) VALUES ('done','${MEMBER}','cohort','COMPLETED','{}',1700000000);`;
const PROFILE = (status: string) => `INSERT INTO studentProfile(id,userId,handle,headline,status) VALUES ('profile','${MEMBER}','akinyi-builds','Builder in Kisumu','${status}');`;

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

async function visit({ body, cookie }: { body?: URLSearchParams | FormData; cookie?: string } = {}) {
  const url = new URL(PATH, ORIGIN);
  const name = sqlite.prepare("SELECT name FROM user WHERE id = ?").get(MEMBER) as { name: string };
  mocks.getSession.mockResolvedValue({
    user: { id: MEMBER, name: name.name, email: "akinyi@example.test", image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) },
    session: { id: `${MEMBER}-session`, userId: MEMBER, userAgent: "Mozilla/5.0" },
  });
  const headers: Record<string, string> = body ? { origin: ORIGIN } : {};
  if (body instanceof URLSearchParams) headers["content-type"] = "application/x-www-form-urlencoded";
  if (cookie) headers.cookie = cookie;
  const request = () => new Request(url, { method: body ? "POST" : "GET", headers, body });
  const locals = {} as App.Locals;
  const context = {
    url, request: request(), locals, params: {},
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () => container.renderToResponse(Page, { request: request(), locals })) as Response;
  const cookies = Reflect.get(response, Symbol.for("astro.cookies")) as { consume(): Iterable<string> } | undefined;
  // The Set-Cookie lines, read the way the adapter writes them.
  const setCookies = [...response.headers.getSetCookie(), ...(cookies ? cookies.consume() : [])];
  return { status: response.status, headers: response.headers, setCookies, body: await response.text() };
}

const main = (html: string) => {
  const { document } = new Window();
  document.body.innerHTML = html;
  return document.body.querySelector("#spaces-main")!;
};
const flashCookie = (title: string) => `${FLASH_COOKIE}=${encodeURIComponent(JSON.stringify({ tone: "success", title, path: PATH }))}`;

describe("Public profile", () => {
  it("before a completed cohort, says when it opens, with the way there as the one primary, and no form", async () => {
    seeded();
    const page = main((await visit()).body);
    expect(page.querySelector("h1")?.textContent).toBe("Public profile");
    const empty = page.querySelector("[data-empty-state]")!;
    expect(empty.querySelector("h2")?.textContent).toBe("Your public profile opens when you complete a cohort");
    expect([...page.querySelectorAll("[data-variant='primary']")].map((link) => link.getAttribute("href"))).toEqual(["/dashboard/cohort/apply"]);
    expect(page.querySelector("#profile-editor")).toBeNull();
  });

  it("offers kit fields to create one, without calling GitHub on a GET", async () => {
    seeded(COMPLETED);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    const page = main(body);
    const form = page.querySelector("#profile-editor")!;
    expect(form.querySelector("[data-prefix]")?.textContent).toBe("/talent/");
    expect(form.querySelectorAll("input[type='checkbox']").length).toBe(2);
    expect([...page.querySelectorAll("[data-variant='primary']")].map((b) => b.textContent)).toEqual(["Create profile"]);
    expect(page.innerHTML).not.toMatch(/form-control|text-white|bg-green-|text-red-|bg-amber-|Save Changes|Create Profile/);
  });

  it("creates a draft with a 303 to this page, which says so once", async () => {
    seeded(COMPLETED);
    const { status, headers } = await visit({ body: new URLSearchParams({ _action: "save", handle: "akinyi-builds", headline: "Builder in Kisumu", openToRoles: "on" }) });
    expect(status).toBe(303);
    expect(headers.get("location")).toBe(PATH);
    expect(sqlite.prepare("SELECT handle, status, openToRoles FROM studentProfile WHERE userId = ?").get(MEMBER)).toEqual({ handle: "akinyi-builds", status: "DRAFT", openToRoles: 1 });
    const page = main((await visit({ cookie: flashCookie(PORTFOLIO_COPY.created) })).body);
    expect(page.querySelector("[data-notice='success']")?.textContent).toContain(PORTFOLIO_COPY.created);
  });

  it("refuses a bad handle with a 400 that keeps every value, the error under the field and a focused notice", async () => {
    seeded(COMPLETED);
    const { status, body } = await visit({ body: new URLSearchParams({ _action: "save", handle: "No Spaces!", headline: "Kept headline", bio: "Kept bio", openToFreelance: "on" }) });
    expect(status).toBe(400);
    expect(body).toMatch(/<title>Error: /);
    const page = main(body);
    const notice = page.querySelector("[data-notice='danger']")!;
    expect(notice.hasAttribute("autofocus")).toBe(true);
    expect(notice.textContent).toContain(PORTFOLIO_COPY.notSaved);
    const handle = page.querySelector("input[name='handle']")!;
    expect(handle.getAttribute("value")).toBe("No Spaces!");
    expect(handle.getAttribute("aria-invalid")).toBe("true");
    expect(page.querySelector("input[name='headline']")?.getAttribute("value")).toBe("Kept headline");
    expect(page.querySelector("textarea[name='bio']")?.textContent).toBe("Kept bio");
    expect(page.querySelector("input[name='openToFreelance']")?.hasAttribute("checked")).toBe(true);
    expect(sqlite.prepare("SELECT count(*) AS n FROM studentProfile").get()).toEqual({ n: 0 });
  });

  it("shows a draft's state with its chip, and publishing is the one primary", async () => {
    seeded(COMPLETED + PROFILE("DRAFT"));
    const page = main((await visit()).body);
    const state = page.querySelector("[data-profile-status='DRAFT']")!;
    expect(state.querySelector("[data-notice='info']")?.textContent).toContain("Your profile is a draft");
    expect(state.textContent).toContain("Draft");
    expect([...page.querySelectorAll("[data-variant='primary']")].map((b) => b.textContent)).toEqual(["Publish profile"]);
    expect(page.querySelector("#profile-editor button[type='submit']")?.textContent).toBe("Save draft");
    expect(page.querySelector("#highlights-title")?.textContent).toBe("GitHub highlights");
  });

  it("says where a published profile lives", async () => {
    seeded(COMPLETED + PROFILE("PUBLISHED"));
    const page = main((await visit()).body);
    const live = page.querySelector("[data-profile-status='PUBLISHED'] a")!;
    expect(live.getAttribute("href")).toBe("/talent/akinyi-builds");
    expect([...page.querySelectorAll("[data-variant='primary']")].map((b) => b.textContent)).toEqual(["Save changes"]);
  });

  it("keeps a paused profile out of the editor", async () => {
    seeded(COMPLETED + PROFILE("SUSPENDED"));
    const page = main((await visit()).body);
    expect(page.querySelector("[data-profile-status='SUSPENDED'] [data-notice='warning']")?.textContent).toContain("Your profile is paused");
    expect(page.querySelector("#profile-editor")).toBeNull();
    expect(page.querySelector("#highlights-title")).toBeNull();
  });
});
