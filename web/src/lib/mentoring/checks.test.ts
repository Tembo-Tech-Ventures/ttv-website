import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attentionRequest } from "@/lib/attention/http";
import { VIEWER } from "@/lib/channels/test-support";
import { CHANNEL_CLEF_QUESTIONS } from "@/lib/channels/moderation/clef";
import {
  AttentionList, ErrorEnvelope, MentorDirectory, MentorRequest, MentorRequestCase, MentorRequestCaseList, MentorRequestList,
} from "@/lib/platform/contracts";
import { CASE_PAGE_SIZE } from "./checks";
import { mentoringDatabase, PEOPLE, type MentoringFixture } from "./test-support";

const fixtures: MentoringFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); vi.restoreAllMocks(); });
function setup(...args: Parameters<typeof mentoringDatabase>) {
  const fixture = mentoringDatabase(...args);
  fixtures.push(fixture);
  return fixture;
}

type Scores = Partial<Record<keyof typeof CHANNEL_CLEF_QUESTIONS, number>>;
/** Clef answering with these scores (or failing), through the request's env. */
function clef(scores: Scores | Error = {}) {
  const run = vi.fn(async () => {
    if (scores instanceof Error) throw scores;
    return { answers: Object.fromEntries(Object.keys(CHANNEL_CLEF_QUESTIONS)
      .map((q) => [q, { type: "noul", noul: scores[q as keyof Scores] ?? 0.02 }])) };
  });
  return { run, env: { AI: { run } as unknown as Ai, AI_GATEWAY_NAME: "ttv-gateway" } };
}
const ABUSE: Scores = { abusive: 0.98 };
const errorOf = (body: unknown) => ErrorEnvelope.parse(body).error;

/** Wanjiku (or `user`) asks `mentorId` with Clef answering `scores`; the work after the response runs. Returns the request id. */
async function ask(s: MentoringFixture, scores: Scores | Error, options: { mentorId?: string; user?: string; note?: string } = {}) {
  const { mentorId = PEOPLE.david, user = VIEWER, note = "Could you look at my callback?" } = options;
  const response = await s.call("createMentorRequest", {
    user, env: clef(scores).env, body: { mentorId, note, project: null, format: "WRITTEN_REVIEW" },
  });
  expect(response.status, `${JSON.stringify(response.body)}`).toBe(201);
  await s.afterResponse();
  return MentorRequest.parse(response.body).id;
}

/** Each step's notices are written after its response. */
async function step<T extends { status: number }>(s: MentoringFixture, work: Promise<T>) {
  const result = await work;
  await s.afterResponse();
  return result;
}

const asMentor = async (s: MentoringFixture, user: string = PEOPLE.david) =>
  MentorRequestList.parse((await s.call("listMentorRequests", { user, query: "?as=mentor" })).body).items;
const asRequester = async (s: MentoringFixture, user: string = VIEWER) =>
  MentorRequestList.parse((await s.call("listMentorRequests", { user, query: "?as=requester" })).body).items;
const queue = async (s: MentoringFixture, query = "") =>
  MentorRequestCaseList.parse((await s.call("listMentorRequestCases", { user: PEOPLE.amina, query })).body);
const decide = (s: MentoringFixture, id: string, action: "keep" | "remove", user: string = PEOPLE.amina) =>
  step(s, s.call("decideMentorRequestCase", { id, user, body: { action, reason: action === "keep" ? "Fine as written." : "Abusive note." } }));
const report = (s: MentoringFixture, id: string, user: string = PEOPLE.david) =>
  step(s, s.call("reportMentorRequest", { id, user, body: { reason: "Insults me and my work." } }));
async function attention(s: MentoringFixture, user: string) {
  const context = { request: new Request("https://ttv.example/api/attention"), locals: { user: { id: user } } as App.Locals };
  const response = await attentionRequest("list", context as Pick<APIContext, "request" | "locals">, { DB: s.d1, PLATFORM_FLAGS_OVERRIDE: "all" });
  return AttentionList.parse(await response.json()).items.map((item) => [item.kind, item.subject?.href ?? null]);
}
const capacityOf = async (s: MentoringFixture, mentor: string) => MentorDirectory.parse((await s.call("listMentors", {})).body)
  .items.find((item) => item.person.id === mentor)?.capacity;

