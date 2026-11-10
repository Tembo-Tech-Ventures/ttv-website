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
import { NOT_SAVED, SAVED } from "@/components/platform/profile-editor/copy";

/*
 * /dashboard/me/portfolio, the one profile editor (PR D): for everyone signed in, the profile, the
 * public website (graduates list and unlist themselves; everyone else gets one honest line) and their
 * posted work, all plain forms answered with a 303 and a read-once flash, or a refusal that keeps every
 * value beside a focused danger Notice. Says who sees it wherever something is saved. Through the real
 * middleware and page on SQLite with every migration; authentication is mocked.
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
const PROFILE = (status: string) => `INSERT INTO studentProfile(id,userId,handle,headline,status,publicName) VALUES ('profile','${MEMBER}','akinyi-builds','Builder in Kisumu','${status}','Akinyi Otieno');`;
const WORK = `INSERT INTO user(id,name,email) VALUES ('synthetic-mentor','Baraka Mwangi','baraka@example.test');
  INSERT INTO communityJourney(id,userId,title,description,evidenceUrl,occurredAt,visibility) VALUES ('ledger','${MEMBER}','Chama savings ledger','Built and tested a fictional savings ledger.','https://github.com/example/ledger','2026-10-24','institution');
  INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion) VALUES ('confirmed','ledger','synthetic-mentor','Walked through the tests together.','REVIEWED_WORK',1);`;

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

type VisitOptions = { body?: URLSearchParams | FormData; cookie?: string; origin?: string | null };
const visit = (options: VisitOptions = {}) => visitAt(new URL(PATH, ORIGIN), options);

/** One signed-in request to `url` through the middleware and the page. */
async function visitAt(url: URL, { body, cookie, origin = ORIGIN }: VisitOptions = {}) {
  const name = sqlite.prepare("SELECT name FROM user WHERE id = ?").get(MEMBER) as { name: string };
  mocks.getSession.mockResolvedValue({
    user: { id: MEMBER, name: name.name, email: "akinyi@example.test", image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) },
    session: { id: `${MEMBER}-session`, userId: MEMBER, userAgent: "Mozilla/5.0" },
  });
  const headers: Record<string, string> = body && origin ? { origin } : {};
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

const EVERYONE_SEES = "Everyone signed in to TTV can see your profile and everything you post. If you complete a cohort and publish, it's also on the public website, where anyone can see it.";
const primaries = (page: ReturnType<typeof main>) => [...page.querySelectorAll("[data-variant='primary']")].map((control) => control.textContent?.trim());
const work = () => sqlite.prepare("SELECT id, title, state, version FROM communityJourney WHERE userId = ? ORDER BY title").all(MEMBER);
const post = (fields: Record<string, string>) => visit({ body: new URLSearchParams(fields) });
const ADD = { _action: "work", title: "Matatu fare splitter", description: "Wrote the fare-splitting logic and its tests.", date: "2026-10-30", link: "", status: "posted" };

