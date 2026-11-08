import { readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { Window } from "happy-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRaw } from "@/lib/attention/test-support";
import { linkClass } from "@/components/platform/ui";

/*
 * /dashboard/me/leads, Visitor messages, on the style guide (S13): each message is a kit card with
 * its state in words, its sender a heading the row's small buttons point at (aria-describedby), so
 * "Mark read, Mark read" tells a screen reader whose; the address is a prose link; nothing says
 * "leads". A post answers 303 to a notice, 400 for a message that isn't the person's, and changes
 * nobody else's. Through the real middleware and page on SQLite with every migration; authentication
 * is mocked.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../leads.astro");

const BUILDER = "synthetic-achieng";
const ORIGIN = "https://ttv.invalid";
const PATH = "/dashboard/me/leads";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

/** Achieng's published profile with a new and a read message, and another builder's message. */
const MESSAGES = `INSERT INTO studentProfile(id,userId,handle,status) VALUES ('profile','${BUILDER}','achieng-otieno','PUBLISHED');
  INSERT INTO user(id,name,email) VALUES ('synthetic-baraka','Baraka Mwangi','baraka@example.test');
  INSERT INTO studentProfile(id,userId,handle,status) VALUES ('other-profile','synthetic-baraka','baraka-mwangi','PUBLISHED');
  INSERT INTO profileContact(id,profileId,fromName,fromEmail,organization,message,status,createdAt) VALUES
    ('new','profile','Grace Wanjiru','grace@example.test','Chama Savings','Could you help with our savings tracker?','NEW',2),
    ('read','profile','Neema Ally','neema@example.test',NULL,'Loved your ledger project.','READ',1),
    ('theirs','other-profile','Juma Said','juma@example.test',NULL,'Hello Baraka.','NEW',3);`;

let sqlite: DatabaseSync;
function seeded(extra = MESSAGES) {
  const created = createSqliteD1();
  sqlite = created.database;
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO user(id,name,email) VALUES ('${BUILDER}','Achieng Otieno','achieng@example.test');
    UPDATE feature_flag SET audience='ALL';
    ${extra}`);
  Object.assign(mocks.env, { DB: withRaw(sqlite, created.db), DEPLOYMENT_ENVIRONMENT: "production" });
}

const statusOf = (id: string) => (sqlite.prepare("SELECT status FROM profileContact WHERE id = ?").get(id) as { status: string }).status;

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

async function visit({ search = "", form }: { search?: string; form?: Record<string, string> } = {}) {
  const url = new URL(PATH + search, ORIGIN);
  const request = () => form
    ? new Request(url, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) })
    : new Request(url);
  const user = { id: BUILDER, name: "Achieng Otieno", email: "achieng@example.test", image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${BUILDER}-session`, userId: BUILDER, userAgent: "Mozilla/5.0" } });
  const locals = {} as App.Locals;
  const context = {
    url, request: request(), locals, params: {},
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () =>
    container.renderToResponse(Page, { request: request(), locals })) as Response;
  const { document } = new Window();
  document.body.innerHTML = await response.text();
  return { status: response.status, location: response.headers.get("location"), body: document.body };
}

describe("Visitor messages", () => {
  it("shows each message as a kit card, its sender the heading its buttons describe", async () => {
    seeded();
    const { status, body } = await visit();
    expect(status).toBe(200);
    const page = body.querySelector("#spaces-main")!;
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    expect(page.textContent).not.toMatch(/\blead/i);
    const rows = [...page.querySelectorAll("[data-visitor-message]")];
    expect(rows.map((row) => row.querySelector("[data-status]")?.textContent)).toEqual(["New", "Read"]);
    expect(page.textContent).not.toContain("Juma Said");
    const [fresh, read] = rows;
    expect(fresh?.querySelector("[data-card]")).not.toBeNull();
    const heading = fresh?.querySelector("h2");
    expect(heading?.textContent).toBe("Grace Wanjiru · Chama Savings");
    const buttons = [...(fresh?.querySelectorAll("button[type='submit']") ?? [])];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(["Mark read", "Archive"]);
    for (const button of buttons) {
      expect(button.getAttribute("aria-describedby")).toBe(heading?.id);
      expect(button.getAttribute("data-size")).toBe("sm");
    }
    expect([...(read?.querySelectorAll("button") ?? [])].map((button) => button.textContent?.trim())).toEqual(["Archive"]);
    const mail = fresh?.querySelector("a[href='mailto:grace@example.test']");
    expect(mail?.getAttribute("class")).toContain(linkClass());
    expect(mail?.hasAttribute("target")).toBe(false);
    expect(page.querySelector("[data-chip]")?.textContent).toBe("1 unread");
  });

  it("marks a message read with a 303 to a notice, so a reload never posts again", async () => {
    seeded();
    const posted = await visit({ form: { contactId: "new", status: "READ" } });
    expect(posted.status).toBe(303);
    expect(posted.location).toBe(`${PATH}?done=read`);
    expect(statusOf("new")).toBe("READ");
    const { body } = await visit({ search: "?done=read" });
    expect(body.querySelector("[role='status']")?.textContent).toContain("Marked as read.");
  });

  it("answers 400 and changes nothing for another builder's message or a bad form", async () => {
    seeded();
    const theirs = await visit({ form: { contactId: "theirs", status: "ARCHIVED" } });
    expect(theirs.status).toBe(400);
    expect(statusOf("theirs")).toBe("NEW");
    expect(theirs.body.querySelector("[role='alert']")?.textContent).toContain("That message isn't here any more.");
    const bad = await visit({ form: { contactId: "new", status: "DELETED" } });
    expect(bad.status).toBe(400);
    expect(statusOf("new")).toBe("NEW");
  });

  it("asks someone without a profile to create one, with the kit's empty state", async () => {
    seeded("");
    const { body } = await visit();
    const empty = body.querySelector("[data-empty-state]");
    expect(empty?.querySelector("h2")?.textContent).toBe("Set up your public profile first");
    expect(empty?.querySelector("a[data-variant='primary']")?.getAttribute("href")).toBe("/dashboard/me/portfolio");
  });
});
