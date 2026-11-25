import { readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { Window } from "happy-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRaw } from "@/lib/attention/test-support";
import { zonedFields } from "@/lib/meetings/session-times";

/*
 * Calls between two people (in-app calls P10) through the real middleware and pages, without
 * JavaScript: plain form posts, as a browser without script sends them. SQLite with every migration;
 * authentication is mocked. Wanjiku (a member) and David (a mentor) share a conversation; Otieno is a
 * third person, Amina an admin outside it.
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const PAGES = {
  calls: () => import("../index.astro"),
  mentoring: () => import("@/pages/dashboard/mentoring/calls.astro"),
  suggest: () => import("../suggest.astro"),
  proposal: () => import("../suggested/[id].astro"),
  call: () => import("../[id].astro"),
  conversation: () => import("@/pages/dashboard/community/dm/[id].astro"),
};
const calendar = await import("../[id]/calendar.ics");

const ORIGIN = "https://ttv.invalid";
const PEOPLE = { wanjiku: "synthetic-wanjiku", david: "synthetic-david", otieno: "synthetic-otieno", amina: "synthetic-amina" };
const CONVERSATION = "direct-wanjiku-david";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

let sqlite: DatabaseSync;
function seeded({ checkins = "ALL" }: { checkins?: "ALL" | "OFF" } = {}) {
  const created = createSqliteD1();
  sqlite = created.database;
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO user(id,name,email) VALUES ('${PEOPLE.wanjiku}','Wanjiku Njeri','wanjiku@example.test'),
      ('${PEOPLE.david}','David Kamau','david@example.test'),('${PEOPLE.otieno}','Otieno Ouma','otieno@example.test'),
      ('${PEOPLE.amina}','Amina Hassan','amina@example.test');
    INSERT OR IGNORE INTO Roles(id,name) VALUES ('ADMIN','ADMIN'),('MENTOR','MENTOR');
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'admin-role','${PEOPLE.amina}',id FROM Roles WHERE name='ADMIN';
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'mentor-role','${PEOPLE.david}',id FROM Roles WHERE name='MENTOR';
    INSERT INTO channel_conduct(userId,version,acknowledgedAt) VALUES ('${PEOPLE.wanjiku}',1,0),('${PEOPLE.david}',1,0),('${PEOPLE.otieno}',1,0),('${PEOPLE.amina}',1,0);
    INSERT INTO channel(id, kind, slug, name) VALUES ('${CONVERSATION}', 'DIRECT', 'conversation', 'Conversation'),
      ('direct-wanjiku-otieno', 'DIRECT', 'conversation', 'Conversation');
    INSERT INTO channel_member(channelId, userId) VALUES ('${CONVERSATION}', '${PEOPLE.wanjiku}'), ('${CONVERSATION}', '${PEOPLE.david}'),
      ('direct-wanjiku-otieno', '${PEOPLE.wanjiku}'), ('direct-wanjiku-otieno', '${PEOPLE.otieno}');
    UPDATE feature_flag SET audience='ALL';
    UPDATE feature_flag SET audience='${checkins}' WHERE key='meeting_checkins';`);
  Object.assign(mocks.env, { DB: withRaw(sqlite, created.db), DEPLOYMENT_ENVIRONMENT: "production" });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

/** Work the pages leave for after the response (the card's checks, Attention), run before the database closes. */
const deferred: Promise<unknown>[] = [];
afterEach(async () => { await Promise.allSettled(deferred.splice(0)); });

type PageName = keyof typeof PAGES;
/** One request through the middleware and the page: a GET, or a form POST from our origin unless `origin` says otherwise. */
async function visit(
  page: PageName | "calendar", path: string, userId: string, form?: Record<string, string>, params: Record<string, string> = {},
  { origin = ORIGIN }: { origin?: string | null } = {},
) {
  const url = new URL(path, ORIGIN);
  const user = { id: userId, name: "Synthetic", email: `${userId}@example.test`, image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${userId}-session`, userId, userAgent: "Mozilla/5.0" } });
  const request = () => {
    if (!form) return new Request(url);
    const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
    if (origin) headers.set("Origin", origin);
    return new Request(url, { method: "POST", body: new URLSearchParams(form), headers });
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

const proposals = () => sqlite.prepare("SELECT id, proposedBy, state, meetingId, messageId FROM call_proposal ORDER BY createdAt, id").all() as
  { id: string; proposedBy: string; state: string; meetingId: string | null; messageId: string | null }[];
const meetings = () => sqlite.prepare("SELECT id, purpose, state, scheduledStartAt, bookedMinutes FROM meeting ORDER BY scheduledStartAt").all() as
  { id: string; purpose: string; state: string; scheduledStartAt: number; bookedMinutes: number }[];

// Two days ahead at 17:00 in Nairobi, so the times are always still to come.
const day = (offset: number) => zonedFields(Date.now() + offset * 24 * 60 * 60_000, "Africa/Nairobi").date;
const TOKEN = "lrhduq45z18mjgcl7mfuq8bx";
const SUGGESTION = { token: TOKEN, conversation: CONVERSATION, instead: "", change: "", purpose: "CALL", work: "", length: "30", zone: "Africa/Nairobi",
  date1: day(2), time1: "17:00", date2: day(3), time2: "10:00", date3: "", time3: "", intent: "send" };

async function suggested(userId = PEOPLE.wanjiku, form: Record<string, string> = SUGGESTION) {
  const response = await visit("suggest", `/dashboard/me/calls/suggest?conversation=${CONVERSATION}`, userId, form);
  expect(response.status).toBe(303);
  return proposals().at(-1)!.id;
}

describe("suggesting a call without JavaScript", () => {
  it("shows the form to either member and suggests once for a form sent twice", async () => {
    seeded();
    const form = main((await visit("suggest", `/dashboard/me/calls/suggest?conversation=${CONVERSATION}`, PEOPLE.david)).body);
    expect(form.querySelector("h1")?.textContent).toBe("Suggest a call");
    expect(form.querySelectorAll("[data-time-slot]")).toHaveLength(3);
    expect(form.textContent).toContain("You and Wanjiku Njeri. Nobody else, staff included.");

    const first = await visit("suggest", `/dashboard/me/calls/suggest?conversation=${CONVERSATION}`, PEOPLE.wanjiku, SUGGESTION);
    expect([first.status, first.headers.get("location")]).toEqual([303, `/dashboard/community/dm/${CONVERSATION}#channel-messages`]);
    const again = await visit("suggest", `/dashboard/me/calls/suggest?conversation=${CONVERSATION}`, PEOPLE.wanjiku, SUGGESTION);
    expect(again.status).toBe(303);
    expect(proposals()).toEqual([expect.objectContaining({ id: TOKEN, proposedBy: PEOPLE.wanjiku, state: "OPEN" })]);
    expect(proposals()[0]?.messageId).not.toBeNull();
  });

  it("says what to change next to each field, and writes nothing", async () => {
    seeded();
    const response = await visit("suggest", `/dashboard/me/calls/suggest?conversation=${CONVERSATION}`, PEOPLE.wanjiku, { ...SUGGESTION, date1: day(-1), date2: "" });
    expect(response.status).toBe(400);
    const page = main(response.body);
    expect(page.textContent).toContain("Choose a time that hasn't passed yet.");
    expect(page.textContent).toContain("Choose a date for this time.");
    expect(proposals()).toEqual([]);
  });

  it("checks new times for a booked call before sending them, and keeps the booked time until one is picked", async () => {
    seeded();
    const proposalId = await suggested();
    const picked = (sqlite.prepare("SELECT times FROM call_proposal WHERE id = ?").get(proposalId) as { times: string }).times;
    const at = (JSON.parse(picked) as number[])[0]!;
    await visit("proposal", `/dashboard/me/calls/suggested/${proposalId}`, PEOPLE.david, { answer: "pick", at: String(at), from: "proposal" }, { id: proposalId });
    expect(meetings()).toEqual([expect.objectContaining({ id: proposalId, state: "SCHEDULED", scheduledStartAt: at })]);

    const path = `/dashboard/me/calls/suggest?conversation=${CONVERSATION}&change=${proposalId}`;
    const change = { ...SUGGESTION, token: "m0vetokenm0vetokenm0vetk", change: proposalId, date1: day(5), date2: "", time2: "" };
    const review = await visit("suggest", path, PEOPLE.wanjiku, { ...change, intent: "review" });
    expect(review.status).toBe(200);
    expect(main(review.body).querySelector("[data-review-change]")?.textContent).toContain("David is asked to pick one.");
    expect(proposals()).toHaveLength(1);
    expect((await visit("suggest", path, PEOPLE.wanjiku, change)).status).toBe(303);
    expect(proposals().at(-1)).toMatchObject({ meetingId: proposalId, state: "OPEN" });
    expect(meetings()[0]?.scheduledStartAt).toBe(at);
  });
});

