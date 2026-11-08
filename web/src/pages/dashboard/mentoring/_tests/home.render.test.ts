import { readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { Window } from "happy-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRaw } from "@/lib/attention/test-support";
import MentoringOverview from "@/components/platform/spaces/MentoringOverview.astro";

/*
 * /dashboard/mentoring, the Mentoring space's landing, on the style guide: one peach action at most,
 * and only for something that needs the mentor; the h1 before onboarding's cards; Maven h2s. Through
 * the real middleware and page (mentorship.astro) on SQLite with every migration; authentication is
 * mocked. The browser journeys are e2e/platform-mentor-awaiting.spec.ts and platform-personas.spec.ts.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../../mentorship.astro");

const MENTOR = "synthetic-david";
const MEMBER = "synthetic-wanjiku";
const ORIGIN = "https://ttv.invalid";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seeded(extra = "") {
  const { database: sqlite, db } = createSqliteD1();
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO user(id,name,email) VALUES ('${MENTOR}','David Kamau','david@example.test'),('${MEMBER}','Wanjiku Njeri','wanjiku@example.test');
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'mentor-role','${MENTOR}',id FROM Roles WHERE name='MENTOR';
    INSERT INTO mentor_profile(userId,headline,bio,areas,formats,monthlyCapacity,paused) VALUES
      ('${MENTOR}','Backend engineer','Reviews APIs.','["Code review"]','["WRITTEN_REVIEW"]',3,0);
    UPDATE feature_flag SET audience='ALL';
    ${extra}`);
  Object.assign(mocks.env, { DB: withRaw(sqlite, db), DEPLOYMENT_ENVIRONMENT: "production" });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

/** One signed-in GET of the landing through the middleware and the page. */
async function visit(path = "/dashboard/mentoring") {
  const url = new URL(path, ORIGIN);
  const user = { id: MENTOR, name: "David Kamau", email: "david@example.test", image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${MENTOR}-session`, userId: MENTOR, userAgent: "Mozilla/5.0" } });
  const locals = {} as App.Locals;
  const context = {
    url, request: new Request(url), locals, params: {},
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () =>
    container.renderToResponse(Page, { request: new Request(url), locals })) as Response;
  return { status: response.status, body: await response.text() };
}

/** Parsed with happy-dom: the render config runs in node, where Astro compiles. */
const dom = (html: string) => {
  const { document } = new Window();
  document.body.innerHTML = html;
  return document.body;
};

type Root = Pick<ReturnType<typeof dom>, "querySelectorAll">;
const main = (html: string) => dom(html).querySelector("#spaces-main")!;
const primaries = (root: Root) => [...root.querySelectorAll("a, button")].filter((control) =>
  control.getAttribute("data-variant") === "primary" || control.classList.contains("bg-primary"));
const reviewLink = (root: Root) => [...root.querySelectorAll("a")].find((link) => link.textContent?.trim() === "Review shared work");

describe("the Mentoring landing", () => {
  it("has no peach action while nothing waits: Review shared work is quiet", async () => {
    seeded();
    const { status, body } = await visit();
    expect(status).toBe(200);
    const page = main(body);
    expect(page.querySelector("[data-awaiting-confirmation]")?.getAttribute("data-awaiting-confirmation")).toBe("0");
    expect(reviewLink(page)?.getAttribute("data-variant")).toBe("quiet");
    expect(primaries(page)).toEqual([]);
  });

  it("makes See requests the one primary while a request waits for the mentor", async () => {
    seeded(`INSERT INTO mentor_request(id,requesterId,mentorId,format,note,createdAt,updatedAt)
      VALUES ('request','${MEMBER}','${MENTOR}','WRITTEN_REVIEW','Could you look at my API?',1,1);`);
    const page = main((await visit()).body);
    expect(reviewLink(page)?.getAttribute("data-variant")).toBe("quiet");
    expect(primaries(page).map((control) => control.textContent?.trim())).toEqual(["See requests"]);
  });

  it("puts the h1 before onboarding's status cards", async () => {
    seeded(`INSERT INTO access_request (id, userId, role, note, organisation, scopeAcknowledgedAt, createdAt, updatedAt)
      VALUES ('institution', '${MENTOR}', 'INSTITUTION', 'We hire junior developers.', 'Savanna Labs', 1, 1, 1);`);
    const page = main((await visit()).body);
    const notices = page.querySelector("[data-onboarding-notices]");
    expect(notices).not.toBeNull();
    const h1 = page.querySelector("h1")!;
    expect(h1.textContent).toBe("Mentoring");
    expect(Boolean(h1.compareDocumentPosition(notices!) & 4 /* DOCUMENT_POSITION_FOLLOWING */)).toBe(true);
    // Nothing that reads as a heading comes before the title.
    expect(page.querySelector("h1, h2, h3")).toBe(h1);
  });

  it("sets its h2s in the base style: no weight or face of their own", async () => {
    seeded();
    const headings = [...main((await visit()).body).querySelectorAll("h2")];
    expect(headings.map((h2) => h2.textContent?.trim())).toEqual(["Confirm work", "Channels", "Requests", "Availability"]);
    for (const h2 of headings) expect(h2.className).not.toMatch(/font-(semibold|bold|body|display|heading)/);
  });

  it("still renders the review at /dashboard/mentoring/confirm", async () => {
    seeded();
    const { status, body } = await visit("/dashboard/mentoring/confirm");
    expect(status).toBe(200);
    expect(main(body).querySelector("[data-awaiting-confirmation]")).toBeNull();
    expect(body).not.toContain("Review shared work");
  });
});

describe("MentoringOverview's one primary", () => {
  const render = (props: Record<string, unknown>) => container.renderToString(MentoringOverview, { props });
  const REQUESTS = { waitingMore: false, availability: null, now: 0 };

  it("is Review shared work while shared work waits, even with requests waiting too", async () => {
    const root = dom(await render({ awaiting: 2, requests: { ...REQUESTS, waiting: 3 } }));
    expect(primaries(root).map((control) => control.textContent?.trim())).toEqual(["Review shared work"]);
  });

  it("is nothing when the waiting count is unknown", async () => {
    const root = dom(await render({ awaiting: null, requests: { ...REQUESTS, waiting: null } }));
    expect(primaries(root)).toEqual([]);
    expect(root.querySelector("[data-awaiting-confirmation]")).toBeNull();
  });

  it("keeps Requests and Availability as kit cards with a Not open yet chip while mentor requests are off", async () => {
    const root = dom(await render({ awaiting: 0 }));
    for (const id of ["requests", "availability"]) {
      const card = root.querySelector(`#${id} [data-card]`);
      expect(card?.getAttribute("aria-labelledby")).toBe(`${id}-title`);
      expect(card?.querySelector("[data-chip]")?.textContent).toBe("Not open yet");
    }
    expect(primaries(root)).toEqual([]);
  });
});
