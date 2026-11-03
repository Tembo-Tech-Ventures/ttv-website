import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attentionRequest } from "@/lib/attention/http";
import { VIEWER } from "@/lib/channels/test-support";
import { AttentionItem, AttentionList, ErrorEnvelope, MentorAvailability, MentorDirectory, MentorRequest, ROUTES } from "@/lib/platform/contracts";
import { nextMonthStart } from "./capacity";
import { DIRECTORY_LIMIT } from "./profiles";
import type { MentoringOperation } from "./http";
import { mentoringDatabase, NOW, PEOPLE, type MentoringFixture } from "./test-support";

vi.mock("@/lib/observability/errors", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/observability/errors")>(),
  recordErrorInBackground: vi.fn(),
}));

const fixtures: MentoringFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); vi.restoreAllMocks(); });
function setup(...args: Parameters<typeof mentoringDatabase>) {
  const fixture = mentoringDatabase(...args);
  fixtures.push(fixture);
  return fixture;
}
const errorOf = (body: unknown) => ErrorEnvelope.parse(body).error;
/** Flags as production reads them: from the database, no preview override. */
const DATABASE_FLAGS = { PLATFORM_FLAGS_OVERRIDE: undefined, DEPLOYMENT_ENVIRONMENT: "production" };
const AVAILABILITY = { headline: "Android engineer", monthlyCapacity: 3, areas: ["Mobile", " Kotlin "], formats: ["CALL_30_MIN"], bio: "Offline-first apps.", paused: false };

/** Every route with a valid request, against a request Wanjiku made to David. */
async function everyRoute(s: MentoringFixture) {
  const id = await s.ask();
  return [
    ["listMentors", {}], ["listMentorRequests", { query: "?as=requester" }], ["getMentorRequest", { id }],
    ["createMentorRequest", { body: { mentorId: PEOPLE.mercy, note: "Hi", project: null, format: "WRITTEN_REVIEW" } }],
    ["acceptMentorRequest", { id, body: {}, user: PEOPLE.david }], ["redirectMentorRequest", { id, body: { mentorId: PEOPLE.joseph }, user: PEOPLE.david }],
    ["declineMentorRequest", { id, body: {}, user: PEOPLE.david }], ["withdrawMentorRequest", { id, body: {} }],
    ["reportMentorRequest", { id, body: { reason: "Asks me to pay a fee." }, user: PEOPLE.david }],
    ["listMentorRequestCases", { user: PEOPLE.amina }],
    ["decideMentorRequestCase", { id, body: { action: "keep", reason: "Fine." }, user: PEOPLE.amina }],
    ["getMentorAvailability", { user: PEOPLE.david }], ["updateMentorAvailability", { body: AVAILABILITY, user: PEOPLE.david }],
    ["getWorthAnotherLook", { user: PEOPLE.david }],
  ] as const satisfies readonly (readonly [MentoringOperation, Parameters<MentoringFixture["call"]>[1]])[];
}