describe("answering from the card", () => {
  it("books the call when the other person picks a time, and goes back to the conversation", async () => {
    seeded();
    const proposalId = await suggested();
    const at = (JSON.parse((sqlite.prepare("SELECT times FROM call_proposal WHERE id = ?").get(proposalId) as { times: string }).times) as number[])[1]!;
    const response = await visit("proposal", `/dashboard/me/calls/suggested/${proposalId}`, PEOPLE.david, { answer: "pick", at: String(at), from: "conversation" }, { id: proposalId });
    expect([response.status, response.headers.get("location")]).toEqual([303, `/dashboard/community/dm/${CONVERSATION}#channel-messages`]);
    expect(meetings()).toEqual([expect.objectContaining({ id: proposalId, purpose: "CALL", state: "SCHEDULED", scheduledStartAt: at, bookedMinutes: 30 })]);
    // The suggestion's own page now offers nothing to act on, only the call.
    const page = main((await visit("proposal", `/dashboard/me/calls/suggested/${proposalId}`, PEOPLE.wanjiku, undefined, { id: proposalId })).body);
    expect(page.querySelector("[data-proposal]")?.getAttribute("data-proposal-state")).toBe("accepted");
    expect(page.querySelectorAll("form")).toHaveLength(0);
  });

  it("says Not now with nothing outside the conversation changed, and offers no action afterwards", async () => {
    seeded();
    const proposalId = await suggested(PEOPLE.david);
    const response = await visit("proposal", `/dashboard/me/calls/suggested/${proposalId}`, PEOPLE.wanjiku, { answer: "notNow", from: "conversation" }, { id: proposalId });
    expect(response.status).toBe(303);
    expect(proposals()[0]?.state).toBe("DECLINED");
    const calls = main((await visit("calls", "/dashboard/me/calls", PEOPLE.david)).body);
    expect(calls.textContent).not.toMatch(/not now/i);
    expect(calls.textContent).toContain("No calls yet");
    const again = await visit("proposal", `/dashboard/me/calls/suggested/${proposalId}`, PEOPLE.wanjiku, { answer: "pick", at: "1", from: "proposal" }, { id: proposalId });
    expect(again.status).toBe(409);
    expect(main(again.body).textContent).toContain("This suggestion was already answered.");
  });
});