describe("the profile editor, for everyone", () => {
  it("lets someone without a cohort make a profile, says who sees it, and keeps the public website honest", async () => {
    seeded();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    const page = main(body);
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    expect(page.querySelector("h1")?.textContent).toBe("Your profile");
    expect(page.querySelector("#profile-visibility")?.textContent).toContain(EVERYONE_SEES);
    const form = page.querySelector("[data-profile-form]")!;
    expect(form.querySelector("h2")?.textContent).toBe("Make your profile");
    for (const name of ["handle", "headline", "bio", "opportunityGoals", "skills", "openToFreelance", "openToRoles"]) {
      expect(form.querySelector(`[name='${name}']`), `${name}`).not.toBeNull();
    }
    expect(form.querySelector("button[type='submit']")?.getAttribute("aria-describedby")).toBe("profile-visibility");
    expect(primaries(page)).toEqual(["Make my profile"]);
    // Not a graduate: one honest line, nothing to press, nothing about applying.
    const site = page.querySelector("[data-public-site='not-yet']")!;
    expect(site.textContent).toContain("The public website lists people who have completed a TTV cohort.");
    expect(site.querySelector("form, a")).toBeNull();
    // Work can be posted before anything else; repositories wait for a profile to hang on.
    expect(page.querySelector("[data-work] [data-empty-state] a")?.getAttribute("href")).toBe(`${PATH}?add=1#work-editor`);
    expect(page.querySelector("[data-repos]")).toBeNull();
    expect(page.innerHTML).not.toMatch(/form-control|text-white|bg-green-|text-red-|bg-amber-/);
  });

  it("saves a non-graduate's profile with what they're looking for, with a 303 that says so once", async () => {
    seeded();
    const { status, headers } = await post({ _action: "save", handle: "akinyi-builds", headline: "Builder in Kisumu", opportunityGoals: "An internship", openToRoles: "on" });
    expect(status).toBe(303);
    expect(headers.get("location")).toBe(PATH);
    expect(sqlite.prepare("SELECT handle, status, opportunityGoals, openToRoles FROM studentProfile WHERE userId = ?").get(MEMBER))
      .toEqual({ handle: "akinyi-builds", status: "DRAFT", opportunityGoals: "An internship", openToRoles: 1 });
    const page = main((await visit({ cookie: flashCookie(SAVED.profile) })).body);
    expect(page.querySelector("[data-notice='success']")?.textContent).toContain(SAVED.profile);
  });

  it("refuses a bad handle with a 400 that keeps every value, the error under the field and a focused notice", async () => {
    seeded();
    const { status, body } = await post({ _action: "save", handle: "No Spaces!", headline: "Kept headline", bio: "Kept bio", opportunityGoals: "Kept goals", openToFreelance: "on" });
    expect(status).toBe(400);
    expect(body).toMatch(/<title>Error: /);
    const page = main(body);
    const notice = page.querySelector("[data-notice='danger']")!;
    expect(notice.hasAttribute("autofocus")).toBe(true);
    expect(notice.textContent).toContain(NOT_SAVED.profile);
    const handle = page.querySelector("input[name='handle']")!;
    expect(handle.getAttribute("value")).toBe("No Spaces!");
    expect(handle.getAttribute("aria-invalid")).toBe("true");
    expect(page.querySelector("input[name='headline']")?.getAttribute("value")).toBe("Kept headline");
    expect(page.querySelector("textarea[name='bio']")?.textContent).toBe("Kept bio");
    expect(page.querySelector("textarea[name='opportunityGoals']")?.textContent).toBe("Kept goals");
    expect(page.querySelector("input[name='openToFreelance']")?.hasAttribute("checked")).toBe(true);
    expect(sqlite.prepare("SELECT count(*) AS n FROM studentProfile").get()).toEqual({ n: 0 });
  });

  it("refuses to list a non-graduate on the public website, whatever is posted", async () => {
    seeded(PROFILE("DRAFT"));
    const { status, body } = await post({ _action: "publish" });
    expect(status).toBe(400);
    expect(main(body).querySelector("[data-notice='danger']")?.textContent).toContain(NOT_SAVED.listed);
    expect(sqlite.prepare("SELECT status FROM studentProfile WHERE id = 'profile'").get()).toEqual({ status: "DRAFT" });
  });

  it("links a listed member to their page as others see it", async () => {
    seeded(PROFILE("DRAFT"));
    const page = main((await visit()).body);
    expect(page.querySelector("[data-page-header] a")?.getAttribute("href")).toBe("/dashboard/community/members/akinyi-builds");
    expect(page.querySelector("[data-profile-form] h2")?.textContent).toBe("About you");
    expect(primaries(page)).toEqual(["Save profile"]);
    expect(page.querySelector("#repos-title")?.textContent).toBe("GitHub repositories");
  });

  it("keeps a paused profile out of the editor, and says so", async () => {
    seeded(COMPLETED + PROFILE("SUSPENDED"));
    const page = main((await visit()).body);
    expect(page.querySelector("[data-public-site='paused']")?.textContent).toContain("Your profile is paused");
    expect(page.querySelector("[data-profile-form]")).toBeNull();
    expect(page.querySelector("[data-repos]")).toBeNull();
  });
});

describe("the public website, for graduates", () => {
  it("offers a graduate's saved profile one press to list it", async () => {
    seeded(COMPLETED + PROFILE("DRAFT"));
    const site = main((await visit()).body).querySelector("[data-public-site='offered']")!;
    expect(site.textContent).toContain("/talent/akinyi-builds");
    expect(site.querySelector("input[name='_action']")?.getAttribute("value")).toBe("publish");
    expect(site.querySelector("button")?.textContent).toBe("List me on the public website");
  });

  it("says where a listed profile lives, and takes it off after a confirm step that says what comes off", async () => {
    seeded(COMPLETED + PROFILE("PUBLISHED"));
    let site = main((await visit()).body).querySelector("[data-public-site='listed']")!;
    expect(site.querySelector("a[href='/talent/akinyi-builds']")).not.toBeNull();
    const off = [...site.querySelectorAll("a")].find((link) => link.textContent === "Take me off the public website")!;
    expect(off.getAttribute("href")).toBe(`${PATH}?confirm=unpublish`);
    // The confirm step: a warning that takes focus and names what comes off, then the danger button.
    site = main((await visitAt(new URL(`${PATH}?confirm=unpublish`, ORIGIN))).body).querySelector("[data-public-site='listed']")!;
    const step = site.querySelector("[data-confirm-step]") ?? site;
    expect(step.textContent).toContain("Take your profile off the public website?");
    expect(step.textContent).toContain("Your page at /talent/akinyi-builds and the pages of your posts come off the public website.");
    expect(step.textContent).toContain("Your handle stays yours");
    expect(step.querySelector("input[name='_action']")?.getAttribute("value")).toBe("unpublish");
    const { status, headers } = await post({ _action: "unpublish" });
    expect(status).toBe(303);
    expect(headers.get("location")).toBe(PATH);
    expect(sqlite.prepare("SELECT status, handle FROM studentProfile WHERE id = 'profile'").get()).toEqual({ status: "DRAFT", handle: "akinyi-builds" });
    // Coming off twice says so, and changes nothing.
    const again = await post({ _action: "unpublish" });
    expect(again.status).toBe(409);
    expect(main(again.body).querySelector("[data-notice='danger']")?.textContent).toContain(NOT_SAVED.unlisted);
  });
});