describe("mentoring APIs: gates", () => {
  it("cover every mentoring route in the contracts", async () => {
    const s = setup();
    const covered = (await everyRoute(s)).map(([operation]) => operation).toSorted();
    const routes = (Object.keys(ROUTES) as (keyof typeof ROUTES)[])
      .filter((key) => /^\/api\/(mentors|mentor-requests|mentoring|moderation\/mentor-requests)\b/.test(ROUTES[key].path)).toSorted();
    expect(covered).toEqual(routes);
  });

  it("are 404 flag_off on every route while mentor_requests is off for the caller, before reading any mentoring data", async () => {
    for (const [mentorRequests, channels] of [["OFF", "ALL"], ["STAFF", "ALL"], ["ALL", "OFF"]]) {
      const s = setup();
      const routes = await everyRoute(s);
      s.database.exec(`UPDATE feature_flag SET audience = '${mentorRequests}' WHERE key = 'mentor_requests';
        UPDATE feature_flag SET audience = '${channels}' WHERE key = 'channels'`);
      for (const [operation, options] of routes) {
        const prepare = vi.spyOn(s.d1, "prepare");
        // The admin routes' caller is Amina, whom STAFF lets in: Mercy (no staff role) stands in.
        const caller = "user" in options && options.user === PEOPLE.amina ? { user: PEOPLE.mercy } : {};
        const response = await s.call(operation, { ...options, ...caller, env: DATABASE_FLAGS });
        expect([response.status, errorOf(response.body).code], `${mentorRequests}/${channels} ${operation}`).toEqual([404, "flag_off"]);
        const queries = prepare.mock.calls.map(([query]) => query);
        expect(queries.every((query) => /feature_flag|UserRoles/.test(query)), `${queries.join("\n")}`).toBe(true);
        prepare.mockRestore();
      }
      expect(s.database.prepare("SELECT status FROM mentor_request").all()).toEqual([{ status: "PENDING" }]);
    }
  });

  it("open to admins at STAFF (with channels on for them) and to everyone at ALL", async () => {
    const s = setup();
    s.database.exec("UPDATE feature_flag SET audience = 'STAFF' WHERE key IN ('mentor_requests', 'channels')");
    expect((await s.call("listMentors", { user: PEOPLE.amina, env: DATABASE_FLAGS })).status).toBe(200);
    expect((await s.call("listMentors", { env: DATABASE_FLAGS })).status).toBe(404);
    s.database.exec("UPDATE feature_flag SET audience = 'ALL' WHERE key IN ('mentor_requests', 'channels')");
    expect((await s.call("listMentors", { env: DATABASE_FLAGS })).status).toBe(200);
  });

  it("refuse signed-out callers on every route", async () => {
    const s = setup();
    for (const [operation, options] of await everyRoute(s)) {
      expect((await s.call(operation, { ...options, user: null })).status, `${operation}`).toBe(404);
    }
  });

  it("refuse every personal access token, channels and admin scopes included", async () => {
    const s = setup();
    const routes = await everyRoute(s);
    for (const scopes of [["channels:read", "channels:write"], ["admin:read", "admin:write"], ["community:read"]]) {
      for (const [operation, options] of routes) {
        const response = await s.call(operation, { ...options, origin: null, locals: { personalAccessToken: { id: "pat", scopes } } as never });
        expect([response.status, errorOf(response.body).code], `${scopes.join()} ${operation}`).toEqual([403, "forbidden"]);
      }
    }
  });

  it("refuse writes from another origin or none, and serve reads without one", async () => {
    const s = setup();
    for (const [operation, options] of await everyRoute(s)) {
      const write = ROUTES[operation].method !== "GET";
      for (const origin of ["https://evil.example", null]) {
        const response = await s.call(operation, { ...options, origin });
        expect(response.status, `${operation} from ${origin}`).toBe(write ? 403 : 200);
      }
    }
    expect(s.database.prepare("SELECT status FROM mentor_request").all()).toEqual([{ status: "PENDING" }]);
  });

  it("refuse malformed bodies (400) and oversize ones (413) before writing", async () => {
    const s = setup();
    for (const body of [{}, { mentorId: PEOPLE.david, note: " ", project: null, format: "WRITTEN_REVIEW" },
      { mentorId: PEOPLE.david, note: "Hi", project: null, format: "LUNCH" }, { mentorId: PEOPLE.david, note: "Hi", format: "WRITTEN_REVIEW" },
      { mentorId: PEOPLE.david, note: "Hi", project: null, format: "WRITTEN_REVIEW", extra: 1 }]) {
      expect((await s.call("createMentorRequest", { body })).status, `${JSON.stringify(body)}`).toBe(400);
    }
    expect((await s.call("createMentorRequest", { body: { mentorId: PEOPLE.david, note: "x".repeat(20_000), project: null, format: "WRITTEN_REVIEW" } })).status).toBe(413);
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM mentor_request").get()).toEqual({ n: 0 });
  });
});

