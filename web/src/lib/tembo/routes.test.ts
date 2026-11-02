import { afterEach, describe, expect, it, vi } from "vitest";
import { VIEWER } from "@/lib/channels/test-support";
import { ErrorEnvelope, MASKED_CONTACT, Message, MessageList, ROUTES, TemboResponse } from "@/lib/platform/contracts";
import { TEMBO_CONFIG } from "./config";
import { refusal } from "./grounding";
import { getMe } from "@/lib/platform/server/me";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { listAttention } from "@/lib/attention/service";
import { temboDay, temboDayEnd } from "./quota";
import { CHANNEL_CLEF_TIMEOUT_MS } from "@/lib/channels/moderation/clef";
import { FINDING_REASONS } from "@/lib/channels/moderation/detectors";
import type { TemboModel } from "./model";
import { NOW, scriptedModel, temboDatabase, type TemboFixture } from "./test-support";

const fixtures: TemboFixture[] = [];
function setup(...args: Parameters<typeof temboDatabase>) {
  const fixture = temboDatabase(...args);
  fixtures.push(fixture);
  return fixture;
}
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.database.close();
  vi.restoreAllMocks();
});

const errorOf = (body: unknown) => ErrorEnvelope.parse(body).error;
const tembo = (body: unknown) => ROUTES.askTembo.response.parse(body) as TemboResponse;
/** Flags as production reads them, from the database: everything on but `off`. */
function databaseFlags(s: TemboFixture, audiences: Record<string, "OFF" | "STAFF" | "ALL"> = {}) {
  s.database.exec("UPDATE feature_flag SET audience = 'ALL'");
  for (const [key, audience] of Object.entries(audiences)) s.database.prepare("UPDATE feature_flag SET audience = ? WHERE key = ?").run(audience, key);
  return { env: { PLATFORM_FLAGS_OVERRIDE: undefined, DEPLOYMENT_ENVIRONMENT: "production" } };
}
/** The person's attention list, once everything written so far is inside its snapshot (a millisecond before now). */
async function attentionOf(s: TemboFixture, userId: string) {
  const [{ latest } = { latest: null }] = s.rows<{ latest: number | null }>("SELECT max(createdAt) AS latest FROM attention_item");
  const inSnapshot = () => latest === null || Date.now() - 1 >= latest;
  while (!inSnapshot()) await new Promise((resolve) => { setTimeout(resolve, 1); });
  const { items } = await listAttention(s.db, userId, {}, await capabilitiesFor(s.db, { id: userId }));
  return items.map((item) => ({ kind: item.kind, summary: item.summary }));
}
const answers = (s: TemboFixture) => s.rows<{ id: string; parentId: string; body: string; citations: string; moderationState: string }>(
  "SELECT id, parentId, body, citations, moderationState FROM channel_message WHERE authorKind = 'TEMBO' ORDER BY seq");

