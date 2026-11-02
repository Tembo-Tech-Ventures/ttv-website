import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mentionAttention } from "@/lib/attention/channel-producers";
import { attentionRequest } from "@/lib/attention/http";
import { post, VIEWER } from "@/lib/channels/test-support";
import { AttentionList, ChannelList, MentorRequest, MessageList, SearchResults } from "@/lib/platform/contracts";
import { searchRequest } from "@/lib/search/http";
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
    ["an institution", { globalRoles: ["INSTITUTION"] }], ["an admin", { globalRoles: ["ADMIN"] }],
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
