import { readFileSync, readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { Window } from "happy-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRaw } from "@/lib/attention/test-support";
import { FLASH_COOKIE } from "@/lib/platform/server/flash";

/*
 * /dashboard/community, Community's home: the kit PageTitle "Community" and one sentence lead,
 * onboarding's cards after it, the caller's profile as a kit card, who sees it in an info notice, and
 * their work, as everyone signed in sees it. Nothing is edited here: there is one profile editor, in
 * the Profile space, and every way to change the profile or post work leads there ("Post work" is the
 * one peach action). Through the real middleware and page on SQLite with every migration;
 * authentication is mocked. The browser journeys are e2e/platform-community-home.spec.ts.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../../community.astro");

const MEMBER = "synthetic-achieng";
const ORIGIN = "https://ttv.invalid";
const PATH = "/dashboard/community";
const databases: DatabaseSync[] = [];
let sqlite: DatabaseSync;
afterEach(() => databases.splice(0).forEach((database) => database.close()));

/** A member with no cohort, a saved profile and one contribution a mentor confirmed. */
function seeded(extra = "") {
  const { database, db } = createSqliteD1();
  sqlite = database;
  databases.push(database);
  for (const file of readdirSync(new URL("../../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO user(id,name,email) VALUES ('${MEMBER}','Achieng Otieno','achieng@example.test'), ('synthetic-mentor','Baraka Mwangi','baraka@example.test');
    INSERT INTO studentProfile(id,handle,userId,headline,bio,skills,opportunityGoals) VALUES ('${MEMBER}','${MEMBER}','${MEMBER}','Frontend builder','Builds savings tools.','["TypeScript"]','A first developer role in Nairobi');
    INSERT INTO communityJourney(id,userId,title,description,evidenceUrl,occurredAt,visibility) VALUES ('ledger','${MEMBER}','Chama savings ledger','Built and tested a fictional savings ledger.','https://github.com/example/ledger','2026-10-24','institution');
    INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion) VALUES ('confirmed','ledger','synthetic-mentor','Walked through the tests together.','REVIEWED_WORK',1);
    UPDATE feature_flag SET audience='ALL';
    ${extra}`);
  Object.assign(mocks.env, { DB: withRaw(database, db), DEPLOYMENT_ENVIRONMENT: "production" });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

type Visit = { path?: string; method?: "GET" | "POST"; form?: Record<string, string>; origin?: string | null; cookie?: string };
const EDITOR = "/dashboard/me/portfolio";

/** One signed-in request through the middleware and the page. */
async function visit({ path = PATH, method = "GET", form, origin = ORIGIN, cookie }: Visit = {}) {
  const url = new URL(path, ORIGIN);
  const user = { id: MEMBER, name: "Achieng Otieno", email: "achieng@example.test", image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${MEMBER}-session`, userId: MEMBER, userAgent: "Mozilla/5.0" } });
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (method === "POST") {
    headers["content-type"] = "application/x-www-form-urlencoded";
    if (origin) headers.origin = origin;
  }
  const request = () => new Request(url, { method, headers, body: form ? new URLSearchParams(form).toString() : undefined });
  const locals = {} as App.Locals;
  const context = {
    url, request: request(), locals, params: {},
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () => container.renderToResponse(Page, { request: request(), locals })) as Response;
  return { status: response.status, headers: response.headers, body: await response.text() };
}

const dom = (html: string) => {
  const { document } = new Window();
  document.body.innerHTML = html;
  return document.body;
};
type Root = ReturnType<typeof dom>;
const main = (html: string) => dom(html).querySelector("#spaces-main")!;
const primaries = (root: Pick<Root, "querySelectorAll">) =>
  [...root.querySelectorAll("a, button")].filter((control) => control.getAttribute("data-variant") === "primary" || control.classList.contains("bg-primary"));
type Node = { compareDocumentPosition(other: never): number };
const follows = (first: Node, second: Node) => Boolean(first.compareDocumentPosition(second as never) & 4 /* DOCUMENT_POSITION_FOLLOWING */);