describe("asking Tembo", () => {
  it("accepts, answers in the asking message's thread as Tembo with validated citations, and answers again idempotently", async () => {
    const s = setup();
    const earlier = s.message("help", { body: "Budget templates are pinned at the top of this channel." });
    const question = s.question("help", "@tembo where are the budget templates?");
    const { model, calls } = scriptedModel([
      { search: [["search_channel", "budget templates"]] },
      { answer: "They are pinned at the top of this channel [S1]. Faith made them last year." },
    ]);

    const first = await s.ask("help", question, { temboModel: model });
    expect(first.status).toBe(202);
    expect(tembo(first.body)).toEqual({ status: "pending", messageId: question, usage: { used: 1, limit: 10, resetsAt: temboDayEnd(NOW) } });
    expect(calls).toHaveLength(0);
    await s.afterResponse();

    expect(calls.map((call) => call.tools)).toEqual([["search_projects", "search_channel"], ["search_projects", "search_channel"]]);
    const [answer] = answers(s);
    expect(answer).toMatchObject({ parentId: question, body: "They are pinned at the top of this channel [1].", moderationState: "VISIBLE" });
    expect(JSON.parse(answer!.citations)).toEqual([{
      type: "message", messageId: earlier, channelId: s.channel("help"), title: "Message from Otieno Ouma",
      href: `/dashboard/community/c/help?message=${earlier}`,
    }]);

    const thread = MessageList.parse((await s.call("listMessages", { id: s.channel("help"), query: `?thread=${question}` })).body);
    const message = thread.items.find((item) => item.authorKind === "TEMBO");
    expect(message).toMatchObject({ parentId: question, temboScope: "COMMUNITY", author: { id: null, name: "Tembo" } });

    const again = await s.ask("help", question, { temboModel: model });
    expect(again.status).toBe(200);
    expect(tembo(again.body)).toMatchObject({ status: "answer", message: { id: answer!.id }, usage: { used: 1 } });
    await s.afterResponse();
    expect(calls).toHaveLength(2);
    expect(s.usage()).toEqual([{ day: "2026-11-02", count: 1 }]);
  });

  it("answers a reply in its thread, under the root", async () => {
    const s = setup();
    const root = s.message("help", { body: "Who reviews the budgets?" });
    const reply = s.question("help", "@tembo do you know?", { parentId: root });
    await s.ask("help", reply, { temboModel: scriptedModel([{ answer: "The thread asks who reviews the budgets [S1]." }]).model });
    await s.afterResponse();
    expect(answers(s)).toMatchObject([{ parentId: root }]);
  });

  it("a mention asks once, after the response; the Ask button then returns that answer", async () => {
    const s = setup();
    const { model, calls } = scriptedModel([{ answer: NO_TAGS }]);
    const posted = await s.call("postMessage", { id: s.channel("help"), body: { body: "Hello @Tembo, when is demo day?", clientNonce: "n1", parentId: null, embeds: [] }, temboModel: model, now: () => NOW });
    expect(posted.status).toBe(201);
    const id = Message.parse(posted.body).id;
    expect(s.rows("SELECT * FROM tembo_ask")).toHaveLength(0);
    await s.afterResponse();
    expect(answers(s)).toMatchObject([{ parentId: id, body: refusal("COMMUNITY") }]);

    const button = await s.ask("help", id, { temboModel: model });
    expect([button.status, tembo(button.body).status]).toEqual([200, "answer"]);
    await s.call("postMessage", { id: s.channel("help"), body: { body: "No mention here", clientNonce: "n2", parentId: null, embeds: [] }, temboModel: model });
    await s.afterResponse();
    expect(calls).toHaveLength(1);
    expect(s.usage()).toEqual([{ day: "2026-11-02", count: 1 }]);
  });

  it("concurrent asks of one message run it once and count it once", async () => {
    const s = setup();
    const question = s.question("help");
    const { model, calls } = scriptedModel([{ answer: NO_TAGS }, { answer: NO_TAGS }]);
    const responses = await Promise.all([s.ask("help", question, { temboModel: model }), s.ask("help", question, { temboModel: model })]);
    expect(responses.map((r) => r.status)).toEqual([202, 202]);
    await s.afterResponse();
    expect(calls).toHaveLength(1);
    expect(answers(s)).toHaveLength(1);
    expect(s.usage()).toEqual([{ day: "2026-11-02", count: 1 }]);
  });

  it("says it doesn't know, citing nothing, when the sources don't support the answer, and still counts the question", async () => {
    const s = setup();
    const question = s.question("cohort-04");
    await s.ask("cohort-04", question, { temboModel: scriptedModel([{ answer: "Demo day is on 12 December." }]).model });
    await s.afterResponse();
    expect(answers(s)).toMatchObject([{ body: refusal("COHORT"), citations: "[]" }]);
    expect(s.usage()).toEqual([{ day: "2026-11-02", count: 1 }]);
  });

  it("is refused for someone else's message, a message elsewhere, a closed one and where the caller can't post", async () => {
    const s = setup();
    const otherPerson = s.message("help");
    const elsewhere = s.question("introductions");
    const hidden = s.question("help", "@tembo hidden", { state: "HIDDEN" });
    const deleted = s.question("help", "", { deleted: true });
    const hiddenRoot = s.message("help", { state: "HIDDEN" });
    const underHidden = s.question("help", "@tembo under a hidden root", { parentId: hiddenRoot });
    const announcement = s.question("c04-announcements");
    const otherCohort = s.question("cohort-05");
    const cases = [
      [s.ask("help", otherPerson), 403], [s.ask("help", elsewhere), 404], [s.ask("help", hidden), 409],
      [s.ask("help", deleted), 409], [s.ask("help", underHidden), 409], [s.ask("c04-announcements", announcement), 403],
      [s.ask("cohort-05", otherCohort), 404], [s.ask("help", "missing-message"), 404],
    ] as const;
    for (const [response, status] of cases) expect((await response).status).toBe(status);
    expect(s.rows("SELECT * FROM tembo_ask")).toEqual([]);
    expect(s.usage()).toEqual([]);
  });
});

