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
 * /dashboard/feedback on the style guide (S12): "Send feedback" is the page's one peach action, each
 * note is a kit card whose state is a status chip in the kit's words, the team's reply has no eyebrow,
 * its links are prose links, and an empty history is the kit's empty state. Through the real
 * middleware and page on SQLite with every migration; authentication is mocked. The browser journey
 * is e2e/feedback-widget.spec.ts.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../feedback.astro");

const STUDENT = "synthetic-wanjiku";
const ORIGIN = "https://ttv.invalid";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

/** Two notes: one on a planned theme another student shares, one the team resolved with a reply. */
const NOTES = `INSERT INTO user(id,name,email) VALUES ('synthetic-otieno','Otieno Ouma','otieno@example.test');
  INSERT INTO feedback_theme(id,title,kind,status,issueUrl) VALUES ('theme','Session links are hard to find','CONFUSING','PLANNED','https://github.com/example/issues/1');
  INSERT INTO feedback(id,userId,kind,message,pageUrl,themeId,createdAt,updatedAt) VALUES
    ('planned','${STUDENT}','CONFUSING','Where is the session link?','https://ttv.invalid/dashboard/cohort/sessions','theme',2,2),
    ('other','synthetic-otieno','CONFUSING','Cannot find the link.','https://ttv.invalid/dashboard/cohort/sessions','theme',1,1);
  INSERT INTO feedback(id,userId,kind,message,pageUrl,status,response,resolutionUrl,createdAt,updatedAt) VALUES
    ('resolved','${STUDENT}','BUG','The page went blank.','https://ttv.invalid/dashboard/cohort','RESOLVED','Thanks, fixed.','https://github.com/example/pull/2',1,1);
  INSERT INTO feedback_attachment(id,feedbackId,objectKey,contentType,size,source,position) VALUES
    ('shot','resolved','feedback/resolved/shot.png','image/png',10,'CAPTURE',0);`;

function seeded({ extra = "", spaces = true } = {}) {
  const { database: sqlite, db } = createSqliteD1();
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO user(id,name,email) VALUES ('${STUDENT}','Wanjiku Njeri','wanjiku@example.test');
    UPDATE feature_flag SET audience='${spaces ? "ALL" : "OFF"}';
    ${extra}`);
  Object.assign(mocks.env, { DB: withRaw(sqlite, db), DEPLOYMENT_ENVIRONMENT: "production" });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

async function visit() {
  const url = new URL("/dashboard/feedback", ORIGIN);
  const user = { id: STUDENT, name: "Wanjiku Njeri", email: "wanjiku@example.test", image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${STUDENT}-session`, userId: STUDENT, userAgent: "Mozilla/5.0" } });
  const locals = {} as App.Locals;
  const context = {
    url, request: new Request(url), locals, params: {},
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () =>
    container.renderToResponse(Page, { request: new Request(url), locals })) as Response;
  const { document } = new Window();
  document.body.innerHTML = await response.text();
  return { status: response.status, body: document.body };
}

type Root = Pick<Awaited<ReturnType<typeof visit>>["body"], "querySelectorAll">;
const primaries = (root: Root) => [...root.querySelectorAll("a, button")].filter((control) =>
  control.getAttribute("data-variant") === "primary" || control.classList.contains("bg-primary"));

describe("Your feedback", () => {
  it("has Send feedback as its one peach action, a kit button that opens the widget", async () => {
    seeded({ extra: NOTES });
    const { status, body } = await visit();
    expect(status).toBe(200);
    const page = body.querySelector("#spaces-main")!;
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    const [send, ...others] = primaries(page);
    expect(others).toEqual([]);
    expect(send?.tagName).toBe("BUTTON");
    expect(send?.textContent?.trim()).toBe("Send feedback");
    expect(send?.hasAttribute("data-open-feedback")).toBe(true);
  });

  it("shows each note as a kit card with its state in the kit's words, and no eyebrow", async () => {
    seeded({ extra: NOTES });
    const { body } = await visit();
    const notes = [...body.querySelectorAll("[data-testid='feedback-history'] > li")];
    expect(notes.map((note) => note.id)).toEqual(["feedback-planned", "feedback-resolved"]);
    for (const note of notes) expect(note.querySelector("[data-card]")).not.toBeNull();
    expect(notes.map((note) => note.querySelector("[data-status]")?.textContent)).toEqual(["Planned", "Done"]);
    expect(notes[0]?.textContent).toContain("One other student raised this too.");
    const reply = notes[1]?.querySelector("[data-feedback-reply]");
    expect(reply?.textContent).toContain("Thanks, fixed.");
    expect(body.querySelector("#spaces-main .uppercase")).toBeNull();
  });

  it("writes the plan and the change as prose links", async () => {
    seeded({ extra: NOTES });
    const { body } = await visit();
    const links = [...body.querySelectorAll("[data-testid='feedback-history'] a")]
      .filter((link) => ["Follow the plan", "See the change"].includes(link.textContent?.trim() ?? ""));
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["https://github.com/example/issues/1", "https://github.com/example/pull/2"]);
    for (const link of links) expect(link.getAttribute("class")).toBe(linkClass());
  });

  it("says what belongs here with the kit's empty state when nothing has been sent", async () => {
    seeded();
    const { body } = await visit();
    const empty = body.querySelector("[data-empty-state]");
    expect(empty?.querySelector("h2")?.textContent).toBe("Nothing sent yet");
    expect(empty?.textContent).toContain("Feedback in your account menu");
  });

  it("renders the same kit content in the existing dashboard while spaces is off", async () => {
    seeded({ extra: NOTES, spaces: false });
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(body.querySelector("#spaces-main")).toBeNull();
    expect(body.querySelectorAll("[data-testid='feedback-history'] [data-status]")).toHaveLength(2);
    expect(body.querySelector("[data-open-feedback][data-variant='primary']")).not.toBeNull();
  });
});
