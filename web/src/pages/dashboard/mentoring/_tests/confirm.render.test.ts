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

/*
 * Confirm work (/dashboard/mentoring/confirm) on the kit with no island (style-guide rollout M17, D5): the
 * shared work read on the server, each contribution a kit card with its evidence and history, and every
 * action a plain POST: a confirmation that the community API records (303 plus a flash), a refusal that
 * keeps what the mentor wrote (400, field errors, a focused notice), and a private set-aside and its undo.
 * Through the real middleware and page on SQLite with every migration; authentication is mocked.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../../mentorship.astro");

const MEMBER = "synthetic-david";
const BUILDER = "synthetic-achieng";
const ADMIN = "synthetic-amina";
const ORIGIN = "https://ttv.invalid";
const PATH = "/dashboard/mentoring/confirm";
const databases: DatabaseSync[] = [];
let sqlite: DatabaseSync;
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seeded() {
  const { database, db } = createSqliteD1();
  sqlite = database;
  databases.push(database);
  for (const file of readdirSync(new URL("../../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO user(id,name,email) VALUES ('${MEMBER}','David Kamau','david@example.test'),('${BUILDER}','Achieng Otieno','achieng@example.test');
    INSERT OR IGNORE INTO Roles(id,name) VALUES ('MENTOR','MENTOR');
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'mentor-role','${MEMBER}',id FROM Roles WHERE name='MENTOR';
    INSERT INTO user(id,name,email) VALUES ('${ADMIN}','Amina Hassan','amina@example.test');
    INSERT OR IGNORE INTO Roles(id,name) VALUES ('ADMIN','ADMIN');
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'admin-role','${ADMIN}',id FROM Roles WHERE name='ADMIN';
    INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility,evidenceUrl) VALUES
      ('ledger','${BUILDER}','Chama savings ledger','Built a fictional ledger, with tests.','2026-10-21','institution','https://github.com/example/ledger');
    UPDATE feature_flag SET audience='ALL';`);
  Object.assign(mocks.env, { DB: withRaw(database, db), DEPLOYMENT_ENVIRONMENT: "production" });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

async function visit({ body, cookie, path = PATH, as = MEMBER, userAgent = "Mozilla/5.0" }: { body?: URLSearchParams | FormData; cookie?: string; path?: string; as?: string; userAgent?: string } = {}) {
  const url = new URL(path, ORIGIN);
  const name = sqlite.prepare("SELECT name FROM user WHERE id = ?").get(as) as { name: string };
  mocks.getSession.mockResolvedValue({
    user: { id: as, name: name.name, email: "david@example.test", image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) },
    session: { id: `${as}-session`, userId: as, userAgent },
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

const confirmForm = (fields: Record<string, string>) =>
  new URLSearchParams({ intent: "confirm", id: "ledger", revision: "1", title: "Chama savings ledger", ...fields });
const card = (html: string) => main(html).querySelector("[data-contribution='ledger']");

describe("Confirm work", () => {
  it("lists shared work as kit cards, with no primary and no island", async () => {
    seeded();
    const { status, body } = await visit();
    expect(status).toBe(200);
    const page = main(body);
    expect(page.querySelector("h1")?.textContent).toBe("Confirm work");
    expect(page.querySelector("[data-awaiting-confirmation]")?.getAttribute("data-awaiting-confirmation")).toBe("1");
    const ledger = card(body)!;
    expect(ledger.querySelector("h2")?.textContent).toBe("Chama savings ledger");
    expect(ledger.querySelector("a[target='_blank']")?.getAttribute("href")).toBe("https://github.com/example/ledger");
    expect(ledger.querySelector("form button[type='submit']")?.textContent).toBe("Confirm this revision");
    expect(page.querySelector("[data-variant='primary']")).toBeNull();
    // The shell has its own islands; the page's content has none.
    expect(page.innerHTML).not.toMatch(/astro-island|discovery-|Recognise the work|text-white/);
  });

  it("refuses a thin note with a 400 that keeps what was written, beside a focused notice", async () => {
    seeded();
    const { status, body } = await visit({ body: confirmForm({ method: "Read the code", note: "Looks good" }) });
    expect(status).toBe(400);
    expect(main(body).querySelector("[data-notice='danger']")?.hasAttribute("autofocus")).toBe(true);
    const ledger = card(body)!;
    expect(ledger.querySelector("input[name='method']")?.getAttribute("value")).toBe("Read the code");
    expect(ledger.querySelector("textarea[name='note']")?.textContent).toBe("Looks good");
    expect(ledger.querySelector("textarea[name='note']")?.getAttribute("aria-invalid")).toBe("true");
    expect(sqlite.prepare("SELECT count(*) AS n FROM communityConfirmation").get()).toEqual({ n: 0 });
  });

  it("records a confirmation with a 303 and says it once", async () => {
    seeded();
    const { status, headers } = await visit({
      body: confirmForm({ method: "Ran the ledger's tests", note: "I ran the fictional ledger's tests and read its reconciliation code." }),
    });
    expect(status).toBe(303);
    expect(headers.get("location")).toBe(PATH);
    expect(sqlite.prepare("SELECT journeyId, mentorId, journeyVersion FROM communityConfirmation").all()).toEqual([
      { journeyId: "ledger", mentorId: MEMBER, journeyVersion: 1 },
    ]);
    const after = await visit({ cookie: flashCookie("Confirmed: Chama savings ledger") });
    expect(main(after.body).querySelector("[data-notice='success']")?.textContent).toContain("Confirmed: Chama savings ledger");
    expect(card(after.body)?.querySelector("[data-confirmed]")).not.toBeNull();
  });

  it("refuses a confirmation of a revision that has moved on, keeping the note", async () => {
    seeded();
    const { status, body } = await visit({
      body: confirmForm({ revision: "2", method: "Ran the ledger's tests", note: "I ran the fictional ledger's tests and read its code." }),
    });
    expect(status).toBe(409);
    expect(main(body).querySelector("[data-notice='danger']")?.textContent).toContain("changed since you opened it");
    expect(card(body)?.querySelector("textarea[name='note']")?.textContent).toBe("I ran the fictional ledger's tests and read its code.");
  });

  it("sets work aside privately and puts it back", async () => {
    seeded();
    const fields = { id: "ledger", revision: "1", title: "Chama savings ledger" };
    expect((await visit({ body: new URLSearchParams({ intent: "set-aside", ...fields }) })).status).toBe(303);
    const listed = main((await visit()).body);
    expect(listed.querySelector("[data-contribution='ledger']")).toBeNull();
    expect(listed.querySelector("[data-set-aside-item='ledger']")).not.toBeNull();
    expect(listed.querySelector("[data-awaiting-confirmation]")?.getAttribute("data-awaiting-confirmation")).toBe("0");

    expect((await visit({ body: new URLSearchParams({ intent: "undo", ...fields }) })).status).toBe(303);
    expect(card((await visit()).body)).not.toBeNull();
  });

  it("gives an admin who isn't a mentor the review in their Admin space, at either address", async () => {
    seeded();
    for (const path of ["/dashboard/mentoring", PATH]) {
      const { status, body } = await visit({ path, as: ADMIN });
      expect(status, `${path}`).toBe(200);
      expect(body, `${path}`).toMatch(/class="spaces-shell[^"]*"[^>]*data-space="admin"|data-space="admin"[^>]*class="spaces-shell/);
      expect(main(body).querySelector("h1")?.textContent, `${path}`).toBe("Mentor review");
      expect(card(body), `${path}`).not.toBeNull();
    }
  });

  it("still renders, and says why, when the review refuses the session", async () => {
    seeded();
    // An agent's delegated session reaches the page through its space, but the review takes a person's own browser session.
    const { status, body } = await visit({ userAgent: "ttv-agent:synthetic/1.0" });
    expect(status).toBe(200);
    expect(main(body).querySelector("[data-notice]")?.textContent).toMatch(/own browser session|didn't load/);
    expect(card(body)).toBeNull();
  });
});