describe("a booked call", () => {
  async function booked() {
    const proposalId = await suggested();
    const at = (JSON.parse((sqlite.prepare("SELECT times FROM call_proposal WHERE id = ?").get(proposalId) as { times: string }).times) as number[])[0]!;
    await visit("proposal", `/dashboard/me/calls/suggested/${proposalId}`, PEOPLE.david, { answer: "pick", at: String(at), from: "proposal" }, { id: proposalId });
    return proposalId;
  }

  it("is listed on both Calls pages, with its calendar file", async () => {
    seeded();
    const id = await booked();
    const calls = main((await visit("calls", "/dashboard/me/calls", PEOPLE.wanjiku)).body);
    expect(calls.querySelector("[data-calls-coming-up]")?.textContent).toContain("With David Kamau");
    expect(calls.querySelector("h1")?.textContent).toBe("Calls");
    const mentoring = main((await visit("mentoring", "/dashboard/mentoring/calls", PEOPLE.david)).body);
    expect(mentoring.querySelector("[data-calls-coming-up]")?.textContent).toContain("With Wanjiku Njeri");
    const file = await visit("calendar", `/dashboard/me/calls/${id}/calendar.ics`, PEOPLE.david, undefined, { id });
    expect(file.status).toBe(200);
    expect(file.body).toContain(`UID:${id}@`);
    expect(file.body).toContain("SUMMARY:Mentoring call with Wanjiku Njeri");
    expect(file.headers.get("cache-control")).toBe("no-store");
  });

  it("is cancelled behind a confirm step, and the other person is told in the conversation", async () => {
    seeded();
    const id = await booked();
    const confirm = main((await visit("call", `/dashboard/me/calls/${id}?confirm=cancel`, PEOPLE.wanjiku, undefined, { id })).body);
    expect(confirm.querySelector("[data-confirm-step]")?.textContent).toContain("David is told in your conversation.");
    expect(meetings()[0]?.state).toBe("SCHEDULED");
    const response = await visit("call", `/dashboard/me/calls/${id}?confirm=cancel`, PEOPLE.wanjiku, { intent: "cancel" }, { id });
    expect([response.status, response.headers.get("location")]).toEqual([303, "/dashboard/me/calls"]);
    expect(meetings()[0]?.state).toBe("CANCELLED");
    const lines = sqlite.prepare("SELECT body FROM channel_message WHERE channelId = ? ORDER BY seq").all(CONVERSATION) as { body: string }[];
    expect(lines.at(-1)?.body).toMatch(/^Cancelled our call on /);
  });
});

