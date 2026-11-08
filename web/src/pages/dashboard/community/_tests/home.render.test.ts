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
 * /dashboard/community, Community's home, rebuilt on the kit (style-guide rollout M15, D5): the kit
 * PageTitle "Community" and one sentence lead, onboarding's cards follow it, the profile is a kit card
 * with an avatar, "Who can discover this?" is an info notice, and "Add a contribution" is the one peach
 * action. No island: the editors open from links and save through plain forms, so everything works
 * without a script. Through the real middleware and page on SQLite with every migration;
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
    INSERT INTO communityProfile(userId,headline,bio,skills,opportunityGoals) VALUES ('${MEMBER}','Frontend builder','Builds savings tools.','["TypeScript"]','A first developer role in Nairobi');
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
const journeyTitles = () => sqlite.prepare("SELECT title FROM communityJourney WHERE userId = ? ORDER BY title").all(MEMBER).map((row) => row.title);

const CONTRIBUTION = { form: "contribution", title: "Matatu fare splitter", description: "Wrote the fare-splitting logic and its tests.", date: "2026-10-30", sourceUrl: "" };

describe("Community's home", () => {
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
    expect(page.textContent).not.toContain("Your story.");
    expect(page.innerHTML).not.toMatch(/discovery-|<em>|\bfont-display\b|\buppercase\b|tracking-\[/);
  });

  it("has Add a contribution as its one peach action", async () => {
    seeded();
    const page = main((await visit()).body);
    const [primary, ...others] = primaries(page);
    expect(others).toEqual([]);
    expect(primary?.textContent?.trim()).toBe("Add a contribution");
    expect(primary?.getAttribute("href")).toBe(`${PATH}?add=1#contribution-editor`);
  });

  it("puts Your spaces after the title", async () => {
    seeded(`INSERT INTO UserRoles(id,userId,roleId) SELECT 'mentor-role','${MEMBER}',id FROM Roles WHERE name='MENTOR';`);
    const page = main((await visit()).body);
    const spaces = page.querySelector("[data-onboarding-spaces]");
    expect(spaces).not.toBeNull();
    expect(follows(page.querySelector("h1")!, spaces!)).toBe(true);
    expect(primaries(page).map((control) => control.textContent?.trim())).toEqual(["Add a contribution"]);
  });

  it("follows the title with a member's way into a cohort, a kit card with a quiet button", async () => {
    seeded(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
      INSERT INTO program(id,name,description,curriculumId,startDate,endDate,applicationsOpen) VALUES ('cohort-a','Cohort 08','Test','curriculum',4102444800,4105036800,1);`);
    const page = main((await visit()).body);
    const invitation = page.querySelector("[data-cohort-invitation]");
    expect(invitation?.hasAttribute("data-card")).toBe(true);
    expect(follows(page.querySelector("h1")!, invitation!)).toBe(true);
    expect(invitation?.querySelector("a")?.getAttribute("data-variant")).toBe("quiet");
    expect(primaries(page).map((control) => control.textContent?.trim())).toEqual(["Add a contribution"]);
  });

  it("draws the profile as a kit card with an avatar, its name a Maven h2, and a quiet way to edit it", async () => {
    seeded();
    const page = main((await visit()).body);
    const card = page.querySelector("[data-community-profile]")!;
    expect(card.hasAttribute("data-card")).toBe(true);
    expect(card.querySelector(`[data-avatar='${MEMBER}']`)?.textContent).toBe("AO");
    const name = card.querySelector("h2")!;
    expect(name.textContent).toBe("Achieng Otieno");
    expect(name.className).not.toMatch(/font-(display|heading)/);
    expect(card.textContent).toContain("Frontend builder");
    expect(card.textContent).toContain("A first developer role in Nairobi");
    const edit = [...card.querySelectorAll("a")].find((link) => link.textContent?.trim() === "Edit your profile");
    expect(edit?.getAttribute("data-variant")).toBe("quiet");
    expect(edit?.getAttribute("href")).toBe(`${PATH}?profile=edit#profile-editor`);
  });

  it("says who can discover the work in an info notice, and lists the journey with its confirmation", async () => {
    seeded();
    const page = main((await visit()).body);
    const journey = page.querySelector("[data-community-journey]")!;
    expect(journey.querySelector("h2")?.textContent).toBe("Your journey");
    const notice = [...journey.querySelectorAll("[data-notice]")].find((item) => item.textContent?.includes("Who can discover this?"));
    expect(notice?.getAttribute("data-notice")).toBe("info");
    const entry = journey.querySelector("[data-data-list] [data-data-list-item]")!;
    expect(entry.querySelector("h3")?.textContent).toBe("Chama savings ledger");
    expect(entry.querySelector("time")?.textContent).toBe("24 Oct 2026");
    expect(entry.querySelector("[data-confirmation='current']")?.textContent).toContain("Checked by Baraka Mwangi");
    const edit = entry.querySelector("[data-row-action]")!;
    expect(edit.textContent).toBe("Edit Chama savings ledger");
    expect(edit.getAttribute("href")).toBe(`${PATH}?edit=ledger#contribution-editor`);
    expect(entry.querySelector("a[target='_blank']")?.getAttribute("href")).toBe("https://github.com/example/ledger");
  });

  it("offers a member with no contributions a first step, and nothing like it to someone looking around", async () => {
    seeded("DELETE FROM communityConfirmation; DELETE FROM communityJourney;");
    let page = main((await visit()).body);
    expect(page.querySelector("[data-community-journey] [data-empty-state]")?.textContent).toContain("Your first contribution belongs here.");
    seeded(`DELETE FROM communityConfirmation; DELETE FROM communityJourney;
      INSERT INTO member_intent(userId,intent,createdAt) VALUES ('${MEMBER}','EXPLORING',1);`);
    page = main((await visit()).body);
    expect(page.querySelector("[data-community-journey] [data-empty-state]")).toBeNull();
  });

  it("opens the add editor from its link, with its save as the peach action instead", async () => {
    seeded();
    const page = main((await visit({ path: `${PATH}?add=1` })).body);
    const editor = page.querySelector("[data-contribution-editor='add']")!;
    expect(editor.querySelector("form")?.getAttribute("method")).toBe("POST");
    expect(editor.querySelector("form")?.getAttribute("action")).toBe(PATH);
    expect(primaries(page).map((control) => control.textContent?.trim())).toEqual(["Save contribution"]);
    for (const name of ["title", "description", "date", "sourceUrl"]) expect(editor.querySelector(`[name='${name}']`)).not.toBeNull();
  });

  it("opens a contribution's editor in its place, with the revision it was opened at", async () => {
    seeded();
    const page = main((await visit({ path: `${PATH}?edit=ledger` })).body);
    const editor = page.querySelector("[data-contribution-editor='edit']")!;
    expect(editor.closest("[data-data-list]")).not.toBeNull();
    expect(editor.querySelector("[name='title']")?.getAttribute("value")).toBe("Chama savings ledger");
    expect(editor.querySelector("[name='revision']")?.getAttribute("value")).toBe("1");
    expect(primaries(page).map((control) => control.textContent?.trim())).toEqual(["Save changes"]);
    // Someone else's contribution, or none, opens nothing.
    expect(main((await visit({ path: `${PATH}?edit=elsewhere` })).body).querySelector("[data-contribution-editor]")).toBeNull();
  });

  it("opens the profile editor in the card's place", async () => {
    seeded();
    const page = main((await visit({ path: `${PATH}?profile=edit` })).body);
    expect(page.querySelector("[data-community-profile]")).toBeNull();
    const editor = page.querySelector("[data-profile-editor]")!;
    expect(editor.querySelector("[name='skills']")?.getAttribute("value")).toBe("TypeScript");
    expect(primaries(page).map((control) => control.textContent?.trim())).toEqual(["Save profile"]);
  });

  it("says a save once, after its redirect", async () => {
    seeded();
    const flash = encodeURIComponent(JSON.stringify({ tone: "success", title: "Your contribution has been saved.", path: PATH }));
    const page = main((await visit({ cookie: `${FLASH_COOKIE}=${flash}` })).body);
    const notice = page.querySelector("[data-notice='success']");
    expect(notice?.textContent).toContain("Your contribution has been saved.");
    expect(notice?.hasAttribute("autofocus")).toBe(true);
  });

  it("has no island and no flag-off branch of its own", () => {
    const source = readFileSync(new URL("../../community.astro", import.meta.url), "utf8");
    expect(source).not.toMatch(/client:|CommunityApp|discovery\.css|BaseLayout|legacyTag|legacyClass/);
  });
});