/** An answer with no tags: Tembo says it doesn't know. */
const NO_TAGS = "I am not sure.";

describe("quota: 10 accepted questions per person per Africa/Nairobi day", () => {
  it("accepts ten, refuses the eleventh with the wait until Nairobi midnight, and resets at 21:00 UTC", async () => {
    const s = setup();
    const questions = Array.from({ length: 12 }, (_, i) => s.question(`help`, `@tembo question ${i}`));
    for (const question of questions.slice(0, 10)) expect((await s.ask("help", question)).status).toBe(202);
    s.deferred.length = 0;

    const refused = await s.ask("help", questions[10]!);
    expect(refused.status).toBe(429);
    const reset = Date.parse("2026-11-02T21:00:00Z");
    expect(errorOf(refused.body)).toMatchObject({ code: "quota_exhausted", retryAfterMs: reset - NOW });
    expect(refused.response.headers.get("Retry-After")).toBe(String((reset - NOW) / 1000));
    expect((await s.ask("help", questions[10]!, { now: () => reset - 1 })).status).toBe(429);
    expect(s.rows("SELECT messageId FROM tembo_ask WHERE messageId = ?", questions[10]!)).toEqual([]);

    // Asking again about an accepted question never counts, even with nothing left.
    expect((await s.ask("help", questions[0]!)).status).toBe(202);
    expect(s.usage()).toEqual([{ day: "2026-11-02", count: 10 }]);

    const tomorrow = await s.ask("help", questions[10]!, { now: () => reset });
    expect(tembo(tomorrow.body)).toMatchObject({ status: "pending", usage: { used: 1, resetsAt: reset + 24 * 3_600_000 } });
    expect(s.usage()).toEqual([{ day: "2026-11-02", count: 10 }, { day: "2026-11-03", count: 1 }]);
  });

  it("lets only one of two concurrent questions take the last place", async () => {
    const s = setup();
    s.database.prepare("INSERT INTO tembo_usage (userId, day, count) VALUES (?, '2026-11-02', 9)").run(VIEWER);
    const [a, b] = [s.question("help"), s.question("help")];
    const statuses = (await Promise.all([s.ask("help", a), s.ask("help", b)])).map((r) => r.status).toSorted();
    expect(statuses).toEqual([202, 429]);
    expect(s.usage()).toEqual([{ day: "2026-11-02", count: 10 }]);
  });

  it("gives the question back when Tembo can't answer, and a retry runs and counts it again", async () => {
    const s = setup();
    const question = s.question("help");
    await s.ask("help", question, { temboModel: scriptedModel([{ fail: true }]).model });
    await s.afterResponse();
    expect(s.rows("SELECT status FROM tembo_ask")).toEqual([{ status: "FAILED" }]);
    expect(s.usage()).toEqual([{ day: "2026-11-02", count: 0 }]);
    expect(answers(s)).toEqual([]);
    // Logged without the question, the sources or the model's words.
    const logged = s.rows<{ level: string; message: string }>("SELECT level, message FROM errorEvent");
    expect(logged).toEqual([expect.objectContaining({ level: "warning", message: "Tembo could not answer a question; it was given back." })]);

    expect((await s.ask("help", question, { temboModel: scriptedModel([{ answer: NO_TAGS }]).model })).status).toBe(202);
    await s.afterResponse();
    expect(s.rows("SELECT status FROM tembo_ask")).toEqual([{ status: "ANSWERED" }]);
    expect(s.usage()).toEqual([{ day: "2026-11-02", count: 1 }]);
  });

  it("claims a run that went quiet again after two minutes, without counting it twice", async () => {
    const s = setup();
    const question = s.question("help");
    await s.ask("help", question);
    s.deferred.length = 0; // The Worker died before answering.
    expect(tembo((await s.ask("help", question, { now: () => NOW + 60_000 })).body).status).toBe("pending");
    expect(s.deferred).toHaveLength(0);
    await s.ask("help", question, { now: () => NOW + 121_000, temboModel: scriptedModel([{ answer: NO_TAGS }]).model });
    await s.afterResponse();
    expect(answers(s)).toHaveLength(1);
    expect(s.usage()).toEqual([{ day: "2026-11-02", count: 1 }]);
  });

  it("an earlier run that lost its claim posts nothing", async () => {
    const s = setup();
    const question = s.question("help");
    await s.ask("help", question, { temboModel: scriptedModel([{ answer: NO_TAGS }]).model });
    const [stale] = s.deferred.splice(0);
    await s.ask("help", question, { now: () => NOW + 121_000, temboModel: scriptedModel([{ answer: NO_TAGS }]).model });
    await stale!();
    expect(answers(s)).toHaveLength(0);
    await s.afterResponse();
    expect(answers(s)).toHaveLength(1);
    expect(s.usage()).toEqual([{ day: "2026-11-02", count: 1 }]);
  });
});