describe("the directory", () => {
  it("lists listed mentors to any signed-in person, institutions and admins included: public fields only", async () => {
    for (const user of [VIEWER, PEOPLE.amani, PEOPLE.amina, "synthetic-otieno"]) {
      const s = setup();
      const response = await s.call("listMentors", { user });
      expect(response.status, `${user}`).toBe(200);
      const directory = MentorDirectory.parse(response.body);
      expect(directory.items.map((item) => item.person.name), `${user}`).toEqual(["David Kamau", "Joseph Mutua", "Mercy Wambui"]);
      expect(Object.keys(directory.items[0]!).toSorted()).toEqual(["areas", "bio", "capacity", "formats", "headline", "paused", "person"]);
      expect(JSON.stringify(response.body)).not.toMatch(/@example\.test|email|noteReasons/);
    }
  });

  it("leaves out the caller, paused mentors, zero capacity and anyone without the MENTOR role", async () => {
    const s = setup();
    s.database.exec(`UPDATE mentor_profile SET monthlyCapacity = 0 WHERE userId = '${PEOPLE.mercy}'`);
    const names = (body: unknown) => MentorDirectory.parse(body).items.map((item) => item.person.name);
    expect(names((await s.call("listMentors", { user: PEOPLE.david })).body)).toEqual(["Joseph Mutua"]);
    s.database.exec(`DELETE FROM UserRoles WHERE userId = '${PEOPLE.joseph}' AND roleId = (SELECT id FROM Roles WHERE name = 'MENTOR')`);
    expect(names((await s.call("listMentors")).body)).toEqual(["David Kamau"]);
  });

  it("filters by area ignoring case, by format, and by an open spot, putting full mentors last with their next opening", async () => {
    const s = setup();
    await s.ask(PEOPLE.mercy);
    const list = async (query = "") => MentorDirectory.parse((await s.call("listMentors", { query, user: "synthetic-otieno" })).body).items;
    expect((await list()).map((item) => [item.person.name, item.capacity])).toEqual([
      ["David Kamau", { used: 0, limit: 2, nextOpeningAt: null }], ["Joseph Mutua", { used: 0, limit: 3, nextOpeningAt: null }],
      // Mercy's one spot is held by a pending request, which the turn of the month does not free.
      ["Mercy Wambui", { used: 1, limit: 1, nextOpeningAt: null }],
    ]);
    expect((await list("?area=code%20REVIEW")).map((item) => item.person.name)).toEqual(["David Kamau"]);
    expect((await list("?format=CALL_30_MIN")).map((item) => item.person.name)).toEqual(["David Kamau", "Joseph Mutua"]);
    expect((await list("?available=true")).map((item) => item.person.name)).toEqual(["David Kamau", "Joseph Mutua"]);
    expect((await list("?available=false")).map((item) => item.person.name)).toHaveLength(3);
    expect(await list("?area=Underwater%20basket%20weaving")).toEqual([]);
    await s.call("acceptMentorRequest", { id: (await s.call("listMentorRequests", { query: "?as=mentor", user: PEOPLE.mercy }).then((r) => (r.body as { items: { id: string }[] }).items[0]!.id)), user: PEOPLE.mercy, body: {} });
    // Accepted this month: the spot comes back when December starts.
    expect((await list()).at(-1)?.capacity).toEqual({ used: 1, limit: 1, nextOpeningAt: nextMonthStart(NOW) });
  });

  it(`keeps mentors with a spot when more than ${DIRECTORY_LIMIT} are listed, first in the list and under available=true`, async () => {
    const s = setup();
    for (let i = 0; i < DIRECTORY_LIMIT; i += 1) {
      const id = `synthetic-full-${String(i).padStart(3, "0")}`;
      s.database.prepare('INSERT INTO "user"(id,name,email) VALUES (?,?,?)').run(id, `Aaron ${String(i).padStart(3, "0")}`, `${id}@example.test`);
      s.database.prepare("INSERT INTO UserRoles(id,userId,roleId) SELECT ?,?,id FROM Roles WHERE name = 'MENTOR'").run(`role-${id}`, id);
      s.database.prepare("INSERT INTO mentor_profile(userId,headline,monthlyCapacity,createdAt,updatedAt) VALUES (?,'Mentor',1,1,1)").run(id);
      s.database.prepare("INSERT INTO mentor_request(id,requesterId,mentorId,format,note,createdAt,updatedAt) VALUES (?,?,?,'WRITTEN_REVIEW','Hi',1,1)")
        .run(`held-${id}`, "synthetic-otieno", id);
    }
    const names = async (query = "") => MentorDirectory.parse((await s.call("listMentors", { query })).body).items.map((item) => item.person.name);
    expect(await names("?available=true")).toEqual(["David Kamau", "Joseph Mutua", "Mercy Wambui"]);
    const all = await names();
    expect(all).toHaveLength(DIRECTORY_LIMIT);
    expect(all.slice(0, 4)).toEqual(["David Kamau", "Joseph Mutua", "Mercy Wambui", "Aaron 000"]);
  });

  it.each(["?available=yes", "?format=LUNCH", "?area=", "?area=a&area=b", "?unknown=1"])("refuses %s (400)", async (query) => {
    const s = setup();
    expect((await s.call("listMentors", { query })).status).toBe(400);
  });
});