describe("Community's forms, posted without a script", () => {
  it("adds a contribution and answers with a 303 home", async () => {
    seeded();
    const { status, headers } = await visit({ method: "POST", form: CONTRIBUTION });
    expect(status).toBe(303);
    expect(headers.get("location")).toBe(PATH);
    expect(journeyTitles()).toEqual(["Chama savings ledger", "Matatu fare splitter"]);
  });

  it("revises a contribution at the revision it was opened at, keeping its mentor's statement on the old one", async () => {
    seeded();
    const { status } = await visit({ method: "POST", form: { ...CONTRIBUTION, id: "ledger", revision: "1", title: "Chama savings ledger, v2" } });
    expect(status).toBe(303);
    const row = sqlite.prepare("SELECT title, version, visibility FROM communityJourney WHERE id = 'ledger'").get();
    expect(row).toEqual({ title: "Chama savings ledger, v2", version: 2, visibility: "institution" });
    expect(sqlite.prepare("SELECT journeyVersion FROM communityConfirmation WHERE id = 'confirmed'").get()).toEqual({ journeyVersion: 1 });
  });

  it("refuses a stale revision with a 409 and keeps what was typed", async () => {
    seeded("UPDATE communityJourney SET version = 2 WHERE id = 'ledger';");
    const { status, body } = await visit({ method: "POST", form: { ...CONTRIBUTION, id: "ledger", revision: "1", title: "Typed over a stale copy" } });
    expect(status).toBe(409);
    const page = main(body);
    const notice = page.querySelector("[data-notice='danger']")!;
    expect(notice.textContent).toContain("This contribution changed since you opened it");
    expect(notice.hasAttribute("autofocus")).toBe(true);
    expect(page.querySelector("[data-contribution-editor='edit'] [name='title']")?.getAttribute("value")).toBe("Typed over a stale copy");
    expect(body).toMatch(/<title>Error: /);
  });

  it("refuses a form with problems with a 400, an error under each field and everything kept", async () => {
    seeded();
    const { status, body } = await visit({ method: "POST", form: { ...CONTRIBUTION, title: "Hi", description: "Too short", date: "2026-02-30", sourceUrl: "http://example.test" } });
    expect(status).toBe(400);
    const editor = main(body).querySelector("[data-contribution-editor='add']")!;
    expect(editor.querySelector("[data-notice='danger']")?.textContent).toContain("4 things to fix");
    expect(editor.querySelectorAll("[aria-invalid='true']")).toHaveLength(4);
    expect(editor.querySelector("[name='description']")?.textContent).toBe("Too short");
    expect(journeyTitles()).toEqual(["Chama savings ledger"]);
  });

  it("saves the community profile", async () => {
    seeded();
    const { status } = await visit({ method: "POST", form: { form: "profile", headline: "Full-stack builder", bio: "Builds savings tools.", skills: "TypeScript, SQL, TypeScript", opportunityGoals: "An internship" } });
    expect(status).toBe(303);
    expect(sqlite.prepare(`SELECT headline, skills, opportunityGoals FROM communityProfile WHERE userId = '${MEMBER}'`).get())
      .toEqual({ headline: "Full-stack builder", skills: '["TypeScript","SQL"]', opportunityGoals: "An internship" });
  });

  it("answers a database failure with a 503 and keeps the profile as typed", async () => {
    seeded(`CREATE TRIGGER profile_down_insert BEFORE INSERT ON communityProfile BEGIN SELECT RAISE(ABORT, 'down'); END;
      CREATE TRIGGER profile_down_update BEFORE UPDATE ON communityProfile BEGIN SELECT RAISE(ABORT, 'down'); END;`);
    const { status, body } = await visit({ method: "POST", form: { form: "profile", headline: "Kept headline", bio: "", skills: "", opportunityGoals: "" } });
    expect(status).toBe(503);
    const editor = main(body).querySelector("[data-profile-editor]")!;
    expect(editor.querySelector("[data-notice='danger']")?.textContent).toContain("Couldn't save your profile");
    expect(editor.querySelector("[name='headline']")?.getAttribute("value")).toBe("Kept headline");
  });

  it("says when it couldn't load the profile at all", async () => {
    seeded("DROP TABLE communityConfirmation;");
    const { status, body } = await visit();
    expect(status).toBe(200);
    const page = main(body);
    expect(page.querySelector("[data-notice='danger']")?.textContent).toContain("We couldn't load your community profile");
    expect(primaries(page)).toEqual([]);
  });

  it("refuses a post from another origin, or without one", async () => {
    seeded();
    for (const origin of ["https://elsewhere.example", null]) {
      const { status } = await visit({ method: "POST", form: CONTRIBUTION, origin });
      expect(status).toBe(403);
    }
    expect(journeyTitles()).toEqual(["Chama savings ledger"]);
  });
});