describe("Tembo's answers are moderated like a person's post", () => {
  it("flags contact details before the write, masks them for other readers, and fails open without Clef", async () => {
    const s = setup();
    s.message("help", { body: "Faith runs the budget clinic." });
    const question = s.question("help");
    await s.ask("help", question, { temboModel: scriptedModel([{ answer: "Faith runs it, call 0712 345 678 [S1]." }]).model });
    await s.afterResponse();
    const [answer] = answers(s);
    expect(answer?.moderationState).toBe("FLAGGED");
    expect(s.rows("SELECT source, action FROM moderation_event WHERE messageId = ?", answer!.id)).toEqual([{ source: "DETECTOR", action: "FLAG" }]);
    expect(s.rows("SELECT state FROM moderation_case WHERE messageId = ?", answer!.id)).toEqual([{ state: "PENDING" }]);
    const page = MessageList.parse((await s.call("listMessages", { id: s.channel("help"), query: `?thread=${question}`, user: "synthetic-otieno" })).body);
    expect(page.items.find((item) => item.id === answer!.id)?.body).toContain(MASKED_CONTACT);
    expect(JSON.stringify(page)).not.toContain("345 678");
    // No AI binding here: Clef could not run, the answer stays, and the failure is a warning.
    expect(s.rows("SELECT level FROM errorEvent")).toEqual([{ level: "warning" }]);
  });

  it("tells the person who asked, at the answer in its thread", async () => {
    const s = setup();
    const question = s.question("help");
    await s.ask("help", question, { temboModel: scriptedModel([{ answer: NO_TAGS }]).model });
    await s.afterResponse();
    expect(s.rows("SELECT userId, kind, subjectHref, summary FROM attention_item WHERE kind = 'tembo_answer'")).toEqual([{
      userId: VIEWER, kind: "tembo_answer", subjectHref: `/dashboard/community/c/help?thread=${question}`, summary: "Tembo answered your question in #help.",
    }]);
    // In the asker's Updates while the answer is visible, and gone once it is hidden.
    expect(await attentionOf(s, VIEWER)).toEqual([{ kind: "tembo_answer", summary: "Tembo answered your question in #help." }]);
    s.database.prepare(`UPDATE channel_message SET moderationState = 'HIDDEN', hiddenAt = 1, moderationReasons = '["Synthetic reason"]' WHERE id = ?`)
      .run(answers(s)[0]!.id);
    expect(await attentionOf(s, VIEWER)).toEqual([]);
  });
});