describe("a listed profile held by the check", () => {
  it("never says it is on the public website while a person hasn't checked it", async () => {
    seeded(COMPLETED + PROFILE("PUBLISHED") + "UPDATE studentProfile SET moderationOutcome = 'hold' WHERE id = 'profile';");
    const page = main((await visit()).body);
    const site = page.querySelector("[data-public-site='listed']")!;
    expect(site.querySelector("[data-public-site-held]")?.textContent).toContain("it's waiting for a check, so nothing shows there");
    expect(site.textContent).not.toContain("You're on the public website at");
    expect(page.querySelector("[data-notice='warning']")?.textContent).toContain("Your profile is waiting for a check");
  });
});

describe("posting work", () => {
  it("lists the caller's work with what mentors confirmed, and the ways to edit, draft and delete it", async () => {
    seeded(PROFILE("DRAFT") + WORK);
    const page = main((await visit()).body);
    const entry = page.querySelector("[data-work] [data-data-list-item]")!;
    expect(entry.querySelector("h3")?.textContent).toBe("Chama savings ledger");
    expect(entry.querySelector("[data-confirmation='current']")?.textContent).toContain("Confirmed by Baraka Mwangi");
    const actions = [...entry.querySelectorAll("[data-row-action], button")].map((control) => control.textContent?.trim());
    expect(actions).toEqual(["Edit Chama savings ledger", "Move to drafts Chama savings ledger", "Delete Chama savings ledger"]);
    expect(entry.querySelector("[data-row-action]")?.getAttribute("href")).toBe(`${PATH}?edit=ledger#work-editor`);
  });

  it("opens the work form from its link, says who sees it before the save, and makes its save the one peach action", async () => {
    seeded(PROFILE("DRAFT"));
    const page = main((await visitAt(new URL(`${PATH}?add=1`, ORIGIN))).body);
    // Every id on the page is its own, so each label names its own field.
    const ids = [...page.querySelectorAll("[id]")].map((element) => element.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    const editor = page.querySelector("[data-work-editor='add']")!;
    expect(editor.querySelector("form")?.getAttribute("action")).toBe(PATH);
    expect(editor.querySelector("#work-visibility")?.textContent).toContain(EVERYONE_SEES);
    expect(editor.querySelector("button[type='submit']")?.getAttribute("aria-describedby")).toBe("work-visibility");
    expect([...editor.querySelectorAll("[name='status']")].map((radio) => radio.getAttribute("value"))).toEqual(["posted", "draft"]);
    expect(primaries(page)).toEqual(["Save"]);
  });

  it("posts a piece, or keeps it as a draft, each with a 303", async () => {
    seeded(PROFILE("DRAFT"));
    expect((await post(ADD)).status).toBe(303);
    expect((await post({ ...ADD, title: "Bus stop map", status: "draft" })).status).toBe(303);
    expect(work()).toEqual([
      expect.objectContaining({ title: "Bus stop map", state: "DRAFT" }),
      expect.objectContaining({ title: "Matatu fare splitter", state: "POSTED" }),
    ]);
  });

  it("revises a piece at the revision it was opened at, keeping its mentor's statement on the old one", async () => {
    seeded(PROFILE("DRAFT") + WORK);
    const { status } = await post({ ...ADD, id: "ledger", revision: "1", title: "Chama savings ledger, v2" });
    expect(status).toBe(303);
    expect(work()).toEqual([expect.objectContaining({ id: "ledger", title: "Chama savings ledger, v2", version: 2, state: "POSTED" })]);
    expect(sqlite.prepare("SELECT journeyVersion FROM communityConfirmation WHERE id = 'confirmed'").get()).toEqual({ journeyVersion: 1 });
  });

  it("refuses a stale revision with a 409 and keeps what was typed", async () => {
    seeded(PROFILE("DRAFT") + WORK + "UPDATE communityJourney SET version = 2 WHERE id = 'ledger';");
    const { status, body } = await post({ ...ADD, id: "ledger", revision: "1", title: "Typed over a stale copy" });
    expect(status).toBe(409);
    const page = main(body);
    expect(page.querySelector("[data-work-editor='edit'] [data-notice='danger']")?.textContent).toContain("This changed since you opened it");
    expect(page.querySelector("[data-work-editor='edit'] [name='title']")?.getAttribute("value")).toBe("Typed over a stale copy");
    expect(body).toMatch(/<title>Error: /);
  });

  it("refuses a piece with problems with a 400, an error under each field and everything kept", async () => {
    seeded(PROFILE("DRAFT"));
    const { status, body } = await post({ ...ADD, title: "Hi", description: "Too short", date: "2026-02-30", link: "http://example.test" });
    expect(status).toBe(400);
    const editor = main(body).querySelector("[data-work-editor='add']")!;
    expect(editor.querySelector("[data-notice='danger']")?.textContent).toContain("4 things to fix");
    expect(editor.querySelectorAll("[aria-invalid='true']")).toHaveLength(4);
    expect(editor.querySelector("[name='description']")?.textContent).toBe("Too short");
    expect(work()).toEqual([]);
  });

  it("says plainly when the team took a piece down", async () => {
    seeded(PROFILE("DRAFT") + WORK + "UPDATE communityJourney SET moderatorHidden = 1 WHERE id = 'ledger';");
    const entry = main((await visit()).body).querySelector("[data-work-entry='ledger']")!;
    expect(entry.getAttribute("data-work-status")).toBe("hidden");
    expect(entry.textContent).toContain("The team took this down, so only you and the team can see it.");
  });

  it("moves a piece to drafts and back", async () => {
    seeded(PROFILE("DRAFT") + WORK);
    expect((await post({ _action: "work-status", id: "ledger", status: "draft" })).status).toBe(303);
    expect(work()).toEqual([expect.objectContaining({ state: "DRAFT" })]);
    const page = main((await visit()).body);
    expect(page.querySelector("[data-work-status='draft']")?.textContent).toContain("A draft: only you can see it.");
    expect((await post({ _action: "work-status", id: "ledger", status: "posted" })).status).toBe(303);
    expect(work()).toEqual([expect.objectContaining({ state: "POSTED" })]);
  });

  it("deletes a piece after a confirm step that says its confirmations go too", async () => {
    seeded(PROFILE("DRAFT") + WORK);
    const page = main((await visitAt(new URL(`${PATH}?confirm=delete-ledger`, ORIGIN))).body);
    const step = page.querySelector("[data-work-entry='ledger']")!;
    expect(step.textContent).toContain("Delete “Chama savings ledger”?");
    expect(step.textContent).toContain("with the mentor confirmation of it");
    expect(step.querySelector("input[name='_action']")?.getAttribute("value")).toBe("work-delete");
    expect((await post({ _action: "work-delete", id: "ledger" })).status).toBe(303);
    expect(work()).toEqual([]);
  });

  it("refuses a post from another origin, or without one, and a form with no action", async () => {
    seeded(PROFILE("DRAFT"));
    for (const origin of ["https://elsewhere.example", null]) {
      expect((await visitAt(new URL(PATH, ORIGIN), { body: new URLSearchParams(ADD), origin })).status).toBe(403);
    }
    expect((await post({ title: "No action" })).status).toBe(400);
    expect(work()).toEqual([]);
  });
});

it("an unavailable publish check leaves a held draft off the public website", async () => {
  seeded(COMPLETED + PROFILE("DRAFT") + "UPDATE studentProfile SET moderationOutcome='hold',moderationReviewRequired=1;");
  const result = await visit({ body: new URLSearchParams({ _action: "publish" }) });
  expect(sqlite.prepare("SELECT status,moderationOutcome FROM studentProfile").get()).toEqual({ status: "DRAFT", moderationOutcome: "hold" });
  expect(result.body).not.toContain("Your profile is live");
  expect(result.body).toContain("Your profile needs attention before it can go live.");
});

it("never labels a held public listing as live", async () => {
  seeded(COMPLETED + PROFILE("PUBLISHED") + "UPDATE studentProfile SET moderationOutcome='hold',moderationReviewRequired=1;");
  const { body } = await visit();
  expect(body).toContain("Your profile is waiting for a human review");
  expect(body).not.toContain("Your profile is live");
});