describe("Clef on a new request's note", () => {
  it("holds near-certain abuse: hidden from the mentor, no spot used, the person asking waits, admins are told", async () => {
    const s = setup();
    const id = await ask(s, ABUSE, { mentorId: PEOPLE.mercy });

    expect(s.database.prepare("SELECT state, clefReasons FROM mentor_request_case").all())
      .toEqual([{ state: "OPEN", clefReasons: JSON.stringify(["May be abusive"]) }]);
    // The mentor: not listed, 404 like a missing request, and cannot act on it or report it.
    expect(await asMentor(s, PEOPLE.mercy)).toEqual([]);
    for (const [operation, body] of [["getMentorRequest", undefined], ["acceptMentorRequest", {}], ["declineMentorRequest", {}],
      ["reportMentorRequest", { reason: "x" }]] as const) {
      expect((await s.call(operation, { id, user: PEOPLE.mercy, body })).status, `${operation}`).toBe(404);
    }
    // The person asking: still PENDING, with the neutral check.
    const [mine] = await asRequester(s);
    expect([mine?.status, mine?.check]).toEqual(["PENDING", "waiting"]);
    // Mercy's one spot is free: another member may ask her.
    expect((await capacityOf(s, PEOPLE.mercy))?.used).toBe(0);
    s.database.prepare("INSERT INTO communityProfile(userId, headline) VALUES (?, 'Builder')").run(PEOPLE.amani);
    await ask(s, {}, { mentorId: PEOPLE.mercy, user: PEOPLE.amani });
    expect((await capacityOf(s, PEOPLE.mercy))?.used).toBe(1);
    // Attention: the mentor hears only of the request that was not held; admins hear of the hold.
    expect(await attention(s, PEOPLE.mercy)).toEqual([["mentor_request", "/dashboard/mentoring/requests"]]);
    expect(await attention(s, PEOPLE.amina)).toEqual([["moderation_pending", "/admin/moderation?tab=request-notes"]]);
  });

  it("holds nothing short of near-certain abuse, and the mentor hears of it", async () => {
    for (const scores of [{}, { abusive: 0.89 }, { contact_details: 0.99, unrelated_promotion: 0.99 }]) {
      const s = setup();
      const id = await ask(s, scores);
      expect(s.database.prepare("SELECT COUNT(*) AS n FROM mentor_request_case").get(), `${JSON.stringify(scores)}`).toEqual({ n: 0 });
      expect((await asMentor(s)).map((request) => [request.id, request.check])).toEqual([[id, null]]);
      expect(await attention(s, PEOPLE.david)).toEqual([["mentor_request", "/dashboard/mentoring/requests"]]);
    }
  });

  it("fails open: a Clef error leaves the request as it is, logged without its note, and the mentor hears of it", async () => {
    for (const failure of [new Error("model down"), "not_configured"] as const) {
      const s = setup();
      const response = await s.call("createMentorRequest", {
        env: failure === "not_configured" ? {} : clef(failure).env,
        body: { mentorId: PEOPLE.david, note: "Secret plan for my callback", project: null, format: "WRITTEN_REVIEW" },
      });
      await s.afterResponse();
      const id = MentorRequest.parse(response.body).id;
      expect(s.database.prepare("SELECT COUNT(*) AS n FROM mentor_request_case").get()).toEqual({ n: 0 });
      expect((await asMentor(s)).map((request) => request.id)).toEqual([id]);
      const logged = s.database.prepare(`SELECT level, message FROM "errorEvent"`).all() as { level: string; message: string }[];
      expect(logged.map((row) => row.level)).toEqual(["warning"]);
      expect(JSON.stringify(logged)).not.toContain("Secret plan");
      expect(await attention(s, PEOPLE.david)).toEqual([["mentor_request", "/dashboard/mentoring/requests"]]);
    }
  });

  it("hides a mentor's notice while the mentor may not see the request, whenever it was written", async () => {
    const s = setup();
    const id = await ask(s, new Error("model down"));
    expect(await attention(s, PEOPLE.david)).toEqual([["mentor_request", "/dashboard/mentoring/requests"]]);
    s.database.prepare(`INSERT INTO mentor_request_case (requestId, state, clefReasons, openedAt, createdAt, updatedAt)
      VALUES (?, 'OPEN', '["May be abusive"]', 1, 1, 1)`).run(id);
    expect(await attention(s, PEOPLE.david)).toEqual([]);
  });

  it("holds only a request still waiting with the note Clef read", async () => {
    const s = setup();
    const response = await s.call("createMentorRequest", {
      env: clef(ABUSE).env, body: { mentorId: PEOPLE.david, note: "Rude words", project: null, format: "WRITTEN_REVIEW" },
    });
    const id = MentorRequest.parse(response.body).id;
    // The person asking withdraws before Clef runs: nothing to hold.
    await s.call("withdrawMentorRequest", { id, body: {} });
    await s.afterResponse();
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM mentor_request_case").get()).toEqual({ n: 0 });
  });
});