describe("feedback on an answer", () => {
  async function answered(s: TemboFixture) {
    const question = s.question("help");
    await s.ask("help", question, { temboModel: scriptedModel([{ answer: NO_TAGS }]).model });
    await s.afterResponse();
    return answers(s)[0]!.id;
  }

  it("keeps one choice per person and answer, the latest", async () => {
    const s = setup();
    const answer = await answered(s);
    expect((await s.call("temboFeedback", { id: answer, body: { feedback: "helpful" }, now: () => NOW })).status).toBe(200);
    expect((await s.call("temboFeedback", { id: answer, body: { feedback: "not_quite" }, now: () => NOW + 1 })).status).toBe(200);
    expect((await s.call("temboFeedback", { id: answer, body: { feedback: "helpful" }, user: "synthetic-otieno", now: () => NOW })).status).toBe(200);
    expect(s.rows("SELECT userId, kind, createdAt, updatedAt FROM tembo_feedback ORDER BY userId")).toEqual([
      { userId: "synthetic-otieno", kind: "helpful", createdAt: NOW, updatedAt: NOW },
      { userId: VIEWER, kind: "not_quite", createdAt: NOW, updatedAt: NOW + 1 },
    ]);
  });

  it("comes back on the answer for the person who gave it, theirs alone, after a reload and from the Ask button", async () => {
    const s = setup();
    const answer = await answered(s);
    const [question] = s.rows<{ id: string }>("SELECT parentId AS id FROM channel_message WHERE id = ?", answer);
    const seen = async (user: string) => {
      const page = MessageList.parse((await s.call("listMessages", { id: s.channel("help"), query: `?thread=${question!.id}`, user })).body);
      return page.items.map((item) => [item.authorKind, item.temboFeedback]);
    };
    expect(await seen(VIEWER)).toEqual([["TEMBO", null]]);
    const roots = MessageList.parse((await s.call("listMessages", { id: s.channel("help") })).body).items;
    expect(roots.find((item) => item.id === question!.id)).not.toHaveProperty("temboFeedback");
    await s.call("temboFeedback", { id: answer, body: { feedback: "not_quite" }, now: () => NOW });
    await s.call("temboFeedback", { id: answer, body: { feedback: "helpful" }, user: "synthetic-otieno", now: () => NOW });
    expect(await seen(VIEWER)).toEqual([["TEMBO", "not_quite"]]);
    expect(await seen("synthetic-otieno")).toEqual([["TEMBO", "helpful"]]);
    expect(await seen("synthetic-achieng")).toEqual([["TEMBO", null]]);
    const again = tembo((await s.ask("help", question!.id)).body);
    expect(again).toMatchObject({ status: "answer", message: { id: answer, temboFeedback: "not_quite" } });
    // A deleted answer offers no rating, so it carries none.
    s.database.prepare("UPDATE channel_message SET deletedAt = 1, body = '' WHERE id = ?").run(answer);
    expect(await seen(VIEWER)).toEqual([["TEMBO", null]]);
  });

  it("is never on a person's message, by contract", () => {
    const base = { id: "m", channelId: "c", parentId: null, clientNonce: null, authorKind: "USER", body: "Hi", embeds: [], citations: [], reactions: [],
      author: { id: "u", name: "Wanjiku", avatarUrl: null, roleBadges: [] }, createdAt: 1, edited: false, deleted: false, moderation: null,
      thread: { replyCount: 0, participantIds: [], lastReplyAt: null }, temboScope: null };
    expect(Message.safeParse(base).success).toBe(true);
    expect(Message.safeParse({ ...base, temboFeedback: null }).success).toBe(false);
    expect(Message.safeParse({ ...base, temboFeedback: "helpful" }).success).toBe(false);
  });

  it("is only for Tembo answers the caller can see, in valid kinds", async () => {
    const s = setup();
    const answer = await answered(s);
    const person = s.message("help");
    const otherCohort = s.message("cohort-05", { tembo: true, parentId: s.message("cohort-05") });
    expect((await s.call("temboFeedback", { id: person, body: { feedback: "helpful" } })).status).toBe(404);
    expect((await s.call("temboFeedback", { id: otherCohort, body: { feedback: "helpful" } })).status).toBe(404);
    expect((await s.call("temboFeedback", { id: answer, body: { feedback: "great" } })).status).toBe(400);
    s.database.prepare("UPDATE channel_message SET moderationState = 'HIDDEN', moderationReasons = '[\"Abuse\"]', hiddenAt = 1 WHERE id = ?").run(answer);
    expect((await s.call("temboFeedback", { id: answer, body: { feedback: "helpful" } })).status).toBe(404);
    expect(s.rows("SELECT * FROM tembo_feedback")).toEqual([]);
  });
});