describe("who reaches these pages", () => {
  it("is the conversation's two members: a third person, an admin and a cross-origin post get the same 404", async () => {
    seeded();
    const proposalId = await suggested();
    for (const outsider of [PEOPLE.otieno, PEOPLE.amina]) {
      for (const [page, path, params] of [
        ["suggest", `/dashboard/me/calls/suggest?conversation=${CONVERSATION}`, {}],
        ["proposal", `/dashboard/me/calls/suggested/${proposalId}`, { id: proposalId }],
        ["call", `/dashboard/me/calls/${proposalId}`, { id: proposalId }],
        ["calendar", `/dashboard/me/calls/${proposalId}/calendar.ics`, { id: proposalId }],
      ] as const) {
        const response = await visit(page, path, outsider, undefined, params);
        expect([page, response.status, response.body]).toEqual([page, 404, "Not found."]);
      }
      const posted = await visit("proposal", `/dashboard/me/calls/suggested/${proposalId}`, outsider, { answer: "notNow", from: "proposal" }, { id: proposalId });
      expect(posted.status).toBe(404);
    }
    const crossOrigin = await visit("proposal", `/dashboard/me/calls/suggested/${proposalId}`, PEOPLE.david, { answer: "notNow", from: "proposal" },
      { id: proposalId }, { origin: "https://elsewhere.invalid" });
    expect(crossOrigin.status).toBe(404);
    expect(proposals()[0]?.state).toBe("OPEN");
    // The admin's own Calls page lists nothing of anyone else's.
    expect(main((await visit("calls", "/dashboard/me/calls", PEOPLE.amina)).body).textContent).toContain("No calls yet");
  });

  it("is nobody while calls between two people are off: every page is the same 404, and the conversation offers no call", async () => {
    seeded({ checkins: "OFF" });
    for (const [page, path] of [["calls", "/dashboard/me/calls"], ["mentoring", "/dashboard/mentoring/calls"],
      ["suggest", `/dashboard/me/calls/suggest?conversation=${CONVERSATION}`]] as const) {
      expect((await visit(page, path, PEOPLE.david)).status).toBe(404);
    }
    const conversation = await visit("conversation", `/dashboard/community/dm/${CONVERSATION}`, PEOPLE.david, undefined, { id: CONVERSATION });
    expect(conversation.status).toBe(200);
    expect(main(conversation.body).querySelector("[data-suggest-call]")).toBeNull();
  });

  it("offers Suggest a call in the conversation while it is on", async () => {
    seeded();
    const conversation = await visit("conversation", `/dashboard/community/dm/${CONVERSATION}`, PEOPLE.david, undefined, { id: CONVERSATION });
    expect(main(conversation.body).querySelector("[data-suggest-call]")?.getAttribute("href"))
      .toBe(`/dashboard/me/calls/suggest?conversation=${CONVERSATION}`);
  });
});
