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
 * /dashboard/cohort/application/[id] on the kit (style-guide rollout M10, audit A§13): a BackLink and
 * the kit PageHeader, the facts in a DescriptionList with the status in one word ("Accepted", never
 * "Approved"), sentence case, the answers as the kit's fields with Save as the one peach action, a
 * rejected save kept with a danger Notice that takes focus, and a saved one answered 303 and said once.
 * Through the real middleware and page on SQLite with every migration; authentication is mocked. The
 * browser journeys are e2e/platform-application.spec.ts.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../../application/[id].astro");

const MEMBER = "synthetic-njeri";
const ORIGIN = "https://ttv.invalid";
const PATH = "/dashboard/cohort/application/application";
const databases: DatabaseSync[] = [];
let sqlite: DatabaseSync;
afterEach(() => databases.splice(0).forEach((database) => database.close()));

const ANSWERS = JSON.stringify({
  version: "1", name: "Njeri Wambui", partnerId: "",
  submission: [
    { type: "string", name: "name", label: "Name", value: "Njeri Wambui" },
    { type: "requiredBoolean", name: "htmlCssDone", label: "Did you complete the free portion of the [HTML/CSS course](https://www.codecademy.com/learn/learn-html)?", value: true },
    { type: "textarea", name: "project", label: "Propose an idea for a project you would like to build.", value: "An SMS reminder for chama contributions." },
  ],
});