describe("gates", () => {
  it.each([
    ["tembo_channels OFF", { tembo_channels: "OFF" }],
    ["tembo_channels STAFF, caller not staff", { tembo_channels: "STAFF" }],
    ["channels OFF", { channels: "OFF" }],
  ] as const)("both routes are 404 flag_off with %s, before reading any channel data, and a mention asks nothing", async (_, audiences) => {
    const s = setup();
    const question = s.question("help");
    const flags = databaseFlags(s, audiences);
    for (const [operation, options] of [["askTembo", { id: s.channel("help"), body: { messageId: question } }],
      ["temboFeedback", { id: question, body: { feedback: "helpful" } }]] as const) {
      const prepare = vi.spyOn(s.d1, "prepare");
      const response = await s.call(operation, { ...options, ...flags });
      expect([response.status, errorOf(response.body).code]).toEqual([404, "flag_off"]);
      expect(prepare.mock.calls.every(([query]) => /feature_flag|UserRoles/.test(query))).toBe(true);
      prepare.mockRestore();
    }
    if (!("channels" in audiences)) {
      await s.call("postMessage", { id: s.channel("help"), body: { body: "@tembo hello", clientNonce: "x", parentId: null, embeds: [] }, ...flags });
      await s.afterResponse();
      expect(s.rows("SELECT * FROM tembo_ask")).toEqual([]);
    }
  });

  it("staff can ask while tembo_channels is STAFF", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    const question = s.question("help");
    expect((await s.ask("help", question, databaseFlags(s, { tembo_channels: "STAFF" }))).status).toBe(202);
  });

  it("needs the same origin from a browser; a channels:write token (acting as its admin owner) may ask, a read-only one may not", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    const question = s.question("help");
    expect((await s.ask("help", question, { origin: "https://evil.example" })).status).toBe(403);
    expect((await s.ask("help", question, { origin: null })).status).toBe(403);
    const token = (scopes: string[]) => ({ locals: { personalAccessToken: { id: "synthetic-pat", scopes } } as never, origin: null });
    expect((await s.ask("help", question, token(["channels:read"]))).status).toBe(403);
    expect((await s.ask("help", question, token(["channels:read", "channels:write"]))).status).toBe(202);
  });
});

describe("query budget", () => {
  it("an ask costs at most 10 statements, feedback fewer; the answer run is bounded too", async () => {
    const s = setup();
    s.message("help", { body: "Budget templates are pinned." });
    const question = s.question("help");
    const flags = databaseFlags(s);
    const prepare = vi.spyOn(s.d1, "prepare");
    const { model } = scriptedModel([{ search: [["search_channel", "budget"], ["search_projects", "budget"]] }, { answer: "Pinned [S1]." }]);
    expect((await s.ask("help", question, { ...flags, temboModel: model })).status).toBe(202);
    // Flags, capabilities (3), the channel, the message, and the four statements of the accepting batch.
    expect(prepare).toHaveBeenCalledTimes(10);
    prepare.mockClear();
    await s.afterResponse();
    // The question, the conversation, one per search (two for projects), the four-statement answer batch,
    // Clef's attempt being logged, and attention (flag read, the answer, the item).
    expect(prepare.mock.calls.length).toBeLessThanOrEqual(16);
    prepare.mockClear();
    expect((await s.call("temboFeedback", { id: answers(s)[0]!.id, body: { feedback: "helpful" }, ...flags })).status).toBe(200);
    expect(prepare).toHaveBeenCalledTimes(7);
  });
});

describe("/me", () => {
  it("reports today's questions while Tembo is on, and none without reading them while it is off", async () => {
    const s = setup();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    s.database.prepare("INSERT INTO tembo_usage (userId, day, count) VALUES (?, ?, 3), (?, '2026-11-01', 9)").run(VIEWER, temboDay(NOW), VIEWER);
    const locals = { user: { id: VIEWER, name: "Wanjiku Njeri", image: null }, isAdmin: false, personalAccessToken: null } as never;
    const me = await getMe({ db: s.d1, env: { PLATFORM_FLAGS_OVERRIDE: "all", DEPLOYMENT_ENVIRONMENT: "agent-pr-1" }, locals });
    expect(me.temboUsage).toEqual({ used: 3, limit: 10, resetsAt: Date.parse("2026-11-02T21:00:00Z") });
    const { env } = databaseFlags(s, { tembo_channels: "OFF" });
    const prepare = vi.spyOn(s.d1, "prepare");
    const off = await getMe({ db: s.d1, env, locals: { ...(locals as object) } as never });
    expect(off.temboUsage).toEqual({ used: 0, limit: 10, resetsAt: temboDayEnd(NOW) });
    expect(prepare.mock.calls.some(([query]) => query.includes("tembo_usage"))).toBe(false);
  });
});

