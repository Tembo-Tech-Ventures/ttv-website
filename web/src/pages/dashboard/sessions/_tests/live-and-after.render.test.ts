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
 * Cohort sessions after the call (in-app calls P9), through the real middleware and pages without
 * JavaScript: hiding a recording from the cohort and showing it again (the session viewer), the
 * Sessions list's rows for sessions that ended without a recording, and the Overview's next session.
 * SQLite with every migration; authentication is mocked. Cohort 07 (#cohort-07) has Faith as its TA
 * and Wanjiku as a member; Kevin is in Cohort 08, David a mentor in no cohort, Amina an admin.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const PAGES = {
  viewer: () => import("../[id].astro"),
  sessions: () => import("../index.astro"),
  overview: () => import("@/pages/dashboard/index.astro"),
};

const ORIGIN = "https://ttv.invalid";
const PEOPLE = { faith: "synthetic-faith", wanjiku: "synthetic-wanjiku", kevin: "synthetic-kevin", david: "synthetic-david", amina: "synthetic-amina" };
const VIEWER_PATH = "/dashboard/cohort/sessions/week-3";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

let sqlite: DatabaseSync;
function seeded({ meetings = "ALL" }: { meetings?: "ALL" | "OFF" } = {}) {
  const created = createSqliteD1();
  sqlite = created.database;
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES
      ('cohort-a','Cohort 07','Test','curriculum',0,4102444800),('cohort-b','Cohort 08','Test','curriculum',0,4102444800);
    INSERT INTO user(id,name,email) VALUES ('${PEOPLE.faith}','Faith Njeri','faith@example.test'),('${PEOPLE.wanjiku}','Wanjiku Njeri','wanjiku@example.test'),
      ('${PEOPLE.kevin}','Kevin Omondi','kevin@example.test'),('${PEOPLE.david}','David Kamau','david@example.test'),('${PEOPLE.amina}','Amina Hassan','amina@example.test');
    INSERT INTO programRole(id,userId,programId,name) VALUES ('faith-ta','${PEOPLE.faith}','cohort-a','TA');
    INSERT INTO programApplication(id,userId,programId,status,application) VALUES
      ('wanjiku-a','${PEOPLE.wanjiku}','cohort-a','APPROVED','{}'),('kevin-b','${PEOPLE.kevin}','cohort-b','APPROVED','{}');
    INSERT OR IGNORE INTO Roles(id,name) VALUES ('ADMIN','ADMIN'),('MENTOR','MENTOR');
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'admin-role','${PEOPLE.amina}',id FROM Roles WHERE name='ADMIN';
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'mentor-role','${PEOPLE.david}',id FROM Roles WHERE name='MENTOR';
    INSERT INTO recording(id,programId,title,processingStatus,r2VideoKey,accessScope,scopeChosen,recordedAt)
      VALUES ('week-3','cohort-a','Week 3: Testing a service','complete','videos/week-3.mp4','COHORT',1,1000);
    UPDATE feature_flag SET audience='ALL';
    UPDATE feature_flag SET audience='${meetings}' WHERE key='meetings';`);
  Object.assign(mocks.env, { DB: withRaw(sqlite, created.db), DEPLOYMENT_ENVIRONMENT: "production" });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

/** One request through the middleware and the page: a GET, or a form POST from `origin` (ours unless told). */
async function visit(page: keyof typeof PAGES, path: string, userId: string, form?: Record<string, string>, { origin = ORIGIN }: { origin?: string | null } = {}) {
  const url = new URL(path, ORIGIN);
  const user = { id: userId, name: "Synthetic", email: `${userId}@example.test`, image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${userId}-session`, userId, userAgent: "Mozilla/5.0" } });
  const request = () => {
    if (!form) return new Request(url);
    const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
    if (origin) headers.set("Origin", origin);
    return new Request(url, { method: "POST", body: new URLSearchParams(form), headers });
  };
  const deferred: Promise<unknown>[] = [];
  const locals = { cfContext: { waitUntil: (task: Promise<unknown>) => deferred.push(task) } } as unknown as App.Locals;
  const params = { id: url.pathname.split("/").at(-1) ?? "" };
  const context = {
    url, request: request(), locals, params,
    cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () => {
    const { default: Page } = await PAGES[page]();
    return container.renderToResponse(Page, { request: request(), locals, params });
  }) as Response;
  await Promise.allSettled(deferred);
  return { status: response.status, body: await response.text(), headers: response.headers };
}

