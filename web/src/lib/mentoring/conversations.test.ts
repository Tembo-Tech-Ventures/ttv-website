import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mentionAttention } from "@/lib/attention/channel-producers";
import { attentionRequest } from "@/lib/attention/http";
import { listOwnProjects } from "@/lib/channels/embeds";
import { post, VIEWER } from "@/lib/channels/test-support";
import { clefScreen, CHANNEL_CLEF_HIDE_THRESHOLD, CHANNEL_CLEF_QUESTIONS } from "@/lib/channels/moderation/clef";
import { countPendingModeration } from "@/lib/channels/moderation/queue";
import {
  AttentionList, ChannelList, Conversation, Message, MentorRequest, MessageList, ModerationQueue, SearchResults,
} from "@/lib/platform/contracts";
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
    const at = `/dashboard/community/dm/${channelId}?message=${(response.body as { id: string }).id}`;
    expect(s.database.prepare("SELECT kind, space, subjectHref, summary FROM attention_item WHERE userId = ? AND kind = 'mention'").all(VIEWER)).toEqual([
      { kind: "mention", space: "community", subjectHref: at, summary: "Mentioned you in your conversation." },
    ]);
    // Listed while the person is still in the conversation, and gone once they are not.
    const mentions = async () => (await mentionsOf(s)).map((item) => item.subject.href);
    expect(await mentions()).toEqual([at]);
    s.database.prepare("DELETE FROM channel_member WHERE channelId = ? AND userId = ?").run(channelId, VIEWER);
    expect(await mentions()).toEqual([]);
  });
});