describe("an admin's decision", () => {
  it("keep releases a held request to its mentor as PENDING, who hears of it once, and closes the admins' notice", async () => {
    const s = setup();
    const id = await ask(s, ABUSE);
    const kept = await decide(s, id, "keep");
    expect(kept.status).toBe(200);
    const decided = MentorRequestCase.parse(kept.body);
    expect([decided.state, decided.decision?.action, decided.decision?.by?.id, decided.request.status]).toEqual(["DECIDED", "keep", PEOPLE.amina, "PENDING"]);
    expect((await asMentor(s)).map((request) => [request.id, request.status, request.check])).toEqual([[id, "PENDING", null]]);
    expect((await asRequester(s)).map((request) => request.check)).toEqual([null]);
    expect((await capacityOf(s, PEOPLE.david))?.used).toBe(1);
    expect(await attention(s, PEOPLE.david)).toEqual([["mentor_request", "/dashboard/mentoring/requests"]]);
    expect(await attention(s, PEOPLE.amina)).toEqual([]);
    // Now the mentor may answer it.
    expect((await s.call("acceptMentorRequest", { id, user: PEOPLE.david, body: {} })).status).toBe(200);
  });

  it("remove closes a held request, never sent: neutral to the person asking, never declined, and they may ask again", async () => {
    const s = setup();
    const id = await ask(s, ABUSE);
    const removed = await decide(s, id, "remove");
    expect(MentorRequestCase.parse(removed.body).decision).toMatchObject({ action: "remove", reason: "Abusive note." });
    const [mine] = await asRequester(s);
    expect([mine?.status, mine?.check]).toEqual(["WITHDRAWN", "not_sent"]);
    expect(JSON.stringify(await s.call("getMentorRequest", { id }))).not.toMatch(/DECLINED|declined|Abusive/);
    expect((await s.call("getMentorRequest", { id, user: PEOPLE.david })).status).toBe(404);
    expect(await asMentor(s)).toEqual([]);
    expect(await attention(s, PEOPLE.david)).toEqual([]);
    expect(s.database.prepare("SELECT status, decidedAt IS NOT NULL AS decided FROM mentor_request").get()).toEqual({ status: "WITHDRAWN", decided: 1 });
    await ask(s, {});
  });

  it("is for admins only, once per check, and only where a check exists", async () => {
    const s = setup();
    const id = await ask(s, ABUSE);
    const plain = await ask(s, {}, { mentorId: PEOPLE.mercy });
    for (const user of [VIEWER, PEOPLE.david, PEOPLE.mercy]) {
      const list = await s.call("listMentorRequestCases", { user });
      expect([list.status, errorOf(list.body).code], `${user}`).toEqual([403, "forbidden"]);
      // Refused before the body is read.
      const decided = await s.call("decideMentorRequestCase", { id, user, body: { action: "remove" } });
      expect([decided.status, errorOf(decided.body).code], `${user}`).toEqual([403, "forbidden"]);
    }
    expect((await s.call("decideMentorRequestCase", { id, user: PEOPLE.amina, body: { action: "remove" } })).status).toBe(400);
    expect((await decide(s, plain, "keep")).status).toBe(404);
    expect((await decide(s, "missing-request", "keep")).status).toBe(404);
    expect((await decide(s, id, "keep")).status).toBe(200);
    const again = await decide(s, id, "remove");
    expect([again.status, errorOf(again.body).message]).toEqual([409, "An admin already decided this check."]);
    expect(s.database.prepare("SELECT status FROM mentor_request WHERE id = ?").get(id)).toEqual({ status: "PENDING" });
  });
});