function seeded(status = "PENDING") {
  const { database, db } = createSqliteD1();
  sqlite = database;
  databases.push(database);
  for (const file of readdirSync(new URL("../../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Full-stack foundations','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate,applicationsOpen) VALUES ('cohort-a','Cohort 08','Test','curriculum',4102444800,4105036800,1);
    INSERT INTO user(id,name,email) VALUES ('${MEMBER}','Njeri Wambui','njeri@example.test');
    UPDATE feature_flag SET audience='ALL';`);
  database.prepare("INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('application',?, 'cohort-a', ?, ?)").run(MEMBER, status, ANSWERS);
  Object.assign(mocks.env, { DB: withRaw(database, db), DEPLOYMENT_ENVIRONMENT: "production" });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

async function visit({ form, cookie }: { form?: Record<string, string>; cookie?: string } = {}) {
  const url = new URL(PATH, ORIGIN);
  mocks.getSession.mockResolvedValue({
    user: { id: MEMBER, name: "Njeri Wambui", email: "njeri@example.test", image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) },
    session: { id: `${MEMBER}-session`, userId: MEMBER, userAgent: "Mozilla/5.0" },
  });
  const headers: Record<string, string> = form ? { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN } : {};
  if (cookie) headers.cookie = cookie;
  const request = () => new Request(url, { method: form ? "POST" : "GET", headers, body: form ? new URLSearchParams(form).toString() : undefined });
  const locals = {} as App.Locals;
  const context = {
    url, request: request(), locals, params: { id: "application" },
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () =>
    container.renderToResponse(Page, { request: request(), locals, params: { id: "application" } })) as Response;
  return { status: response.status, headers: response.headers, body: await response.text() };
}

const main = (html: string) => {
  const { document } = new Window();
  document.body.innerHTML = html;
  return document.body.querySelector("#spaces-main")!;
};
const primaries = (root: ReturnType<typeof main>) =>
  [...root.querySelectorAll("a, button")].filter((control) => control.getAttribute("data-variant") === "primary").map((control) => control.textContent?.trim());

describe("a member's application", () => {
  it("leads with a back link and the kit title, and gives its facts in sentence case", async () => {
    seeded();
    const { status, body } = await visit();
    expect(status).toBe(200);
    const page = main(body);
    expect(page.querySelector("[data-back-link]")?.getAttribute("href")).toBe("/dashboard/cohort");
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    expect(page.querySelector("h1")?.textContent).toBe("Cohort 08");
    expect(page.querySelector("[data-page-header]")?.textContent).toContain("Full-stack foundations");
    const terms = [...page.querySelectorAll("[data-description-list] dt")].map((term) => term.textContent);
    expect(terms).toEqual(["Status", "Starts", "Ends", "Applied"]);
    expect(page.querySelector("[data-description-list] [data-status]")?.textContent).toBe("In review");
    expect(page.textContent).not.toMatch(/Start Date|End Date|Application Details/);
    expect(page.innerHTML).not.toMatch(/text-white|text-red-|bg-green-|form-control|text-primary\b/);
  });

  it("calls an accepted application Accepted, as everywhere else, and shows its answers read-only", async () => {
    seeded("APPROVED");
    const page = main((await visit()).body);
    expect(page.querySelector("[data-description-list] [data-status='APPROVED']")?.textContent).toBe("Accepted");
    expect(page.textContent).not.toContain("Approved");
    expect(page.querySelector("form")).toBeNull();
    const summary = page.querySelector("[data-application-answers-summary]")!;
    expect(summary.textContent).toContain("An SMS reminder for chama contributions.");
    expect(summary.querySelector("a[target='_blank']")?.getAttribute("href")).toBe("https://www.codecademy.com/learn/learn-html");
  });

  it("asks a pending application's questions as the kit's fields, with Save as the one peach action", async () => {
    seeded();
    const page = main((await visit()).body);
    const form = page.querySelector("form[data-application-answers-form]")!;
    expect(form.getAttribute("method")).toBe("POST");
    expect(form.querySelector("input[name='answer.name']")?.getAttribute("value")).toBe("Njeri Wambui");
    expect(form.querySelector("[data-field='answer.htmlCssDone'] input[value='yes']")?.hasAttribute("checked")).toBe(true);
    expect(form.querySelector("textarea[name='answer.project']")?.textContent).toBe("An SMS reminder for chama contributions.");
    expect(primaries(page)).toEqual(["Save answers"]);
  });

  it("keeps a rejected save, names each problem in a danger notice that takes focus, and answers 400", async () => {
    seeded();
    const { status, body } = await visit({ form: { "answer.name": "Njeri W.", "answer.project": "A matatu fare tracker." } });
    expect(status).toBe(400);
    expect(body).toMatch(/<title>Error: /);
    const page = main(body);
    const notice = page.querySelector("#answers-error-summary")!;
    expect(notice.getAttribute("data-notice")).toBe("danger");
    expect(notice.hasAttribute("autofocus")).toBe(true);
    expect(notice.querySelector("a")?.getAttribute("href")).toBe("#answer.htmlCssDone-yes");
    expect(page.querySelector("textarea[name='answer.project']")?.textContent).toBe("A matatu fare tracker.");
    expect(page.querySelector("script")).toBeNull();
  });

  it("answers a saved form with a 303 to its canonical address", async () => {
    seeded();
    const { status, headers } = await visit({ form: { "answer.name": "Njeri Wambui", "answer.htmlCssDone": "no", "answer.project": "A matatu fare tracker." } });
    expect(status).toBe(303);
    expect(headers.get("location")).toBe(PATH);
    const stored = JSON.parse(String(sqlite.prepare("SELECT application FROM programApplication WHERE id='application'").get()?.application));
    expect(stored.submission.find((answer: { name: string }) => answer.name === "project").value).toBe("A matatu fare tracker.");
  });

  it("says a save once, after its redirect", async () => {
    seeded();
    const flash = encodeURIComponent(JSON.stringify({ tone: "success", title: "Your answers are saved.", path: PATH }));
    const notice = main((await visit({ cookie: `${FLASH_COOKIE}=${flash}` })).body).querySelector("[data-notice='success']");
    expect(notice?.textContent).toContain("Your answers are saved.");
  });

  it("has no legacy parts and no inline script", () => {
    for (const path of ["../../application/[id].astro", "../../../../components/platform/application/ApplicationAnswers.astro"]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source).not.toMatch(/common\/(Badge|Card|Button)|form-control|is:inline|legacyClass|legacyTitle/);
    }
  });
});