describe("a run's time and its claim", () => {
  /** A model that moves the clock on by `ms` each call and always asks to search. */
  function slowModel(clock: { now: number }, ms: number) {
    const calls: (string[] | undefined)[] = [];
    const model: TemboModel = async (_, tools) => {
      calls.push(tools?.map((tool) => tool.function.name));
      clock.now += ms;
      if (!tools) return { content: "Pinned [S1].", toolCalls: [], finishReason: "stop" };
      return { content: null, finishReason: "tool_calls", toolCalls: [{ id: `c${calls.length}`, type: "function", function: { name: "search_channel", arguments: '{"query":"budget"}' } }] };
    };
    return { model, calls };
  }

  it("stops offering tools after nine seconds, and the last call answers", async () => {
    const s = setup();
    s.message("help", { body: "Budget templates are pinned." });
    const clock = { now: NOW };
    const { model, calls } = slowModel(clock, 10_000);
    await s.ask("help", s.question("help"), { temboModel: model, now: () => clock.now });
    await s.afterResponse();
    expect(calls).toEqual([["search_projects", "search_channel"], undefined]);
    expect(answers(s)).toHaveLength(1);
  });

  it("leaves room after the run for Clef and the notice within work after a response (about 30 s)", () => {
    expect(TEMBO_CONFIG.runBudgetMs + CHANNEL_CLEF_TIMEOUT_MS).toBeLessThanOrEqual(TEMBO_CONFIG.afterResponseMs);
    expect(TEMBO_CONFIG.afterResponseMs).toBeLessThanOrEqual(28_000);
  });

  it("tells the asker before Clef, and gives Clef only what is left of the window, so neither is cut off", async () => {
    const s = setup();
    s.message("help", { body: "Budget templates are pinned." });
    const clock = { now: NOW };
    // A run that took 23 s by the clock: 5 s of the window are left for Clef, not its usual 8.
    const model: TemboModel = async () => {
      clock.now += 23_000;
      return { content: NO_TAGS, toolCalls: [], finishReason: "stop" };
    };
    const hanging = { run: () => new Promise(() => {}) } as unknown as Ai;
    const env = { AI: hanging, AI_GATEWAY_NAME: "synthetic-gateway" };
    await s.ask("help", s.question("help"), { temboModel: model, now: () => clock.now, env });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let done = false;
    try {
      const run = (async () => {
        await s.afterResponse();
        done = true;
      })();
      // The run and the notice need no timers; wait for them on the event loop (setImmediate is not faked).
      for (let turn = 0; turn < 100 && s.rows("SELECT 1 FROM attention_item").length === 0; turn += 1) {
        await new Promise((resolve) => { setImmediate(resolve); });
      }
      expect(answers(s)).toHaveLength(1);
      expect(s.rows("SELECT kind FROM attention_item WHERE kind = 'tembo_answer'")).toEqual([{ kind: "tembo_answer" }]);
      await vi.advanceTimersByTimeAsync(TEMBO_CONFIG.afterResponseMs - 23_000 - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await run;
    } finally { vi.useRealTimers(); }
    expect(done).toBe(true);
    // Clef timed out and failed open: the answer stays, and the timeout is a warning.
    expect(answers(s)).toMatchObject([{ moderationState: "VISIBLE" }]);
    expect(s.rows("SELECT level FROM errorEvent")).toEqual([{ level: "warning" }]);
  });

  it("starts no call with less than two seconds of its budget left, and gives the question back", async () => {
    const s = setup();
    const clock = { now: NOW };
    const { model, calls } = slowModel(clock, TEMBO_CONFIG.runBudgetMs - 1_000);
    await s.ask("help", s.question("help"), { temboModel: model, now: () => clock.now });
    await s.afterResponse();
    expect(calls).toHaveLength(1);
    expect(s.rows("SELECT status FROM tembo_ask")).toEqual([{ status: "FAILED" }]);
    expect(s.usage()).toEqual([{ day: "2026-11-02", count: 0 }]);
    expect(answers(s)).toEqual([]);
  });

  it("abandons a call that outlives the budget, and gives the question back", async () => {
    const s = setup();
    const hanging: TemboModel = () => new Promise(() => {});
    await s.ask("help", s.question("help"), { temboModel: hanging });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const run = s.afterResponse();
      await vi.advanceTimersByTimeAsync(TEMBO_CONFIG.runBudgetMs);
      await run;
    } finally { vi.useRealTimers(); }
    expect(s.rows("SELECT status FROM tembo_ask")).toEqual([{ status: "FAILED" }]);
    expect(answers(s)).toEqual([]);
  });

  it("a run whose claim is taken while it generates posts nothing; the new run answers once", async () => {
    const s = setup();
    const question = s.question("help");
    const second = scriptedModel([{ answer: NO_TAGS }]);
    const first: TemboModel = async () => {
      // The first Worker went quiet long enough for a later ask to claim the question again.
      expect((await s.ask("help", question, { now: () => NOW + 121_000, temboModel: second.model })).status).toBe(202);
      return { content: "Late answer.", toolCalls: [], finishReason: "stop" };
    };
    await s.ask("help", question, { temboModel: first });
    await s.afterResponse();
    expect(second.calls).toHaveLength(1);
    const posted = answers(s);
    expect(posted).toHaveLength(1);
    expect(s.rows("SELECT status, answerId FROM tembo_ask")).toEqual([{ status: "ANSWERED", answerId: posted[0]!.id }]);
    expect(s.usage()).toEqual([{ day: "2026-11-02", count: 1 }]);
  });
});