describe("Community's home", () => {
  it("explains a saved profile hold to its author", async () => {
    seeded("UPDATE studentProfile SET moderationOutcome='hold';");
    const notice = main((await visit()).body).querySelector("[data-notice='warning']");
    expect(notice?.textContent).toContain("Your profile is waiting for a check");
    expect(notice?.textContent).toContain("until then only you and the team can");
  });

  it("explains held work to its author without calling it a draft", async () => {
    seeded("UPDATE communityJourney SET moderationOutcome='hold' WHERE id='ledger';");
    const page = main((await visit()).body);
    expect(page.textContent).toContain("Saved, and waiting for a person at TTV to check it. Only you and the team can see it until then.");
    expect(page.textContent).not.toContain("A draft: only you can see it.");
  });

  it("leads with the kit title and one sentence, with no display hero", async () => {
    seeded();
    const { status, body } = await visit();
    expect(status).toBe(200);
    const page = main(body);
    const h1 = page.querySelector("h1")!;
    expect(h1.textContent).toBe("Community");
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    expect(page.querySelector("h1, h2, h3")).toBe(h1);
    expect(page.querySelector("[data-page-header]")?.textContent).toContain("Show what you made, what you learned, and the part that was yours.");
    expect(page.innerHTML).not.toMatch(/discovery-|<em>|\bfont-display\b|\buppercase\b|tracking-\[/);
  });

  it("has Post work, in the one editor, as its one peach action", async () => {
    seeded();
    const page = main((await visit()).body);
    const [primary, ...others] = primaries(page);
    expect(others).toEqual([]);
    expect(primary?.textContent?.trim()).toBe("Post work");
    expect(primary?.getAttribute("href")).toBe(`${EDITOR}?add=1#work-editor`);
  });

  it("puts Your spaces after the title", async () => {
    seeded(`INSERT INTO UserRoles(id,userId,roleId) SELECT 'mentor-role','${MEMBER}',id FROM Roles WHERE name='MENTOR';`);
    const page = main((await visit()).body);
    const spaces = page.querySelector("[data-onboarding-spaces]");
    expect(spaces).not.toBeNull();
    expect(follows(page.querySelector("h1")!, spaces!)).toBe(true);
    expect(primaries(page).map((control) => control.textContent?.trim())).toEqual(["Post work"]);
  });

  it("follows the title with a member's way into a cohort, a kit card with a quiet button", async () => {
    seeded(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
      INSERT INTO program(id,name,description,curriculumId,startDate,endDate,applicationsOpen) VALUES ('cohort-a','Cohort 08','Test','curriculum',4102444800,4105036800,1);`);
    const page = main((await visit()).body);
    const invitation = page.querySelector("[data-cohort-invitation]");
    expect(invitation?.hasAttribute("data-card")).toBe(true);
    expect(follows(page.querySelector("h1")!, invitation!)).toBe(true);
    expect(invitation?.querySelector("a")?.getAttribute("data-variant")).toBe("quiet");
    expect(primaries(page).map((control) => control.textContent?.trim())).toEqual(["Post work"]);
  });

  it("draws the profile as a kit card with an avatar, its name a Maven h2, and a quiet way to the editor", async () => {
    seeded();
    const page = main((await visit()).body);
    const card = page.querySelector("[data-community-profile]")!;
    expect(card.hasAttribute("data-card")).toBe(true);
    expect(card.querySelector(`[data-avatar='${MEMBER}']`)?.textContent).toBe("AO");
    const name = card.querySelector("h2")!;
    expect(name.textContent).toBe("Achieng Otieno");
    expect(name.className).not.toMatch(/font-(display|heading)/);
    expect(card.textContent).toContain("Frontend builder");
    expect(card.textContent).toContain("What you're looking for");
    expect(card.textContent).toContain("A first developer role in Nairobi");
    const edit = [...card.querySelectorAll("a")].find((link) => link.textContent?.trim() === "Edit your profile");
    expect(edit?.getAttribute("data-variant")).toBe("quiet");
    expect(edit?.getAttribute("href")).toBe(`${EDITOR}#profile-form`);
  });

  it("says who sees the work in an info notice, and lists it with its confirmation and the way to edit it", async () => {
    seeded();
    const page = main((await visit()).body);
    const journey = page.querySelector("[data-community-journey]")!;
    expect(journey.querySelector("h2")?.textContent).toBe("Your journey");
    const notice = [...journey.querySelectorAll("[data-notice]")].find((item) => item.textContent?.includes("Who sees this"));
    expect(notice?.getAttribute("data-notice")).toBe("info");
    expect(notice?.textContent).toContain("Everyone signed in to TTV can see your profile and everything you post. If you complete a cohort and publish, it's also on the public website, where anyone can see it.");
    expect(notice?.textContent).not.toMatch(/institutions can discover|Private contributions/i);
    expect(notice?.querySelector("a")?.getAttribute("href")).toBe("/dashboard/community/members");
    const entry = journey.querySelector("[data-data-list] [data-data-list-item]")!;
    expect(entry.querySelector("h3")?.textContent).toBe("Chama savings ledger");
    expect(entry.querySelector("time")?.textContent).toBe("24 Oct 2026");
    expect(entry.querySelector("[data-confirmation='current']")?.textContent).toContain("Checked by Baraka Mwangi");
    const edit = entry.querySelector("[data-row-action]")!;
    expect(edit.textContent).toBe("Edit Chama savings ledger");
    expect(edit.getAttribute("href")).toBe(`${EDITOR}?edit=ledger#work-editor`);
    expect(entry.querySelector("a[target='_blank']")?.getAttribute("href")).toBe("https://github.com/example/ledger");
  });

  it("offers a member with no work a first step, and nothing like it to someone looking around", async () => {
    seeded("DELETE FROM communityConfirmation; DELETE FROM communityJourney;");
    let page = main((await visit()).body);
    expect(page.querySelector("[data-community-journey] [data-empty-state]")?.textContent).toContain("Your first piece of work belongs here.");
    seeded(`DELETE FROM communityConfirmation; DELETE FROM communityJourney;
      INSERT INTO member_intent(userId,intent,createdAt) VALUES ('${MEMBER}','EXPLORING',1);`);
    page = main((await visit()).body);
    expect(page.querySelector("[data-community-journey] [data-empty-state]")).toBeNull();
  });

  it("says a change once, after its redirect", async () => {
    seeded();
    const flash = encodeURIComponent(JSON.stringify({ tone: "success", title: "Posted", path: PATH }));
    const page = main((await visit({ cookie: `${FLASH_COOKIE}=${flash}` })).body);
    const notice = page.querySelector("[data-notice='success']");
    expect(notice?.textContent).toContain("Posted");
    expect(notice?.hasAttribute("autofocus")).toBe(true);
  });

  it("edits nothing itself: no form posts here, and a post is refused", async () => {
    seeded();
    const page = main((await visit()).body);
    // Onboarding's own prompt may post to its own address; nothing posts to this page.
    expect([...page.querySelectorAll("form")].filter((form) => [null, "", PATH].includes(form.getAttribute("action")))).toEqual([]);
    expect(page.querySelector("[data-community-profile] form, [data-community-journey] form")).toBeNull();
    const { status, headers } = await visit({ method: "POST", form: { form: "profile", headline: "Typed here" } });
    expect(status).toBe(405);
    expect(headers.get("allow")).toBe("GET, HEAD");
    expect(sqlite.prepare(`SELECT headline FROM studentProfile WHERE userId = '${MEMBER}'`).get()).toEqual({ headline: "Frontend builder" });
  });

  it("says when it couldn't load the profile at all", async () => {
    seeded("DROP TABLE communityConfirmation;");
    const { status, body } = await visit();
    expect(status).toBe(200);
    const page = main(body);
    expect(page.querySelector("[data-notice='danger']")?.textContent).toContain("We couldn't load your profile");
    expect(primaries(page)).toEqual([]);
  });

  it("has no island and no flag-off branch of its own", () => {
    const source = readFileSync(new URL("../../community.astro", import.meta.url), "utf8");
    expect(source).not.toMatch(/client:|CommunityApp|discovery\.css|BaseLayout|legacyTag|legacyClass/);
  });
});
