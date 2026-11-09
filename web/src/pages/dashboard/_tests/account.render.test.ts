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
import { ACCOUNT_COPY } from "@/lib/student/account-page";

/*
 * /dashboard/account on the kit (style-guide rollout M12, audit A§15): the person drawn as the shell
 * draws them (kit Avatar), kit fields, one primary ("Save name"), a quiet "Upload photo", and each
 * form answered with a 303 plus a read-once flash, or a refusal that keeps what was typed beside a
 * focused danger Notice. Through the real middleware and page on SQLite with every migration;
 * authentication is mocked. Onboarding's own rows are covered by its specs.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../profile.astro");

const MEMBER = "synthetic-akinyi";
const ORIGIN = "https://ttv.invalid";
const PATH = "/dashboard/account";
const databases: DatabaseSync[] = [];
let sqlite: DatabaseSync;
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seeded() {
  const { database, db } = createSqliteD1();
  sqlite = database;
  databases.push(database);
  for (const file of readdirSync(new URL("../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO user(id,name,email) VALUES ('${MEMBER}','Akinyi Otieno','akinyi@example.test');
    UPDATE feature_flag SET audience='ALL';`);
  Object.assign(mocks.env, { DB: withRaw(database, db), DEPLOYMENT_ENVIRONMENT: "production" });
}

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
  return { status: response.status, headers: response.headers, body: await response.text() };
}

const main = (html: string) => {
  const { document } = new Window();
  document.body.innerHTML = html;
  return document.body.querySelector("#spaces-main")!;
};
const flashCookie = (title: string) => `${FLASH_COOKIE}=${encodeURIComponent(JSON.stringify({ tone: "success", title, path: PATH }))}`;

describe("Account", () => {
  it("draws the person as the shell does, with kit fields and one primary", async () => {
    seeded();
    const { status, body } = await visit();
    expect(status).toBe(200);
    const page = main(body);
    expect(page.querySelector("h1")?.textContent).toBe("Account");
    expect([...page.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(expect.arrayContaining(["Your details", "Photo"]));
    expect(page.querySelector("[data-account-name] input[name='name']")?.getAttribute("value")).toBe("Akinyi Otieno");
    expect(page.querySelector("#account-email")?.hasAttribute("disabled")).toBe(true);
    expect(page.querySelector("[data-account-photo] input[type='file'][name='avatar']")).not.toBeNull();
    expect([...page.querySelectorAll("[data-variant='primary']")].map((b) => b.textContent)).toEqual(["Save name"]);
    expect(page.querySelector("[data-account-photo] button[type='submit']")?.getAttribute("data-variant")).toBe("quiet");
    expect(page.innerHTML).not.toMatch(/form-control|text-white|bg-green-|text-red-|bg-teal\b|Save Changes|Upload Photo|successfully!/);
  });

  it("saves a name with a 303 to this page, which says so once", async () => {
    seeded();
    const { status, headers } = await visit({ body: new URLSearchParams({ action: "profile", name: "  Akinyi Achieng  " }) });
    expect(status).toBe(303);
    expect(headers.get("location")).toBe(PATH);
    expect(sqlite.prepare("SELECT name FROM user WHERE id = ?").get(MEMBER)).toEqual({ name: "Akinyi Achieng" });
    const page = main((await visit({ cookie: flashCookie(ACCOUNT_COPY.nameSaved) })).body);
    expect(page.querySelector("[data-notice='success']")?.textContent).toContain(ACCOUNT_COPY.nameSaved);
    expect(page.querySelector("[data-notice='danger']")).toBeNull();
  });

  it("refuses an empty name with a 400, the error under the field and a focused danger notice", async () => {
    seeded();
    const { status, body } = await visit({ body: new URLSearchParams({ action: "profile", name: "   " }) });
    expect(status).toBe(400);
    expect(body).toMatch(/<title>Error: /);
    const page = main(body);
    const notice = page.querySelector("[data-notice='danger']")!;
    expect(notice.hasAttribute("autofocus")).toBe(true);
    expect(notice.textContent).toContain(ACCOUNT_COPY.nameNotSaved);
    const field = page.querySelector("[data-account-name] input[name='name']")!;
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(page.querySelector("[data-account-name]")?.textContent).toContain(ACCOUNT_COPY.noName);
    expect(sqlite.prepare("SELECT name FROM user WHERE id = ?").get(MEMBER)).toEqual({ name: "Akinyi Otieno" });
  });

  it("refuses an upload with no image with a 400 under the photo field, writing nothing", async () => {
    seeded();
    const form = new FormData();
    form.set("action", "avatar");
    form.set("avatar", new File([], ""));
    const { status, body } = await visit({ body: form });
    expect(status).toBe(400);
    const page = main(body);
    expect(page.querySelector("[data-notice='danger']")?.textContent).toContain(ACCOUNT_COPY.photoNotSaved);
    expect(page.querySelector("[data-account-photo]")?.textContent).toContain(ACCOUNT_COPY.noPhoto);
    expect(page.querySelector("[data-account-name] [aria-invalid='true']")).toBeNull();
    expect(sqlite.prepare("SELECT image FROM user WHERE id = ?").get(MEMBER)).toEqual({ image: null });
  });
});
