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
 * /dashboard/me/opportunities on the style guide (S14): each approved project is a kit card with a
 * quiet "Raise your hand" (no peach per card), the note is a labelled kit field, and a refused note
 * comes back with what was typed and the reason beside it (400). Raising and withdrawing answer 303
 * to a notice. A profile that isn't published sees the gate, and no project is read for it. Through
 * the real middleware and page on SQLite with every migration; authentication is mocked.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../opportunities.astro");

const BUILDER = "synthetic-achieng";
const ORIGIN = "https://ttv.invalid";
const PATH = "/dashboard/me/opportunities";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

const PROJECTS = `INSERT INTO clientProject(id,organization,contactName,contactEmail,title,description,skills,timeline,status,createdAt) VALUES
    ('savings','Chama Savings','Grace Wanjiru','grace@example.test','Member savings tracker','Track contributions for 40 members.','["TypeScript","SQL"]','6 weeks','APPROVED',2),
    ('proposed','Duka','Neema Ally','neema@example.test','Stock counts','Fictional.',NULL,NULL,'PENDING',3);`;

let sqlite: DatabaseSync;
function seeded(status: "PUBLISHED" | "DRAFT" = "PUBLISHED") {
  const created = createSqliteD1();
  sqlite = created.database;
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO user(id,name,email) VALUES ('${BUILDER}','Achieng Otieno','achieng@example.test');
    INSERT INTO studentProfile(id,userId,handle,status) VALUES ('profile','${BUILDER}','achieng-otieno','${status}');
    UPDATE feature_flag SET audience='ALL';
    ${PROJECTS}`);
  Object.assign(mocks.env, { DB: withRaw(sqlite, created.db), DEPLOYMENT_ENVIRONMENT: "production" });
}

const interest = () => sqlite.prepare("SELECT status, note FROM projectInterest WHERE projectId = 'savings'").get() as { status: string; note: string | null } | undefined;

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

describe("Opportunities", () => {
  it("lists approved projects as kit cards with a labelled note and a quiet action", async () => {
    seeded();
    const { status, body } = await visit();
    expect(status).toBe(200);
    const page = body.querySelector("#spaces-main")!;
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    const cards = [...page.querySelectorAll("[data-opportunity]")];
    expect(cards.map((card) => card.querySelector("h2")?.textContent)).toEqual(["Member savings tracker"]);
    const [card] = cards;
    expect(card?.querySelector("[data-card]")).not.toBeNull();
    expect(card?.querySelector(".uppercase")).toBeNull();
    expect([...(card?.querySelectorAll("[aria-label='Skills'] [data-chip]") ?? [])].map((chip) => chip.textContent)).toEqual(["TypeScript", "SQL"]);
    const note = card?.querySelector("textarea[name='note']");
    expect(page.querySelector(`label[for='${note?.id}']`)?.textContent).toContain("Why you're a fit");
    const raise = card?.querySelector("button[type='submit']");
    expect(raise?.textContent?.trim()).toBe("Raise your hand");
    expect(raise?.getAttribute("data-variant")).toBe("quiet");
    expect(page.querySelector("[data-variant='primary']")).toBeNull();
  });

  it("keeps a refused note, with its reason beside the field, and saves nothing (400)", async () => {
    seeded();
    const long = "I built a ledger. ".repeat(40);
    const { status, body } = await visit({ form: { _action: "interest", projectId: "savings", note: long } });
    expect(status).toBe(400);
    expect(interest()).toBeUndefined();
    const note = body.querySelector("textarea[name='note']");
    expect(note?.textContent).toBe(long);
    expect(note?.getAttribute("aria-invalid")).toBe("true");
    expect(body.querySelector("[role='alert']")?.textContent).toContain("500 characters or fewer");
  });

  it("raises a hand and withdraws it, each with a 303 to a notice", async () => {
    seeded();
    const raised = await visit({ form: { _action: "interest", projectId: "savings", note: "I built a savings ledger." } });
    expect(raised.status).toBe(303);
    expect(raised.location).toBe(`${PATH}?done=raised`);
    expect(interest()).toEqual({ status: "INTERESTED", note: "I built a savings ledger." });
    const after = await visit({ search: "?done=raised" });
    expect(after.body.querySelector("[role='status']")?.textContent).toContain("You raised your hand for this project.");
    const card = after.body.querySelector("[data-opportunity]");
    expect(card?.textContent).toContain("Hand raised");
    expect(card?.textContent).toContain("Your note: I built a savings ledger.");
    const withdrawn = await visit({ form: { _action: "withdraw", projectId: "savings" } });
    expect(withdrawn.status).toBe(303);
    expect(withdrawn.location).toBe(`${PATH}?done=withdrawn`);
    expect(interest()?.status).toBe("WITHDRAWN");
  });

  it("refuses interest in a project that isn't approved (400)", async () => {
    seeded();
    const { status, body } = await visit({ form: { _action: "interest", projectId: "proposed", note: "" } });
    expect(status).toBe(400);
    expect(body.querySelector("[role='alert']")?.textContent).toContain("isn't taking interest");
    expect(sqlite.prepare("SELECT count(*) AS n FROM projectInterest").get()).toEqual({ n: 0 });
  });

  it("shows a draft profile the gate, reads no project for it, and refuses its posts", async () => {
    seeded("DRAFT");
    const { body } = await visit();
    const empty = body.querySelector("[data-empty-state]");
    expect(empty?.querySelector("h2")?.textContent).toBe("Opportunities open with a published profile");
    expect(empty?.querySelector("a")?.getAttribute("data-variant")).toBe("quiet");
    expect(body.textContent).not.toContain("Member savings tracker");
    const posted = await visit({ form: { _action: "interest", projectId: "savings", note: "" } });
    expect(posted.status).toBe(400);
    expect(interest()).toBeUndefined();
  });
});