describe("availability", () => {
  it("is the mentor's own: MENTOR role only, defaults before the first save, listed once saved", async () => {
    const s = setup();
    for (const user of [VIEWER, PEOPLE.amani, PEOPLE.amina, PEOPLE.kevin]) {
      for (const operation of ["getMentorAvailability", "updateMentorAvailability"] as const) {
        const response = await s.call(operation, { user, body: operation === "updateMentorAvailability" ? AVAILABILITY : undefined });
        expect([response.status, errorOf(response.body).code], `${user} ${operation}`).toEqual([403, "forbidden"]);
      }
    }
    expect(s.database.prepare(`SELECT COUNT(*) AS n FROM mentor_profile WHERE userId IN ('${VIEWER}', '${PEOPLE.amani}', '${PEOPLE.amina}')`).get()).toEqual({ n: 0 });

    s.database.prepare('INSERT INTO "user"(id,name,email) VALUES (?,?,?)').run("synthetic-samuel", "Samuel Otieno", "s@example.test");
    s.database.exec("INSERT INTO UserRoles(id,userId,roleId) SELECT 'samuel-mentor','synthetic-samuel',id FROM Roles WHERE name = 'MENTOR'");
    const before = MentorAvailability.parse((await s.call("getMentorAvailability", { user: "synthetic-samuel" })).body);
    expect(before).toEqual({ headline: "", bio: "", areas: [], formats: ["WRITTEN_REVIEW", "CALL_30_MIN", "QUICK_QUESTION"], monthlyCapacity: 0,
      paused: false, listed: false, capacity: { used: 0, limit: 0, nextOpeningAt: null } });
    const saved = await s.call("updateMentorAvailability", { user: "synthetic-samuel", body: AVAILABILITY });
    expect(MentorAvailability.parse(saved.body)).toEqual({ ...AVAILABILITY, areas: ["Mobile", "Kotlin"], listed: true,
      capacity: { used: 0, limit: 3, nextOpeningAt: null } });
    expect(MentorDirectory.parse((await s.call("listMentors")).body).items.map((item) => item.person.name)).toContain("Samuel Otieno");
    const paused = await s.call("updateMentorAvailability", { user: "synthetic-samuel", body: { ...AVAILABILITY, paused: true } });
    expect(MentorAvailability.parse(paused.body).listed).toBe(false);
    expect(MentorDirectory.parse((await s.call("listMentors")).body).items.map((item) => item.person.name)).not.toContain("Samuel Otieno");
  });

  it("counts the spots held this month", async () => {
    const s = setup();
    await s.ask();
    expect(MentorAvailability.parse((await s.call("getMentorAvailability", { user: PEOPLE.david })).body).capacity)
      .toEqual({ used: 1, limit: 2, nextOpeningAt: null });
  });
});

