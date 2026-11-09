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
 * The post editor (/dashboard/me/writing/[id]) on the kit, in the immersive pattern (style-guide rollout M14,
 * audit A§18, decision D4): a named h1 in the island's server render, and without JavaScript a kit form
 * (fields, one primary, no form-control) whose "Delete draft" is a step of its own (?confirm=delete, then a
 * ConfirmStep that posts). Through the real middleware and page on SQLite with every migration;
 * authentication is mocked. The editor's interactions: e2e/writing-editor.spec.ts.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../writing/[id].astro");

const BUILDER = "synthetic-achieng";
const ORIGIN = "https://ttv.invalid";
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
  database.exec(`INSERT INTO user(id,name,email) VALUES ('${BUILDER}','Achieng Otieno','achieng@example.test');
    INSERT INTO studentProfile(id,userId,handle,status) VALUES ('profile','${BUILDER}','achieng-otieno','PUBLISHED');
    UPDATE feature_flag SET audience='ALL';
    INSERT INTO blogPost(id,profileId,slug,title,contentMarkdown,status,readingMinutes,publishedAt,updatedAt) VALUES
      ('draft','profile','ledgers','What ledgers taught me','Fictional.','DRAFT',3,NULL,2);`);
  Object.assign(mocks.env, { DB: withRaw(database, db), DEPLOYMENT_ENVIRONMENT: "production" });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

async function visit({ query = "", form }: { query?: string; form?: Record<string, string> } = {}) {
  const url = new URL(`/dashboard/me/writing/draft${query}`, ORIGIN);
  const user = { id: BUILDER, name: "Achieng Otieno", email: "achieng@example.test", image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${BUILDER}-session`, userId: BUILDER, userAgent: "Mozilla/5.0" } });
  const headers: Record<string, string> = form ? { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN } : {};
  const request = () => new Request(url, { method: form ? "POST" : "GET", headers, body: form ? new URLSearchParams(form).toString() : undefined });
  const locals = {} as App.Locals;
  const context = {
    url, request: request(), locals, params: { id: "draft" },
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () =>
    container.renderToResponse(Page, { request: request(), locals, params: { id: "draft" } })) as Response;
  return { status: response.status, headers: response.headers, html: await response.text() };
}

/** What a browser without JavaScript shows: the contents of the page's <noscript>. */
function withoutScript(html: string) {
  const inner = /<noscript>([\s\S]*)<\/noscript>/.exec(html)?.[1] ?? "";
  const { document } = new Window();
  document.body.innerHTML = inner;
  return document.body;
}

describe("Post editor", () => {
  it("names the page with a visually hidden h1, and keeps the old palette out", async () => {
    seeded();
    const { status, html } = await visit();
    expect(status).toBe(200);
    expect(html).toMatch(/<h1 class="sr-only">Edit post<\/h1>/);
    expect(html).toContain("bg-sheet-profile");
    expect(html).not.toMatch(/form-control|from-surface|text-red-|bg-red-|emerald-|text-white/);
  });

  it("offers a kit form without JavaScript, with one primary and deleting as a step of its own", async () => {
    seeded();
    const form = withoutScript((await visit()).html);
    expect(form.querySelector("h1")?.textContent).toBe("Edit post");
    expect(form.querySelector("input[name='title']")?.getAttribute("value")).toBe("What ledgers taught me");
    expect([...form.querySelectorAll("[data-variant='primary']")].map((b) => b.textContent)).toEqual(["Save and publish"]);
    const remove = form.querySelector("a[href*='confirm=delete']")!;
    expect(remove.textContent).toBe("Delete draft");
    expect(form.querySelector("button[value='delete']")).toBeNull();
  });

  it("asks before deleting, then deletes on the confirmed post", async () => {
    seeded();
    const step = withoutScript((await visit({ query: "?confirm=delete" })).html).querySelector("[data-confirm-step]")!;
    expect(step.textContent).toContain("Delete this draft?");
    expect(step.querySelector("input[name='_action']")?.getAttribute("value")).toBe("delete");

    const { status, headers } = await visit({ form: { _action: "delete" } });
    expect([302, 303]).toContain(status);
    expect(headers.get("location")).toBe("/dashboard/writing");
    expect(sqlite.prepare("SELECT count(*) AS n FROM blogPost").get()).toEqual({ n: 0 });
  });
});
