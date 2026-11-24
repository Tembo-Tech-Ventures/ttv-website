import { readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { Window } from "happy-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRaw } from "@/lib/attention/test-support";
import { nairobiMoment } from "@/lib/meetings/session-times";

/*
 * Scheduling cohort sessions (in-app calls P8) through the real middleware and pages, without
 * JavaScript: plain form posts, as a browser without script sends them. SQLite with every migration;
 * authentication is mocked. Cohort 07 (#cohort-07) has Faith as its TA and Wanjiku as a member;
 * Kevin is in Cohort 08, David is a mentor in no cohort, Amina an admin.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const PAGES = {
  sessions: () => import("@/pages/dashboard/sessions/index.astro"),
  schedule: () => import("../schedule.astro"),
  date: () => import("../upcoming/[id].astro"),
};
const calendar = await import("../upcoming/[id]/calendar.ics");

const ORIGIN = "https://ttv.invalid";
const PEOPLE = { faith: "synthetic-faith", wanjiku: "synthetic-wanjiku", kevin: "synthetic-kevin", david: "synthetic-david", amina: "synthetic-amina" };
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

let sqlite: DatabaseSync;
function seeded({ meetings = "ALL" }: { meetings?: "ALL" | "OFF" } = {}) {
  const created = createSqliteD1();
  sqlite = created.database;
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
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
    INSERT INTO channel_conduct(userId,version,acknowledgedAt) VALUES ('${PEOPLE.faith}',1,0),('${PEOPLE.amina}',1,0);
    UPDATE feature_flag SET audience='ALL';
    UPDATE feature_flag SET audience='${meetings}' WHERE key='meetings';`);
  Object.assign(mocks.env, { DB: withRaw(sqlite, created.db), DEPLOYMENT_ENVIRONMENT: "production" });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

type PageName = keyof typeof PAGES;
/** One request through the middleware and the page: a GET, or a same-origin form POST. */
/** Work the pages leave for after the response (the note's checks), run before the database closes. */
const deferred: Promise<unknown>[] = [];
afterEach(async () => { await Promise.allSettled(deferred.splice(0)); });

/** `origin`: the post's Origin header, ours unless a test sends another or none (`null`). */
async function visit(
  page: PageName | "calendar", path: string, userId: string, form?: Record<string, string | string[]>, params: Record<string, string> = {},
  { origin = ORIGIN }: { origin?: string | null } = {},
) {
  const url = new URL(path, ORIGIN);
  const user = { id: userId, name: "Synthetic", email: `${userId}@example.test`, image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${userId}-session`, userId, userAgent: "Mozilla/5.0" } });
  const request = () => {
    if (!form) return new Request(url);
    const body = new URLSearchParams();
    for (const [name, value] of Object.entries(form)) for (const one of [value].flat()) body.append(name, one);
    const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
    if (origin) headers.set("Origin", origin);
    return new Request(url, { method: "POST", body, headers });
  };
  const locals = { cfContext: { waitUntil: (task: Promise<unknown>) => deferred.push(task) } } as unknown as App.Locals;
  const context = {
    url, request: request(), locals, params,
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () => {
    if (page === "calendar") return calendar.GET({ params, locals, url, request: request() } as never);
    const { default: Page } = await PAGES[page]();
    return container.renderToResponse(Page, { request: request(), locals, params });
  }) as Response;
  return { status: response.status, body: await response.text(), headers: response.headers };
}

function main(html: string) {
  const { document } = new Window();
  document.body.innerHTML = html;
  return document.body.querySelector("#spaces-main") ?? document.body;
}

const meetings = () => sqlite.prepare("SELECT id, title, scheduledStartAt, bookedMinutes, state, seriesId FROM meeting ORDER BY scheduledStartAt").all() as
  { id: string; title: string; scheduledStartAt: number; bookedMinutes: number; state: string; seriesId: string | null }[];
const notes = () => sqlite.prepare("SELECT body FROM channel_message ORDER BY createdAt, seq").all() as { body: string }[];

// Six Thursdays from the next one after today, so the dates are always still to come.
const firstThursday = (() => {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + ((4 - day.getUTCDay() + 7) % 7 || 7) + 7);
  return day.toISOString().slice(0, 10);
})();
const SERIES = { cohort: "cohort-a", title: "Testing payment callbacks", date: firstThursday, time: "18:00", length: "45", repeat: "weekly", weeks: "6" };
const SCHEDULE = "/dashboard/cohort/sessions/schedule";

/** The token the form carries: drawn by the page on GET, kept through its previews. */
const tokenOf = (page: ReturnType<typeof main>) => page.querySelector("input[name=token]")?.getAttribute("value") ?? "";

async function scheduleSix(skip = 3) {
  const token = tokenOf(main((await visit("schedule", SCHEDULE, PEOPLE.faith)).body));
  const preview = main((await visit("schedule", SCHEDULE, PEOPLE.faith, { ...SERIES, token, intent: "schedule" })).body);
  expect(tokenOf(preview)).toBe(token);
  const boxes = [...preview.querySelectorAll("input[name=dates]")];
  const previewKey = preview.querySelector("input[name=previewKey]")?.getAttribute("value") ?? "";
  const ticked = boxes.filter((_, index) => index !== skip).map((box) => box.getAttribute("value") as string);
  const final = { ...SERIES, token, intent: "schedule", previewKey, dates: ticked };
  return { boxes, final, result: await visit("schedule", SCHEDULE, PEOPLE.faith, final) };
}

describe("scheduling a cohort session without JavaScript", () => {
  it("lets a TA schedule six Thursdays and skip one: a preview of every date, then five sessions and one note", async () => {
    seeded();
    const form = main((await visit("schedule", `${SCHEDULE}?cohort=cohort-a`, PEOPLE.faith)).body);
    expect(form.querySelector("h1")?.textContent).toBe("Schedule a session");
    expect(form.querySelector("form[method=post]")).not.toBeNull();
    // The form says a session is always recorded and offers no recording choice, and who can join.
    expect(form.textContent).toContain("Cohort sessions are always recorded");
    expect(form.querySelector("input[name*=record]")).toBeNull();
    expect(form.textContent).toContain("Up to 15 people, with one place kept for a host");

    const { boxes, result } = await scheduleSix();
    expect(boxes.map((box) => box.hasAttribute("checked"))).toEqual(Array(6).fill(true));
    expect(result.status).toBe(303);
    expect(result.headers.get("location")).toBe("/dashboard/cohort/sessions");
    const rows = meetings();
    expect(rows).toHaveLength(5);
    expect(new Date(rows[0].scheduledStartAt).toISOString()).toBe(`${firstThursday}T15:00:00.000Z`);
    expect(new Set(rows.map(({ seriesId }) => seriesId)).size).toBe(1);
    expect(notes()).toHaveLength(1);
    expect(notes()[0].body).toMatch(/^Scheduled 5 sessions: “Testing payment callbacks”, Thursdays at 18:00 EAT/);
  });

  it("schedules a form sent twice once: the same five dates and one note", async () => {
    seeded();
    const { final } = await scheduleSix();
    const again = await visit("schedule", SCHEDULE, PEOPLE.faith, final);
    expect(again.status).toBe(303);
    expect(meetings()).toHaveLength(5);
    expect(notes()).toHaveLength(1);
  });

  it("shows a form sent again with changes as already sent, and a form with no token again, scheduling nothing", async () => {
    seeded();
    const { final } = await scheduleSix();
    const changed = await visit("schedule", SCHEDULE, PEOPLE.faith, { ...final, title: "Renamed", repeat: "once" });
    expect(changed.status).toBe(409);
    expect(main(changed.body).textContent).toContain("This form was already sent. Open Schedule a session again.");
    const tokenless = await visit("schedule", SCHEDULE, PEOPLE.faith, { ...SERIES, repeat: "once", token: "", intent: "schedule" });
    expect(tokenless.status).toBe(400);
    const page = main(tokenless.body);
    expect(page.textContent).toContain("This form had expired, so nothing was scheduled.");
    expect(tokenOf(page)).toMatch(/^[a-z0-9]{20,32}$/);
    expect(meetings()).toHaveLength(5);
    expect(notes()).toHaveLength(1);
  });

  it("shows one date on Preview dates and schedules nothing until Schedule", async () => {
    seeded();
    const once = { ...SERIES, repeat: "once" };
    const preview = await visit("schedule", SCHEDULE, PEOPLE.faith, { ...once, intent: "preview" });
    expect(preview.status).toBe(200);
    expect(main(preview.body).textContent).toContain("Nothing is scheduled until you press Schedule.");
    expect(meetings()).toEqual([]);
    expect(notes()).toEqual([]);
    const token = tokenOf(main(preview.body));
    expect((await visit("schedule", SCHEDULE, PEOPLE.faith, { ...once, token, intent: "schedule" })).status).toBe(303);
    expect(meetings()).toHaveLength(1);
  });

  it("puts a title with line breaks on one line, in the session and its note", async () => {
    seeded();
    const token = tokenOf(main((await visit("schedule", SCHEDULE, PEOPLE.faith)).body));
    await visit("schedule", SCHEDULE, PEOPLE.faith, { ...SERIES, repeat: "once", title: "Ledgers\r\nand reconciliation", token, intent: "schedule" });
    expect(meetings()[0].title).toBe("Ledgers and reconciliation");
    expect(notes()[0].body).not.toMatch(/[\r\n]/);
  });

  it("refuses a post from another site, or with no Origin, with the same 404", async () => {
    seeded();
    await scheduleSix();
    const target = meetings()[0];
    const path = `/dashboard/cohort/sessions/upcoming/${target.id}`;
    const change = { title: "Moved", date: firstThursday, time: "17:00", length: "60" };
    for (const origin of ["https://evil.example", null]) {
      expect((await visit("schedule", SCHEDULE, PEOPLE.faith, { ...SERIES, repeat: "once", token: "abcdefghijklmnopqrstuvwx", intent: "schedule" }, {}, { origin })).status).toBe(404);
      expect((await visit("date", path, PEOPLE.faith, { ...change, intent: "save" }, { id: target.id }, { origin })).status).toBe(404);
      expect((await visit("date", path, PEOPLE.faith, { intent: "cancel" }, { id: target.id }, { origin })).status).toBe(404);
    }
    expect(meetings()).toHaveLength(5);
    expect(meetings().every(({ state, title }) => state === "SCHEDULED" && title === "Testing payment callbacks")).toBe(true);
  });

  it("shows the errors on the form, and schedules nothing", async () => {
    seeded();
    const { status, body } = await visit("schedule", SCHEDULE, PEOPLE.faith, { ...SERIES, title: "", length: "120", intent: "schedule" });
    expect(status).toBe(400);
    const page = main(body);
    expect(page.textContent).toContain("Check the form");
    expect(page.textContent).toContain("Choose a length of up to 90 minutes.");
    expect(meetings()).toEqual([]);
  });

  it("is the same 404 for a member, another cohort's member, a mentor outside the cohort and a cross-site post", async () => {
    seeded();
    for (const userId of [PEOPLE.wanjiku, PEOPLE.kevin, PEOPLE.david]) {
      expect((await visit("schedule", SCHEDULE, userId)).status).toBe(404);
      expect((await visit("schedule", SCHEDULE, userId, { ...SERIES, repeat: "once", intent: "schedule" })).status).toBe(404);
    }
    // The TA, for a cohort they don't teach.
    expect((await visit("schedule", `${SCHEDULE}?cohort=cohort-b`, PEOPLE.faith)).status).toBe(404);
    expect((await visit("schedule", SCHEDULE, PEOPLE.faith, { ...SERIES, cohort: "cohort-b", repeat: "once", intent: "schedule" })).status).toBe(404);
    expect(meetings()).toEqual([]);
  });

  it("asks an admin which cohort, from every cohort", async () => {
    seeded();
    const page = main((await visit("schedule", SCHEDULE, PEOPLE.amina)).body);
    const options = [...page.querySelectorAll("select[name=cohort] option")].map((option) => option.textContent);
    expect(options).toEqual(["Choose a cohort", "Cohort 07", "Cohort 08"]);
  });
});

describe("Coming up on Sessions", () => {
  it("gives hosts Schedule, Edit and Cancel, and members Add to calendar only", async () => {
    seeded();
    await scheduleSix();
    const host = main((await visit("sessions", "/dashboard/cohort/sessions", PEOPLE.faith)).body);
    expect(host.querySelector("a[href='/dashboard/cohort/sessions/schedule?cohort=cohort-a']")?.textContent).toBe("Schedule a session");
    const rows = [...host.querySelectorAll("[data-coming-up] [data-data-list-item]")];
    expect(rows).toHaveLength(5);
    expect([...rows[0].querySelectorAll("a")].map((link) => link.textContent?.trim())).toEqual(["Add to calendar", "Edit", "Cancel"]);
    expect(rows[0].textContent).toContain("18:00–18:45 EAT");

    const member = main((await visit("sessions", "/dashboard/cohort/sessions", PEOPLE.wanjiku)).body);
    const memberRows = [...member.querySelectorAll("[data-coming-up] [data-data-list-item]")];
    expect(memberRows).toHaveLength(5);
    expect([...memberRows[0].querySelectorAll("a")].map((link) => link.textContent?.trim())).toEqual(["Add to calendar"]);
    expect(member.textContent).not.toContain("Schedule a session");
    // Another cohort sees none of them.
    expect(main((await visit("sessions", "/dashboard/cohort/sessions", PEOPLE.kevin)).body).querySelector("[data-coming-up]")).toBeNull();
  });

  it("is exactly today's page while `meetings` is off", async () => {
    seeded({ meetings: "OFF" });
    sqlite.exec(`INSERT INTO meeting (id, channelId, purpose, title, scheduledStartAt, bookedMinutes, limitMinutes, recordingPolicy, state, createdAt, updatedAt)
      SELECT 'dark', id, 'SESSION', 'Dark session', 4102000000000, 60, 90, 'ALWAYS', 'SCHEDULED', 0, 0 FROM channel WHERE seedKey = 'cohort:cohort-a:main'`);
    for (const userId of [PEOPLE.faith, PEOPLE.wanjiku]) {
      const page = main((await visit("sessions", "/dashboard/cohort/sessions", userId)).body);
      expect(page.querySelector("[data-coming-up]")).toBeNull();
      expect(page.textContent).not.toContain("Schedule a session");
      expect(page.textContent).toContain("Watch recorded sessions and follow along with the transcript.");
      expect(page.querySelector("[data-empty-state] h2")?.textContent).toBe("No recordings yet");
    }
    for (const [page, path, params] of [
      ["schedule", SCHEDULE, {}], ["date", "/dashboard/cohort/sessions/upcoming/dark", { id: "dark" }],
      ["calendar", "/dashboard/cohort/sessions/upcoming/dark/calendar.ics", { id: "dark" }],
    ] as const) {
      expect((await visit(page, path, PEOPLE.faith, undefined, params)).status).toBe(404);
      expect((await visit(page, path, PEOPLE.amina, undefined, params)).status).toBe(404);
    }
    expect((await visit("schedule", SCHEDULE, PEOPLE.faith, { ...SERIES, repeat: "once", intent: "schedule" })).status).toBe(404);
  });
});

describe("one date: edit, cancel and the calendar file", () => {
  it("moves one date after a confirm step, and leaves the others as they were", async () => {
    seeded();
    await scheduleSix();
    const before = meetings();
    const target = before[1];
    const path = `/dashboard/cohort/sessions/upcoming/${target.id}`;
    const params = { id: target.id };
    const form = main((await visit("date", path, PEOPLE.faith, undefined, params)).body);
    expect(form.querySelector("input[name=title]")?.getAttribute("value")).toBe("Testing payment callbacks");
    const nextDay = new Date(target.scheduledStartAt + 86_400_000).toISOString().slice(0, 10);
    const change = { title: "Testing payment callbacks", date: nextDay, time: "17:00", length: "60" };

    const review = main((await visit("date", path, PEOPLE.faith, { ...change, intent: "review" }, params)).body);
    expect(review.querySelector("[data-confirm-change]")?.textContent).toContain("Move “Testing payment callbacks” to");
    expect(meetings()).toEqual(before);

    const saved = await visit("date", path, PEOPLE.faith, { ...change, intent: "save" }, params);
    expect(saved.status).toBe(303);
    const after = meetings();
    expect(after.find(({ id }) => id === target.id)).toMatchObject({ scheduledStartAt: nairobiMoment(nextDay, "17:00"), bookedMinutes: 60 });
    expect(after.filter(({ id }) => id !== target.id)).toEqual(before.filter(({ id }) => id !== target.id));
    expect(notes().at(-1)?.body).toMatch(/^Moved “Testing payment callbacks” from/);
  });

  it("cancels one date after a ConfirmStep, and leaves the others as they were", async () => {
    seeded();
    await scheduleSix();
    const before = meetings();
    const target = before[0];
    const path = `/dashboard/cohort/sessions/upcoming/${target.id}`;
    const step = main((await visit("date", `${path}?confirm=cancel`, PEOPLE.faith, undefined, { id: target.id })).body);
    expect(step.querySelector("[data-confirm-step]")?.textContent).toContain("Cancel “Testing payment callbacks” on");
    expect(step.querySelector("[data-confirm-step] button")?.textContent).toBe("Cancel session");
    expect((await visit("date", path, PEOPLE.faith, { intent: "cancel" }, { id: target.id })).status).toBe(303);
    expect(meetings().find(({ id }) => id === target.id)?.state).toBe("CANCELLED");
    expect(meetings().filter(({ id }) => id !== target.id)).toEqual(before.filter(({ id }) => id !== target.id));
    expect(notes().at(-1)?.body).toMatch(/^Cancelled “Testing payment callbacks” on/);
  });

  it("is the same 404 for anyone but its hosts", async () => {
    seeded();
    await scheduleSix();
    const target = meetings()[0];
    const path = `/dashboard/cohort/sessions/upcoming/${target.id}`;
    for (const userId of [PEOPLE.wanjiku, PEOPLE.kevin, PEOPLE.david]) {
      expect((await visit("date", path, userId, undefined, { id: target.id })).status).toBe(404);
      expect((await visit("date", path, userId, { intent: "cancel" }, { id: target.id })).status).toBe(404);
    }
    expect((await visit("date", "/dashboard/cohort/sessions/upcoming/nope", PEOPLE.faith, undefined, { id: "nope" })).status).toBe(404);
    expect(meetings().every(({ state }) => state === "SCHEDULED")).toBe(true);
  });

  it("gives a member the session's calendar file, at the right moment, and nobody outside the cohort", async () => {
    seeded();
    await scheduleSix();
    const target = meetings()[0];
    const path = `/dashboard/cohort/sessions/upcoming/${target.id}/calendar.ics`;
    const file = await visit("calendar", path, PEOPLE.wanjiku, undefined, { id: target.id });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(file.headers.get("content-disposition")).toBe(`attachment; filename="ttv-session-${firstThursday}.ics"`);
    expect(file.headers.get("cache-control")).toBe("no-store");
    expect(file.body).toContain(`DTSTART:${firstThursday.replaceAll("-", "")}T150000Z\r\n`);
    expect(file.body).toContain(`UID:${target.id}@tembotechventures.com\r\n`);
    for (const userId of [PEOPLE.kevin, PEOPLE.david]) {
      expect((await visit("calendar", path, userId, undefined, { id: target.id })).status).toBe(404);
    }
  });
});