function main(html: string) {
  const { document } = new Window();
  document.body.innerHTML = html;
  return document.body.querySelector("#spaces-main") ?? document.body;
}
const hiddenAt = () => (sqlite.prepare("SELECT hiddenAt FROM recording WHERE id = 'week-3'").get() as { hiddenAt: number | null }).hiddenAt;
const listed = async (userId: string) => [...main((await visit("sessions", "/dashboard/cohort/sessions", userId)).body)
  .querySelectorAll("[data-session-card]")].map((card) => card.getAttribute("href"));

describe("hiding a recording from the cohort", () => {
  it("lets the cohort's TA hide it behind a confirm step, which takes it from the cohort, and show it again", async () => {
    seeded();
    const before = main((await visit("viewer", VIEWER_PATH, PEOPLE.faith)).body);
    expect(before.querySelector("[data-hide-recording]")?.textContent).toContain("The cohort's instructors and TAs, and admins, can hide a recording");
    const ask = before.querySelector("[data-hide-recording] a")?.getAttribute("href");
    expect(ask).toBe(`${VIEWER_PATH}?confirm=hide`);
    const confirm = main((await visit("viewer", ask!, PEOPLE.faith)).body);
    expect(confirm.textContent).toContain("Hide “Week 3: Testing a service” from Cohort 07?");
    expect(confirm.querySelector("form input[name=intent]")?.getAttribute("value")).toBe("hide");

    const hidden = await visit("viewer", VIEWER_PATH, PEOPLE.faith, { intent: "hide" });
    expect(hidden.status).toBe(303);
    expect(hidden.headers.get("location")).toBe(VIEWER_PATH);
    expect(hiddenAt()).toEqual(expect.any(Number));

    // The member can't open it or see it in Sessions; the TA still can, and is told it is hidden.
    expect((await visit("viewer", VIEWER_PATH, PEOPLE.wanjiku)).status).toBe(404);
    expect(await listed(PEOPLE.wanjiku)).toEqual([]);
    expect(await listed(PEOPLE.faith)).toEqual([VIEWER_PATH]);
    const sessions = main((await visit("sessions", "/dashboard/cohort/sessions", PEOPLE.faith)).body);
    expect(sessions.querySelector("[data-session-card]")?.textContent).toContain("Hidden from the cohort");
    const host = main((await visit("viewer", VIEWER_PATH, PEOPLE.faith)).body);
    expect(host.textContent).toContain("Only the cohort's instructors and TAs, and admins, can watch it or read its transcript.");

    expect((await visit("viewer", VIEWER_PATH, PEOPLE.faith, { intent: "show" })).status).toBe(303);
    expect(hiddenAt()).toBeNull();
    expect((await visit("viewer", VIEWER_PATH, PEOPLE.wanjiku)).status).toBe(200);
  });

  it("lets an admin hide any cohort's recording", async () => {
    seeded();
    expect((await visit("viewer", VIEWER_PATH, PEOPLE.amina, { intent: "hide" })).status).toBe(303);
    expect(hiddenAt()).toEqual(expect.any(Number));
  });

  it("answers everyone else with the same 404 and changes nothing: members, other cohorts, mentors, another site, `meetings` off", async () => {
    seeded();
    for (const userId of [PEOPLE.wanjiku, PEOPLE.kevin]) {
      const response = await visit("viewer", VIEWER_PATH, userId, { intent: "hide" });
      expect({ userId, status: response.status }).toEqual({ userId, status: 404 });
    }
    // A mentor in no cohort has no Cohort space: the router answers a post as it answers their GET.
    const david = await Promise.all([visit("viewer", VIEWER_PATH, PEOPLE.david), visit("viewer", VIEWER_PATH, PEOPLE.david, { intent: "hide" })]);
    expect(david.map(({ status }) => status)).toEqual([403, 403]);
    expect(main((await visit("viewer", VIEWER_PATH, PEOPLE.wanjiku)).body).querySelector("[data-hide-recording]")).toBeNull();
    expect((await visit("viewer", VIEWER_PATH, PEOPLE.faith, { intent: "hide" }, { origin: "https://elsewhere.example" })).status).toBe(404);
    expect((await visit("viewer", VIEWER_PATH, PEOPLE.faith, { intent: "delete" })).status).toBe(404);
    expect(hiddenAt()).toBeNull();

    seeded({ meetings: "OFF" });
    expect(main((await visit("viewer", VIEWER_PATH, PEOPLE.faith)).body).querySelector("[data-hide-recording]")).toBeNull();
    expect((await visit("viewer", VIEWER_PATH, PEOPLE.faith, { intent: "hide" })).status).toBe(404);
    expect(hiddenAt()).toBeNull();
  });
});