describe("the mentor's report", () => {
  it("closes the request for the mentor, frees its spot, and opens a check the person asking waits on", async () => {
    const s = setup();
    const id = await ask(s, {});
    const reported = await report(s, id);
    expect(reported.status).toBe(200);
    expect([MentorRequest.parse(reported.body).status, MentorRequest.parse(reported.body).check]).toEqual(["PENDING", "reported"]);
    expect((await asMentor(s)).map((request) => request.check)).toEqual(["reported"]);
    expect((await asRequester(s)).map((request) => request.check)).toEqual(["waiting"]);
    expect((await capacityOf(s, PEOPLE.david))?.used).toBe(0);
    for (const operation of ["acceptMentorRequest", "declineMentorRequest"] as const) {
      const moved = await s.call(operation, { id, user: PEOPLE.david, body: {} });
      expect([moved.status, errorOf(moved.body).message], `${operation}`).toEqual([409, "You reported this request. TTV is checking it."]);
    }
    const { items } = await queue(s);
    expect(items.map((item) => [item.id, item.state, item.report?.reason, item.clefReasons])).toEqual([[id, "OPEN", "Insults me and my work.", []]]);
    // Admins read the note as written; the attention notice names no one and copies nothing.
    expect(items[0]?.request.note).toBe("Could you look at my callback?");
    expect(await attention(s, PEOPLE.amina)).toEqual([["moderation_pending", "/admin/moderation?tab=request-notes"]]);
    // The person asking can still withdraw while they wait.
    expect((await s.call("withdrawMentorRequest", { id, body: {} })).status).toBe(200);
  });

  it("is the mentor's alone, once, while the request waits", async () => {
    const s = setup();
    const id = await ask(s, {});
    expect((await report(s, id, VIEWER)).status).toBe(403);
    expect((await report(s, id, PEOPLE.mercy)).status).toBe(404);
    expect((await s.call("reportMentorRequest", { id, user: PEOPLE.david, body: { reason: " " } })).status).toBe(400);
    expect((await report(s, id)).status).toBe(200);
    const twice = await report(s, id);
    expect([twice.status, errorOf(twice.body).message]).toEqual([409, "You already reported this request."]);
    const declined = await ask(s, {}, { mentorId: PEOPLE.mercy });
    await s.call("declineMentorRequest", { id: declined, user: PEOPLE.mercy, body: {} });
    expect((await report(s, declined, PEOPLE.mercy)).status).toBe(409);
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM mentor_request_report").get()).toEqual({ n: 1 });
  });

  it("after a keep, opens the check again with the earlier decision shown; keep returns it, remove closes it", async () => {
    const s = setup();
    const id = await ask(s, ABUSE);
    await decide(s, id, "keep");
    expect((await report(s, id)).status).toBe(200);
    const [reopened] = (await queue(s)).items;
    expect([reopened?.state, reopened?.decision?.action, reopened?.clefReasons, reopened?.report?.reason])
      .toEqual(["OPEN", "keep", ["May be abusive"], "Insults me and my work."]);
    expect(await attention(s, PEOPLE.amina)).toEqual([["moderation_pending", "/admin/moderation?tab=request-notes"]]);
    await decide(s, id, "remove");
    // The mentor saw it and reported it: they keep seeing it, closed.
    expect((await asMentor(s)).map((request) => [request.status, request.check])).toEqual([["WITHDRAWN", "reported"]]);
    expect((await asRequester(s)).map((request) => [request.status, request.check])).toEqual([["WITHDRAWN", "not_sent"]]);
    expect((await queue(s, "?state=DECIDED")).items.map((item) => item.decision?.action)).toEqual(["remove"]);
  });
});

describe("the admins' queue", () => {
  it("pages oldest first along its index, in one statement", async () => {
    const s = setup();
    for (let i = 0; i < CASE_PAGE_SIZE + 2; i += 1) {
      const user = `synthetic-member-${String(i).padStart(2, "0")}`;
      s.database.prepare('INSERT INTO "user"(id,name,email) VALUES (?,?,?)').run(user, `Member ${i}`, `${user}@example.test`);
      s.database.prepare("INSERT INTO channel_conduct(userId,version,acknowledgedAt) VALUES (?,1,1)").run(user);
      s.database.prepare("INSERT INTO communityProfile(userId, headline) VALUES (?, 'Builder')").run(user);
      s.database.prepare("UPDATE mentor_profile SET monthlyCapacity = 20 WHERE userId = ?").run(PEOPLE.joseph);
      await s.call("createMentorRequest", { user, now: () => 1_000 + i, env: clef(ABUSE).env,
        body: { mentorId: PEOPLE.joseph, note: `Note ${i}`, project: null, format: "CALL_30_MIN" } });
      await s.afterResponse();
    }
    const prepare = vi.spyOn(s.d1, "prepare");
    const first = await queue(s);
    expect(prepare.mock.calls.filter(([query]) => /mentor_request_case c JOIN/.test(query))).toHaveLength(1);
    prepare.mockRestore();
    const second = await queue(s, `?cursor=${first.nextCursor}`);
    expect([first.items.length, second.items.length, second.nextCursor]).toEqual([CASE_PAGE_SIZE, 2, null]);
    expect([...first.items, ...second.items].map((item) => item.request.note)).toEqual(
      Array.from({ length: CASE_PAGE_SIZE + 2 }, (_, i) => `Note ${i}`));
    const plan = s.database.prepare(`EXPLAIN QUERY PLAN SELECT requestId FROM mentor_request_case c
      WHERE c.state = 'OPEN' ORDER BY c.openedAt, c.requestId LIMIT 21`).all() as { detail: string }[];
    expect(plan.map((row) => row.detail).join("\n")).toMatch(/mentor_request_case_queue_idx/);
    expect((await s.call("listMentorRequestCases", { user: PEOPLE.amina, query: "?cursor=nope" })).status).toBe(400);
  });
});
