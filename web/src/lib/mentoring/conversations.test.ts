import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mentionAttention } from "@/lib/attention/channel-producers";
import { attentionRequest } from "@/lib/attention/http";
import { listOwnProjects } from "@/lib/channels/embeds";
import { post, VIEWER } from "@/lib/channels/test-support";
import { AttentionList, ChannelList, Conversation, MentorRequest, MessageList, SearchResults } from "@/lib/platform/contracts";
import { searchRequest } from "@/lib/search/http";
import { getConversation } from "./requests";
import { mentoringDatabase, PEOPLE, type MentoringFixture } from "./test-support";

vi.mock("@/lib/observability/errors", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/observability/errors")>(),
  recordErrorInBackground: vi.fn(),
}));

const fixtures: MentoringFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); });

/**
 * A conversation opened by David accepting Wanjiku's request, with the caller given these roles. A
 * mentor of cohort A, its TA (Faith), an admin, another mentor, an institution and a member of the
 * same cohort are all outside it.
 */
async function conversation(fixture: Parameters<typeof mentoringDatabase>[0] = {}) {
  const s = mentoringDatabase(fixture);
  fixtures.push(s);
  s.database.exec(`INSERT INTO programRole(id,userId,programId,name) VALUES ('mercy-cohort-a','${PEOPLE.mercy}','cohort-a','MENTOR')`);
  const id = await s.ask(PEOPLE.david, { note: "Kipepeo callback question." });
  const { channelId } = MentorRequest.parse((await s.call("acceptMentorRequest", { id, user: PEOPLE.david, body: {} })).body);
  return { s, channelId: channelId! };
}

async function search(s: MentoringFixture, user: string) {
  const context = { request: new Request("https://ttv.example/api/search?q=kipepeo&scope=all"), locals: { user: { id: user } } as App.Locals };
  const response = await searchRequest(context as Pick<APIContext, "request" | "locals">, { DB: s.d1, PLATFORM_FLAGS_OVERRIDE: "all" } as Parameters<typeof searchRequest>[1]);
  return SearchResults.parse(await response.json()).messages;
}

/** The caller's attention items under Mentions, through the attention API. */
async function mentionsOf(s: MentoringFixture) {
  const context = { request: new Request("https://ttv.example/api/attention?filter=mentions"), locals: { user: { id: VIEWER } } as App.Locals };
  const response = await attentionRequest("list", context as Pick<APIContext, "request" | "locals">, { DB: s.d1, PLATFORM_FLAGS_OVERRIDE: "all" });
  return AttentionList.parse(await response.json()).items;
}

const OUTSIDERS = {
  "an admin": PEOPLE.amina, "another mentor, who mentors the asker's cohort": PEOPLE.mercy, "a mentor and institution": PEOPLE.joseph,
  "an institution": PEOPLE.amani, "the cohort's TA": "synthetic-faith", "a member of the same cohort": "synthetic-otieno",
};

describe("a conversation opened by a mentor request", () => {
  it.each([
    ["a community member", {}], ["an approved student", { applications: [{ programId: "cohort-a", status: "APPROVED" as const }] }],
    ["an institution with a member profile", { globalRoles: ["INSTITUTION"] }], ["an admin", { globalRoles: ["ADMIN"] }],
  ])("is read and written by its two members, the asker being %s", async (_, roles) => {
    const { s, channelId } = await conversation(roles);
    for (const user of [VIEWER, PEOPLE.david]) {
      const page = await s.channelCall("listMessages", { id: channelId, user });
      expect(page.status, `${user}`).toBe(200);
      expect(MessageList.parse(page.body).items.map((item) => item.body)).toContain("Kipepeo callback question.");
      expect((await s.channelCall("postMessage", { id: channelId, user, body: post(`Reply from ${user}`) })).status, `${user}`).toBe(201);
      const listed = ChannelList.parse((await s.channelCall("listChannels", { user })).body).items.find((item) => item.id === channelId);
      expect(listed, `${user}`).toMatchObject({ kind: "DIRECT", programId: null, capabilities: { canPost: true, canModerate: false, canShareSessionClip: false } });
      expect((await search(s, user)).map((hit) => hit.channelId), `${user}`).toContain(channelId);
    }
  });

  it.each(Object.entries(OUTSIDERS))("is the same 404 as a missing channel for %s, on every route", async (_, user) => {
    const { s, channelId } = await conversation();
    const messageId = (s.database.prepare("SELECT id FROM channel_message WHERE channelId = ?").get(channelId) as { id: string }).id;
    const missing = await s.channelCall("listMessages", { id: "missing-channel", user });
    for (const [operation, options] of [
      ["listMessages", { id: channelId }], ["postMessage", { id: channelId, body: post("Let me in") }],
      ["markChannelRead", { id: channelId, body: { messageId } }], ["listShareables", { id: channelId }],
      ["reactToMessage", { id: messageId, body: { kind: "useful", active: true } }], ["editMessage", { id: messageId, body: { body: "Changed" } }],
    ] as const) {
      const response = await s.channelCall(operation, { ...options, user });
      expect({ operation, status: response.status }).toEqual({ operation, status: 404 });
      if (operation === "listMessages") expect(response.body).toEqual(missing.body);
    }
    expect(ChannelList.parse((await s.channelCall("listChannels", { user })).body).items.map((item) => item.id)).not.toContain(channelId);
    expect(await search(s, user)).toEqual([]);
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM channel_message WHERE channelId = ?").get(channelId)).toEqual({ n: 1 });
  });

  it("notifies a member mentioned in it, at the conversation", async () => {
    const { s, channelId } = await conversation();
    const response = await s.channelCall("postMessage", { id: channelId, user: PEOPLE.david, body: post("Thanks @Wanjiku Njeri, have a look.") });
    expect(response.status).toBe(201);
    // The channel route leaves mentions for after its response; run that step here.
    await mentionAttention({ db: s.d1, env: { PLATFORM_FLAGS_OVERRIDE: "all" } }, (response.body as { id: string }).id);
    expect(s.database.prepare("SELECT kind, space, subjectHref, summary FROM attention_item WHERE userId = ? AND kind = 'mention'").all(VIEWER)).toEqual([
      { kind: "mention", space: "community", subjectHref: `/dashboard/community/dm/${channelId}`, summary: "Mentioned you in your conversation." },
    ]);
    // Listed while the person is still in the conversation, and gone once they are not.
    const mentions = async () => (await mentionsOf(s)).map((item) => item.subject.href);
    expect(await mentions()).toEqual([`/dashboard/community/dm/${channelId}`]);
    s.database.prepare("DELETE FROM channel_member WHERE channelId = ? AND userId = ?").run(channelId, VIEWER);
    expect(await mentions()).toEqual([]);
  });
});