/** A session in cohort A's main channel that opened at `openedAt` (ms) and ended. */
function endedSession(id: string, title: string, openedAt: number) {
  sqlite.prepare(`INSERT INTO meeting (id, channelId, purpose, title, scheduledStartAt, bookedMinutes, limitMinutes, recordingPolicy, state,
      openedAt, hardEndAt, endedAt, endReason, createdAt, updatedAt)
    SELECT ?1, id, 'SESSION', ?2, ?3, 60, 90, 'ALWAYS', 'ENDED', ?3, ?3 + 5400000, ?3 + 3600000, 'HOST_ENDED', ?3, ?3
    FROM channel WHERE kind = 'COHORT' AND programId = 'cohort-a' ORDER BY position LIMIT 1`).run(id, title, openedAt);
}

describe("Sessions after a session ends", () => {
  it("shows a row for each that ended without a recording, saying why, and a recording that came from one as usual", async () => {
    seeded();
    endedSession("week-4", "Week 4: Deploying", Date.parse("2026-11-12T15:00:00Z"));
    endedSession("week-5", "Week 5: Queues", Date.parse("2026-11-19T15:00:00Z"));
    endedSession("week-6", "Week 6: Caching", Date.parse("2026-11-26T15:00:00Z"));
    endedSession("week-7", "Week 7: Hidden", Date.parse("2026-12-03T15:00:00Z"));
    sqlite.exec(`INSERT INTO meeting_recording(id, meetingId, state, createdAt, updatedAt) VALUES ('capture-5', 'week-5', 'FAILED', 0, 0);
      INSERT INTO recording(id,programId,title,processingStatus,r2VideoKey,accessScope,scopeChosen,meetingId,recordedAt)
        VALUES ('week-6-video','cohort-a','Week 6: Caching','complete','videos/week-6.mp4','COHORT',1,'week-6',1795705200);
      INSERT INTO recording(id,programId,title,processingStatus,r2VideoKey,accessScope,scopeChosen,meetingId,recordedAt,hiddenAt)
        VALUES ('week-7-video','cohort-a','Week 7: Hidden','complete','videos/week-7.mp4','COHORT',1,'week-7',1796310000,1);`);
    const page = main((await visit("sessions", "/dashboard/cohort/sessions", PEOPLE.wanjiku)).body);
    const rows = [...page.querySelectorAll("[data-session-list] > li")].map((row) => {
      const unrecorded = row.querySelector("[data-session-unrecorded]");
      return unrecorded ? `${unrecorded.getAttribute("data-session-unrecorded")}: ${unrecorded.querySelector("h3")?.textContent}`
        : `recording: ${row.querySelector("h3")?.textContent}`;
    });
    // Newest first; the hidden recording's session is neither listed nor called "not recorded".
    expect(rows).toEqual([
      "recording: Week 6: Caching", "failed: Week 5: Queues", "notRecorded: Week 4: Deploying", "recording: Week 3: Testing a service",
    ]);
    expect(page.querySelector("[data-session-unrecorded=failed]")?.textContent).toContain("The recording failed, so there's nothing to watch.");
    expect(page.querySelector("[data-session-unrecorded=notRecorded]")?.textContent).toContain("This session wasn't recorded.");

    // Another cohort sees none of them, and with `meetings` off the list is as it was.
    expect(main((await visit("sessions", "/dashboard/cohort/sessions", PEOPLE.kevin)).body).querySelector("[data-session-unrecorded]")).toBeNull();
  });
});