describe("masked contact details", () => {
  it("are no search oracle: a search matching only inside a masked span finds nothing", async () => {
    const s = setup();
    const flagged = s.message("help", { body: "MASKEDONLY call me on 0712 345 678" });
    s.database.prepare("UPDATE channel_message SET moderationState = 'FLAGGED', moderationReasons = ? WHERE id = ?")
      .run(JSON.stringify([FINDING_REASONS.phone]), flagged);
    // Asked in another thread, so the flagged message is not part of the conversation.
    const question = s.question("help", "@tembo whose number is this?", { parentId: s.message("help", { body: "A different thread" }) });
    const { model, calls, seen } = scriptedModel([{ search: [["search_channel", "0712"], ["search_channel", "345 678"]] }, { answer: "NO_ANSWER" }]);
    await s.ask("help", question, { temboModel: model });
    await s.afterResponse();
    const results = calls[1]!.messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content) as { results: unknown[] });
    expect(results.map((result) => result.results)).toEqual([[], []]);
    expect(seen()).not.toContain("MASKEDONLY");
    expect(answers(s)).toMatchObject([{ citations: "[]" }]);
  });
});

describe("questions closed while Tembo answers", () => {
  /** A model that runs `during` inside its call, then answers. */
  const closingModel = (during: () => Promise<void> | void): TemboModel => async () => {
    await during();
    return { content: "Pinned [S1].", toolCalls: [], finishReason: "stop" };
  };

  it("deleting a question mid-run keeps its count, so deleting can't buy questions beyond the allowance", async () => {
    const s = setup();
    for (let i = 0; i < 10; i += 1) {
      const question = s.question("help", `@tembo question ${i}`);
      const model = closingModel(async () => {
        expect((await s.call("deleteMessage", { id: question })).status).toBe(200);
      });
      expect((await s.ask("help", question, { temboModel: model })).status).toBe(202);
      await s.afterResponse();
    }
    expect(answers(s)).toEqual([]);
    expect(s.usage()).toEqual([{ day: "2026-11-02", count: 10 }]);
    expect(errorOf((await s.ask("help", s.question("help"))).body).code).toBe("quota_exhausted");
  });

  it("a question a moderator hides mid-run gets no answer, and keeps its count", async () => {
    const s = setup();
    const question = s.question("help");
    await s.ask("help", question, { temboModel: closingModel(() => {
      s.database.prepare("UPDATE channel_message SET moderationState = 'HIDDEN', moderationReasons = '[\"Abuse\"]', hiddenAt = 1 WHERE id = ?").run(question);
    }) });
    await s.afterResponse();
    expect(answers(s)).toEqual([]);
    expect(s.rows("SELECT status FROM tembo_ask")).toEqual([{ status: "FAILED" }]);
    expect(s.usage()).toEqual([{ day: "2026-11-02", count: 1 }]);
  });

  it.each(["deleted", "hidden"] as const)("a question %s before the run reads it gets no answer, no model call, and is given back", async (how) => {
    const s = setup();
    const root = s.message("help", { body: "Thread root" });
    const question = s.question("help", "@tembo in a thread", { parentId: root });
    const { model, calls } = scriptedModel([{ answer: "Pinned [S1]." }]);
    await s.ask("help", question, { temboModel: model });
    // Closing the thread's root closes the question too.
    s.database.prepare(how === "deleted" ? "UPDATE channel_message SET body = '', deletedAt = 5 WHERE id = ?"
      : "UPDATE channel_message SET moderationState = 'HIDDEN', moderationReasons = '[\"Abuse\"]', hiddenAt = 5 WHERE id = ?").run(root);
    await s.afterResponse();
    expect(calls).toHaveLength(0);
    expect(answers(s)).toEqual([]);
    expect(s.usage()).toEqual([{ day: "2026-11-02", count: 0 }]);
  });
});