describe("attention", () => {
  /** The caller's unread items, as the attention API lists them. */
  const items = (s: MentoringFixture, userId: string) => s.database.prepare(`SELECT kind, space, subjectKind, subjectHref, subjectLabel, actorId, summary
    FROM attention_item WHERE userId = ? ORDER BY createdAt, kind`).all(userId);

  it("tells the other party of each move once, after the response, and never copies the note", async () => {
    const s = setup();
    const id = await s.ask(PEOPLE.david, { note: "Private: my callback idea." });
    expect(items(s, PEOPLE.david)).toEqual([]);
    await s.afterResponse();
    await s.afterResponse();
    expect(items(s, PEOPLE.david)).toEqual([{ kind: "mentor_request", space: "mentoring", subjectKind: "mentorRequest",
      subjectHref: "/dashboard/mentoring/requests", subjectLabel: "Request from Wanjiku Njeri", actorId: VIEWER, summary: "Asked you for a written review." }]);
    const { channelId } = MentorRequest.parse((await s.call("acceptMentorRequest", { id, user: PEOPLE.david, body: {} })).body);
    await s.afterResponse();
    expect(items(s, VIEWER)).toEqual([{ kind: "mentor_accepted", space: "community", subjectKind: "mentorRequest",
      subjectHref: `/dashboard/community/dm/${channelId}`, subjectLabel: "Conversation with David Kamau", actorId: PEOPLE.david,
      summary: "Accepted your request. Your conversation is open." }]);
    expect(JSON.stringify(s.database.prepare("SELECT * FROM attention_item").all())).not.toMatch(/callback idea/);
    for (const row of s.database.prepare("SELECT id FROM attention_item").all() as { id: string }[]) expect(row.id).toEqual(expect.any(String));
  });

  it.each([
    ["redirectMentorRequest", { mentorId: PEOPLE.joseph }, VIEWER, "mentor_redirected", "Suggested you ask Joseph Mutua instead."],
    ["declineMentorRequest", {}, VIEWER, "mentor_declined", "Can't take your request this month."],
    ["withdrawMentorRequest", {}, PEOPLE.david, "mentor_withdrawn", "Withdrew their request."],
  ] as const)("%s tells %s", async (operation, body, recipient, kind, summary) => {
    const s = setup();
    const id = await s.ask();
    await s.afterResponse();
    await s.call(operation, { id, body, user: operation === "withdrawMentorRequest" ? VIEWER : PEOPLE.david });
    await s.afterResponse();
    expect(items(s, recipient).at(-1)).toMatchObject({ kind, summary, subjectHref: recipient === VIEWER ? "/dashboard/community/mentors" : "/dashboard/mentoring/requests" });
    const stored = s.database.prepare("SELECT * FROM attention_item WHERE kind = ?").get(kind) as Record<string, unknown>;
    expect(AttentionItem.safeParse({ id: stored.id, kind, space: stored.space, actor: null, summary, createdAt: 1, readAt: null,
      subject: { kind: stored.subjectKind, id: stored.subjectId, href: stored.subjectHref, label: stored.subjectLabel } }).success).toBe(true);
  });

  it("lists each notice in the attention panel of the party it was for, and nobody else's", async () => {
    const s = setup();
    const listed = async (user: string) => {
      const context = { request: new Request("https://ttv.example/api/attention"), locals: { user: { id: user } } as App.Locals };
      const response = await attentionRequest("list", context as Pick<APIContext, "request" | "locals">, { DB: s.d1, PLATFORM_FLAGS_OVERRIDE: "all" });
      return AttentionList.parse(await response.json()).items.map((item) => [item.kind, item.space, item.actor?.id]);
    };
    // Each move's notice is written after its response, as waitUntil runs it.
    const step = async <T>(work: Promise<T>) => { const result = await work; await s.afterResponse(); return result; };
    await step(s.call("acceptMentorRequest", { id: await step(s.ask()), user: PEOPLE.david, body: {} }));
    await step(s.call("declineMentorRequest", { id: await step(s.ask(PEOPLE.mercy)), user: PEOPLE.mercy, body: {} }));
    await step(s.call("withdrawMentorRequest", { id: await step(s.ask(PEOPLE.joseph, { format: "CALL_30_MIN" })), body: {} }));
    expect((await listed(VIEWER)).toSorted()).toEqual([["mentor_accepted", "community", PEOPLE.david], ["mentor_declined", "community", PEOPLE.mercy]]);
    // A new request's notice leaves the mentor's panel once it no longer waits for their answer (QA4-07).
    expect(await listed(PEOPLE.david)).toEqual([]);
    expect(await listed(PEOPLE.joseph)).toEqual([["mentor_withdrawn", "mentoring", VIEWER]]);
    await step(s.ask(PEOPLE.david, { format: "CALL_30_MIN" }));
    expect(await listed(PEOPLE.david)).toEqual([["mentor_request", "mentoring", VIEWER]]);
    for (const user of [PEOPLE.amina, PEOPLE.amani, "synthetic-otieno"]) expect(await listed(user)).toEqual([]);
    // A mentor whose role is revoked loses the Mentoring space, and its notices with it.
    s.database.exec(`DELETE FROM UserRoles WHERE userId = '${PEOPLE.joseph}' AND roleId = (SELECT id FROM Roles WHERE name = 'MENTOR')`);
    expect(await listed(PEOPLE.joseph)).toEqual([]);
  });

  it("writes nothing while mentor_requests is off for the recipient, and nothing twice", async () => {
    const s = setup();
    await s.ask();
    s.database.exec("UPDATE feature_flag SET audience = 'STAFF' WHERE key IN ('spaces', 'channels', 'mentor_requests')");
    s.deferred.splice(0);
    const { mentorRequestAttention } = await import("@/lib/attention/mentor-producers");
    const id = (s.database.prepare("SELECT id FROM mentor_request").get() as { id: string }).id;
    const context = { db: s.d1, env: DATABASE_FLAGS };
    await mentorRequestAttention(context, id, "created");
    expect(items(s, PEOPLE.david)).toEqual([]);
    s.database.exec("UPDATE feature_flag SET audience = 'ALL' WHERE key IN ('spaces', 'channels', 'mentor_requests')");
    await mentorRequestAttention(context, id, "created");
    await mentorRequestAttention(context, id, "created");
    // An event the request has moved past writes nothing.
    await mentorRequestAttention(context, id, "declined");
    expect(items(s, PEOPLE.david)).toHaveLength(1);
    expect(items(s, VIEWER)).toEqual([]);
  });
});