describe("the cohort Overview's next session", () => {
  function upcoming(state: "SCHEDULED" | "LIVE") {
    const start = Date.now() + (state === "LIVE" ? -5 : 60 * 24) * 60_000;
    sqlite.prepare(`INSERT INTO meeting (id, channelId, purpose, title, scheduledStartAt, bookedMinutes, limitMinutes, recordingPolicy, state,
        openedAt, hardEndAt, providerMeetingId, createdAt, updatedAt)
      SELECT 'next', id, 'SESSION', 'Week 8: Payments', ?1, 60, 90, 'ALWAYS', ?2, ?3, ?4, ?5, ?6, ?6
      FROM channel WHERE kind = 'COHORT' AND programId = 'cohort-a' ORDER BY position LIMIT 1`)
      .run(start, state, state === "LIVE" ? start : null, state === "LIVE" ? start + 5_400_000 : null, state === "LIVE" ? "fake-next" : null, start - 60_000);
  }
  const peach = (page: ReturnType<typeof main>) => [...page.querySelectorAll("a, button")]
    .filter((element) => element.className.includes("bg-primary")).map((element) => element.textContent?.trim());

  it("offers the next session to add to a calendar, and the next step stays the page's peach action", async () => {
    seeded();
    upcoming("SCHEDULED");
    const page = main((await visit("overview", "/dashboard/cohort", PEOPLE.wanjiku)).body);
    const card = page.querySelector("[data-next-session]");
    expect(card?.getAttribute("data-next-session")).toBe("scheduled");
    expect(card?.textContent).toContain("Week 8: Payments");
    expect(card?.querySelector("[data-add-to-calendar]")?.getAttribute("href")).toBe("/dashboard/cohort/sessions/upcoming/next/calendar.ics");
    expect(peach(page)).toHaveLength(1);
    expect(card?.querySelector(".bg-primary")).toBeNull();
  });

  it("makes Join the one peach action while the session is live", async () => {
    seeded();
    upcoming("LIVE");
    const page = main((await visit("overview", "/dashboard/cohort", PEOPLE.wanjiku)).body);
    const card = page.querySelector("[data-next-session]");
    expect(card?.getAttribute("data-next-session")).toBe("live");
    expect(card?.querySelector("[data-call-link]")?.getAttribute("href")).toBe("/dashboard/calls/next");
    expect(peach(page)).toEqual(["Join session: Week 8: Payments (opens in a new tab)"]);
  });

  it("is not there for another cohort, or with `meetings` off", async () => {
    seeded();
    upcoming("LIVE");
    expect(main((await visit("overview", "/dashboard/cohort", PEOPLE.kevin)).body).querySelector("[data-next-session]")).toBeNull();
    seeded({ meetings: "OFF" });
    upcoming("LIVE");
    expect(main((await visit("overview", "/dashboard/cohort", PEOPLE.wanjiku)).body).querySelector("[data-next-session]")).toBeNull();
  });
});