describe("Tembo's answers in the attention panel", () => {
  it("list while the answer is visible in a channel the asker can read, conversations included", async () => {
    const { s, channelId } = await conversation();
    const listed = async () => (await mentionsOf(s)).map((item) => item.subject.id).toSorted();
    const answers = ["help", `id:${channelId}`].map((place) => {
      const question = s.message(place, { author: VIEWER, body: "@tembo what is idempotency?" });
      const answer = s.message(place, { tembo: true, parentId: question, body: "An operation you can repeat safely." });
      s.database.prepare(`INSERT INTO attention_item (id, userId, eventKey, kind, space, category, subjectKind, subjectId, subjectHref, subjectLabel, summary, createdAt)
        VALUES (?, ?, ?, 'tembo_answer', 'community', 'mentions', 'message', ?, '/dashboard/community', 'Answer', 'Tembo answered your question.', 1)`)
        .run(`item-${answer}`, VIEWER, `["tembo_answer","${answer}"]`, answer);
      return answer;
    });
    expect(await listed()).toEqual(answers.toSorted());
    s.database.prepare("UPDATE channel_message SET moderationState = 'HIDDEN', moderationReasons = '[\"Abuse\"]', hiddenAt = 1 WHERE id = ?").run(answers[0]);
    s.database.prepare("DELETE FROM channel_member WHERE channelId = ? AND userId = ?").run(channelId, VIEWER);
    expect(await listed()).toEqual([]);
  });
});

describe("getConversation (the /dm/:id header)", () => {
  it("gives each member the other person and the request that opened it, as that member sees it", async () => {
    const { s, channelId } = await conversation();
    const forWanjiku = await getConversation({ db: s.d1, viewerId: VIEWER, now: 0 }, channelId);
    expect(Conversation.parse(forWanjiku)).toMatchObject({
      counterpart: { id: PEOPLE.david, name: "David Kamau", roleBadges: [{ kind: "MENTOR" }] },
      request: { status: "ACCEPTED", channelId, requester: { id: VIEWER }, mentor: { id: PEOPLE.david } },
    });
    const forDavid = await getConversation({ db: s.d1, viewerId: PEOPLE.david, now: 0 }, channelId);
    expect(forDavid?.counterpart?.id).toBe(VIEWER);
    expect(forDavid?.request?.id).toBe(forWanjiku?.request?.id);
  });

  it("is null for everyone outside it, and for a channel that is not a conversation", async () => {
    const { s, channelId } = await conversation();
    for (const user of Object.values(OUTSIDERS)) {
      expect(await getConversation({ db: s.d1, viewerId: user, now: 0 }, channelId), `${user}`).toBeNull();
    }
    expect(await getConversation({ db: s.d1, viewerId: VIEWER, now: 0 }, s.channel("help"))).toBeNull();
    expect(await getConversation({ db: s.d1, viewerId: VIEWER, now: 0 }, "missing")).toBeNull();
  });

  it("shows the latest of several requests, and no counterpart once their account is gone", async () => {
    const { s, channelId } = await conversation();
    const later = await s.ask(PEOPLE.david, { note: "A second question.", now: Date.parse("2026-11-20T09:00:00Z") });
    await s.call("acceptMentorRequest", { id: later, user: PEOPLE.david, body: {}, now: () => Date.parse("2026-11-20T10:00:00Z") });
    expect((await getConversation({ db: s.d1, viewerId: VIEWER, now: 0 }, channelId))?.request?.id).toBe(later);
    s.database.exec(`DELETE FROM "user" WHERE id = '${PEOPLE.david}'`);
    expect(await getConversation({ db: s.d1, viewerId: VIEWER, now: 0 }, channelId)).toEqual({ counterpart: null, request: null });
  });
});

describe("listOwnProjects (the request drawer's attach list)", () => {
  it("lists only the caller's own published projects, at their current revision", async () => {
    const s = mentoringDatabase();
    fixtures.push(s);
    s.project("ledger", { version: 3 });
    s.project("draft", { visibility: "private" });
    s.project("theirs", { owner: "synthetic-otieno" });
    expect((await listOwnProjects(s.d1, VIEWER)).map(({ journeyId, version }) => [journeyId, version])).toEqual([["ledger", 3]]);
    expect(await listOwnProjects(s.d1, PEOPLE.david)).toEqual([]);
  });
});