describe("statement budget", () => {
  /** Statements each route prepares with the flags read from the preview override (no flag read). */
  it.each([
    ["listMentors", 1], ["listMentorRequests", 1], ["getMentorRequest", 1], ["getMentorAvailability", 1], ["updateMentorAvailability", 2],
    ["createMentorRequest", 2], ["redirectMentorRequest", 3], ["declineMentorRequest", 3], ["withdrawMentorRequest", 3],
  ] as const)("%s prepares %i statements", async (operation, budget) => {
    const s = setup();
    const routes = new Map((await everyRoute(s)).map(([key, options]) => [key, options] as const));
    const prepare = vi.spyOn(s.d1, "prepare");
    const response = await s.call(operation, routes.get(operation));
    expect(response.status).toBeLessThan(300);
    expect(prepare.mock.calls.length, `${prepare.mock.calls.map(([query]) => query).join("\n---\n")}`).toBe(budget);
  });

  it("reads each listed mentor's spot counts once in the directory: two index ranges, not again in WHERE or ORDER BY", async () => {
    const s = setup();
    const prepare = vi.spyOn(s.d1, "prepare");
    expect((await s.call("listMentors", { query: "?available=true" })).status).toBe(200);
    const [query] = prepare.mock.calls.at(-1)!;
    const plan = s.database.prepare(`EXPLAIN QUERY PLAN ${query}`).all(VIEWER, 0, null, null, 100, 1).map((row) => String(row.detail));
    expect(plan.filter((detail) => detail.includes("mentor_request_mentor_status_idx"))).toHaveLength(2);
    expect(plan.some((detail) => /MATERIALIZE listed/.test(detail))).toBe(true);
  });

  it("accept prepares one read, one pair lookup, one batch of at most five writes and two reads back", async () => {
    const s = setup();
    const id = await s.ask(PEOPLE.david, { note: "Call 0712 345 678" });
    const prepare = vi.spyOn(s.d1, "prepare");
    const batch = vi.spyOn(s.d1, "batch");
    expect((await s.call("acceptMentorRequest", { id, user: PEOPLE.david, body: {} })).status).toBe(200);
    expect(prepare).toHaveBeenCalledTimes(2 + 5 + 2);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]![0]).toHaveLength(5);
  });
});