describe("moderation in a conversation (QA4-01)", () => {
  /** The admins' queue through the API, as Amina (an admin outside the conversation) unless told otherwise. */
  async function queue(s: MentoringFixture, { user = PEOPLE.amina as string, state = "PENDING" } = {}) {
    const response = await s.channelCall("listModerationQueue", { user, query: `?state=${state}` });
    expect(response.status).toBe(200);
    return ModerationQueue.parse(response.body).items;
  }
  const sent = async (s: MentoringFixture, channelId: string, user: string, body: string, parentId: string | null = null) => {
    const response = await s.channelCall("postMessage", { id: channelId, user, body: post(body, parentId) });
    expect(response.status).toBe(201);
    return Message.parse(response.body).id;
  };

  it("lets either member report the other's message, and shows admins that message alone", async () => {
    const { s, channelId } = await conversation();
    const root = await sent(s, channelId, PEOPLE.david, "Pay me outside TTV and I will rank you first.");
    await sent(s, channelId, VIEWER, "Kipepeo reply that stays private.", root);
    const unreported = await sent(s, channelId, PEOPLE.david, "Kipepeo plans for our next session.");
    await s.channelCall("reactToMessage", { id: root, user: VIEWER, body: { kind: "useful", active: true } });
    expect(await queue(s)).toEqual([]);
    const report = await s.channelCall("reportMessage", { id: root, body: { reason: "Asks me to pay outside TTV." } });
    expect([report.status, report.body]).toEqual([201, { ok: true }]);
    expect((await s.channelCall("reportMessage", { id: unreported, user: PEOPLE.david, body: { reason: "x" } })).status).toBe(403);

    const items = await queue(s);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: root, source: "REPORT", reportCount: 1, state: "PENDING",
      channel: { id: channelId, kind: "DIRECT", name: "Direct conversation", topic: "", unreadCount: 0, lastMessageAt: null,
        capabilities: { canPost: false, canModerate: true, canShareSessionClip: false } },
      message: { body: "Pay me outside TTV and I will rank you first.", author: { id: PEOPLE.david }, reactions: [],
        thread: { replyCount: 0, participantIds: [], lastReplyAt: null }, moderation: { state: "VISIBLE" } },
      evidence: [{ body: "Pay me outside TTV and I will rank you first.", cause: "REPORT" }],
    });
    // Nothing else of the conversation: not the request's note, the reply, the other message, or the asker's name.
    const shown = JSON.stringify(items);
    for (const text of ["Kipepeo", "Wanjiku"]) expect(shown).not.toContain(text);
    expect(await countPendingModeration(s.d1, PEOPLE.amina)).toBe(1);
    // The admin still cannot open the conversation, its thread or its other messages.
    for (const [operation, options] of [
      ["listMessages", { id: channelId }], ["listMessages", { id: channelId, query: `?thread=${root}` }],
      ["reactToMessage", { id: unreported, body: { kind: "useful", active: true } }],
    ] as const) {
      expect((await s.channelCall(operation, { ...options, user: PEOPLE.amina })).status, `${operation}`).toBe(404);
    }
    expect(ChannelList.parse((await s.channelCall("listChannels", { user: PEOPLE.amina })).body).items.map((item) => item.id)).not.toContain(channelId);
  });

  it("lets an admin outside it decide the reported message, and only a message with a case", async () => {
    const { s, channelId } = await conversation();
    const root = await sent(s, channelId, PEOPLE.david, "Send me your M-Pesa PIN.");
    const other = await sent(s, channelId, PEOPLE.david, "Another message nobody reported.");
    await s.channelCall("reportMessage", { id: root, body: { reason: "Asks for my PIN." } });
    const refused = await s.channelCall("moderateMessage", { id: other, user: PEOPLE.amina, body: { action: "hide", reason: "Not reported" } });
    expect(refused.status).toBe(404);
    // Its members never moderate it.
    const member = await s.channelCall("moderateMessage", { id: root, body: { action: "hide", reason: "Rude" } });
    expect([member.status, (member.body as { error: { message: string } }).error.message]).toEqual([403, "Only this channel's moderators can do that."]);
    const hidden = await s.channelCall("moderateMessage", { id: root, user: PEOPLE.amina, body: { action: "hide", reason: "Asks for a PIN" } });
    expect(hidden.status).toBe(200);
    await s.channelAfterResponse();
    expect(Message.parse(hidden.body)).toMatchObject({ id: root, moderation: { state: "HIDDEN" }, thread: { replyCount: 0, participantIds: [] } });
    expect(await queue(s)).toEqual([]);
    expect((await queue(s, { state: "DECIDED" })).map((item) => [item.id, item.decision?.action])).toEqual([[root, "hide"]]);
    // Its members see the decision as in any channel: hidden from the reporter, kept for its author.
    const read = async (user: string) => MessageList.parse((await s.channelCall("listMessages", { id: channelId, user })).body).items.map((m) => m.id);
    expect(await read(VIEWER)).not.toContain(root);
    expect(await read(PEOPLE.david)).toContain(root);
    expect(s.database.prepare("SELECT summary FROM attention_item WHERE userId = ? AND kind = 'message_hidden'").all(PEOPLE.david))
      .toEqual([{ summary: "A moderator hid your message in a direct conversation." }]);
  });

  it("never shows a case to an admin who is one of its members, or lets them decide it", async () => {
    const { s, channelId } = await conversation({ globalRoles: ["ADMIN"] });
    const root = await sent(s, channelId, PEOPLE.david, "Rude words for the asker.");
    await s.channelCall("reportMessage", { id: root, body: { reason: "Rude" } });
    await s.channelAfterResponse();
    expect(await queue(s, { user: VIEWER })).toEqual([]);
    expect(await countPendingModeration(s.d1, VIEWER)).toBe(0);
    const own = await s.channelCall("moderateMessage", { id: root, body: { action: "hide", reason: "Rude" } });
    expect([own.status, (own.body as { error: { message: string } }).error.message])
      .toEqual([403, "Another admin needs to decide on a message in a conversation you're in."]);
    // Amina, outside it, is told and decides; the admin in the conversation is not told.
    const notices = s.database.prepare("SELECT userId, summary, subjectHref FROM attention_item WHERE kind = 'moderation_pending'").all();
    expect(notices).toEqual([{ userId: PEOPLE.amina, summary: "A message in a direct conversation was reported.", subjectHref: "/admin/moderation" }]);
    expect((await queue(s)).map((item) => item.id)).toEqual([root]);
  });

  it("sends a message Clef hid, and one the detectors flagged, to the queue alone", async () => {
    const { s, channelId } = await conversation();
    const abusive = await sent(s, channelId, PEOPLE.david, "Something vile about the asker.");
    const contact = await sent(s, channelId, PEOPLE.david, "Call me on 0722 555 019 tonight.");
    const answers = Object.fromEntries(Object.keys(CHANNEL_CLEF_QUESTIONS)
      .map((question) => [question, { type: "noul", noul: question === "abusive" ? CHANNEL_CLEF_HIDE_THRESHOLD : 0.01 }]));
    const run = vi.fn(async () => ({ answers }));
    expect(await clefScreen({ db: s.d1, ai: { run } as unknown as Ai, gatewayName: "gw" },
      { id: abusive, channelId, channelKind: "DIRECT", body: "Something vile about the asker." })).toBe("hidden");
    const items = await queue(s);
    expect(items.map((item) => [item.id, item.source, item.message.moderation?.state]).toSorted()).toEqual([
      [abusive, "AI_FLAG", "HIDDEN"], [contact, "AI_FLAG", "FLAGGED"],
    ].toSorted());
    // The admin sees the flagged contact details in full, as in any channel's queue; the asker sees them masked.
    expect(items.find((item) => item.id === contact)?.message.body).toBe("Call me on 0722 555 019 tonight.");
    expect(JSON.stringify(items)).not.toContain("Kipepeo");
    // The author of the hidden message can ask for a review, which reaches the admins.
    expect((await s.channelCall("requestModerationReview", { id: abusive, user: PEOPLE.david, body: {} })).status).toBe(201);
    expect((await queue(s)).find((item) => item.id === abusive)?.review).toMatchObject({ note: null });
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
    // Explicit members of a channel that is not a conversation still get no header.
    const cohort = s.channel("cohort-04");
    s.database.prepare("INSERT INTO channel_member(channelId, userId) VALUES (?, ?), (?, ?)").run(cohort, VIEWER, cohort, PEOPLE.mercy);
    expect(await getConversation({ db: s.d1, viewerId: VIEWER, now: 0 }, cohort)).toBeNull();
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
