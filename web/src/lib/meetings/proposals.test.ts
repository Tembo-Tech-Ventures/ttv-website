import { createId } from "@paralleldrive/cuid2";
import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import { callBookedAttention, callCancelledAttention, callProposedAttention } from "@/lib/attention/call-producers";
import { listAttention } from "@/lib/attention/service";
import { channelRequest } from "@/lib/channels/http";
import { ORIGIN } from "@/lib/channels/test-support";
import { MessageList, type CallProposalCardView, type MeetingCardView } from "@/lib/platform/contracts";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { MINUTE_MS } from "./clock";
import {
  answerProposal, callConversation, cancelBookedCall, listCalls, readBookedCall, readProposal, suggestCall, type CallCaller, type CallEvent,
  type SuggestInput,
} from "./proposals";
import { CALL_LIMIT_MINUTES, CALL_PROPOSALS_PER_DAY, CHECKIN_LIMIT_MINUTES } from "./rules";
import { meetingDatabase, PEOPLE, T0, type MeetingFixture } from "./test-support";

/*
 * Calls between two people (slice P10) on SQLite with every migration. Wanjiku (the caller) and David,
 * a mentor, share a direct conversation; Otieno is a third person with a conversation of his own with
 * Wanjiku; Amina is an admin outside both. The clock is T0 (Tue 24 Nov 2026, 11:00 in Nairobi).
 */
const HOUR = 60 * MINUTE_MS;
const DAY = 24 * HOUR;
const TIMES = [T0 + DAY, T0 + DAY + 3 * HOUR, T0 + 2 * DAY];

function setup() {
  const s = meetingDatabase();
  const conversation = s.direct([PEOPLE.wanjiku, PEOPLE.david]);
  const other = s.direct([PEOPLE.wanjiku, PEOPLE.otieno]);
  s.database.exec(`INSERT INTO studentProfile(id, handle, userId, headline) VALUES ('wanjiku-profile', 'wanjiku', '${PEOPLE.wanjiku}', 'Builder');
    INSERT INTO communityJourney (id, userId, title, description, evidenceUrl, occurredAt, visibility, state, version, updatedAt)
      VALUES ('fare-splitter', '${PEOPLE.wanjiku}', 'Bus fare splitter', 'Splits matatu fares.', 'https://example.test/fare', '2026-10',
        'institution', 'POSTED', 4, 1);`);
  return { ...s, conversation, other };
}
type Fixture = ReturnType<typeof setup>;

async function caller(s: MeetingFixture, userId: string, checkins = true): Promise<CallCaller> {
  return { userId, capabilities: await capabilitiesFor(s.db, { id: userId }), checkins };
}
function context(s: MeetingFixture, events: CallEvent[] = []) {
  return { db: s.d1, now: s.now(), afterEvent: (event: CallEvent) => { events.push(event); } };
}
const input = (s: Fixture, change: Partial<SuggestInput> = {}): SuggestInput => ({
  conversationId: s.conversation, token: createId(), purpose: "CALL", journeyId: null, bookedMinutes: 30, times: TIMES, askToRecord: false, ...change,
});
async function suggest(s: Fixture, userId: string = PEOPLE.wanjiku, change: Partial<SuggestInput> = {}) {
  return suggestCall(context(s), await caller(s, userId), input(s, change));
}
const proposals = (s: MeetingFixture) => s.database.prepare("SELECT id, proposedBy, state, meetingId, messageId, times FROM call_proposal ORDER BY createdAt, id")
  .all() as { id: string; proposedBy: string; state: string; meetingId: string | null; messageId: string | null; times: string }[];
const lines = (s: MeetingFixture, channelId: string) => s.database.prepare(`SELECT body, authorId, embeds FROM channel_message
    WHERE channelId = ? AND deletedAt IS NULL ORDER BY seq`).all(channelId) as { body: string; authorId: string; embeds: string }[];

/** The conversation's cards, as an open page reads them through GET /api/channels/:id/messages. */
async function cards(s: Fixture, user: string = PEOPLE.david) {
  const request = new Request(`${ORIGIN}/api/channels/x/messages`, { headers: { Origin: ORIGIN } });
  const locals = { user: { id: user }, personalAccessToken: null } as unknown as App.Locals;
  const ctx = { request, locals, params: { id: s.conversation } } as Pick<APIContext, "request" | "locals" | "params">;
  const response = await channelRequest("listMessages", ctx, { DB: s.d1, PLATFORM_FLAGS_OVERRIDE: "all" } as Parameters<typeof channelRequest>[2]);
  expect(response.status).toBe(200);
  const page = MessageList.parse(await response.json());
  return page.items.flatMap((item) => item.embeds) as (CallProposalCardView | MeetingCardView)[];
}
const proposalCards = async (s: Fixture, user?: string) =>
  (await cards(s, user)).filter((card): card is CallProposalCardView => card.type === "callProposal");

async function bell(s: MeetingFixture, userId: string, now = s.now() + 1) {
  const capabilities = await capabilitiesFor(s.db, { id: userId });
  const { items } = await listAttention(s.db, userId, {}, capabilities, now);
  return items.map((item) => ({ kind: item.kind, summary: item.summary, href: item.subject.href }));
}
const env = (s: MeetingFixture) => ({ db: s.d1, env: { DB: s.d1, PLATFORM_FLAGS_OVERRIDE: "all" } });

describe("suggesting a call", () => {
  it("lets either person suggest up to three times, with the card in their conversation and the other person told", async () => {
    const s = setup();
    const events: CallEvent[] = [];
    const first = await suggestCall(context(s, events), await caller(s, PEOPLE.wanjiku), input(s));
    expect(first).toMatchObject({ channelId: s.conversation, counterpart: { id: PEOPLE.david, name: "David Kamau" }, card: "posted" });
    expect(events).toEqual([{ kind: "proposed", proposalId: first.proposalId, countered: false }]);
    const [card] = await proposalCards(s);
    expect(card).toMatchObject({ proposalId: first.proposalId, state: "open", proposedBy: PEOPLE.wanjiku, times: TIMES, bookedMinutes: 30, moves: false, call: null });
    expect(lines(s, s.conversation)[0]).toMatchObject({ authorId: PEOPLE.wanjiku,
      body: "Suggested a call: Wed 25 Nov at 11:00 EAT, Wed 25 Nov at 14:00 EAT or Thu 26 Nov at 11:00 EAT. 30 minutes." });
    await callProposedAttention(env(s), first.proposalId, false, s.now());
    expect(await bell(s, PEOPLE.david)).toEqual([{ kind: "call_proposed", summary: "Wanjiku Njeri suggested times for a call.",
      href: `/dashboard/me/calls/suggested/${first.proposalId}` }]);
    expect(await bell(s, PEOPLE.wanjiku)).toEqual([]);

    // The mentor may suggest too, once the first is answered.
    await answerProposal(context(s), await caller(s, PEOPLE.david), first.proposalId, { kind: "notNow" });
    expect((await suggest(s, PEOPLE.david)).card).toBe("posted");
  });

  it("keeps one open suggestion per conversation in the database, whoever writes it", async () => {
    const s = setup();
    const first = await suggest(s);
    await expect(suggest(s, PEOPLE.david)).rejects.toMatchObject({ status: 409, code: "conflict" });
    // Not only the code: the table refuses a second open row outright.
    expect(() => s.database.prepare(`INSERT INTO call_proposal (id, channelId, proposedBy, purpose, times, bookedMinutes, createdAt, updatedAt)
      VALUES ('second', ?, ?, 'CALL', ?, 30, 1, 1)`).run(s.conversation, PEOPLE.david, JSON.stringify(TIMES))).toThrow(/UNIQUE constraint failed/);
    // Another conversation is free.
    expect((await suggest(s, PEOPLE.wanjiku, { conversationId: s.other })).card).toBe("posted");
    expect(proposals(s).filter(({ state }) => state === "OPEN").map(({ id }) => id)).toContain(first.proposalId);
  });

  it("suggests once for a form sent twice, and refuses the same token with other times or from someone else", async () => {
    const s = setup();
    const sent = input(s);
    const ctx = context(s);
    const [one, two] = await Promise.all([suggestCall(ctx, await caller(s, PEOPLE.wanjiku), sent), suggestCall(ctx, await caller(s, PEOPLE.wanjiku), sent)]);
    expect(one.proposalId).toBe(two.proposalId);
    expect(proposals(s)).toHaveLength(1);
    expect(lines(s, s.conversation)).toHaveLength(1);
    await expect(suggestCall(ctx, await caller(s, PEOPLE.wanjiku), { ...sent, times: [TIMES[0]!] })).rejects.toMatchObject({ status: 409 });
    await expect(suggestCall(ctx, await caller(s, PEOPLE.david), sent)).rejects.toMatchObject({ status: 404 });
  });

  it("checks the times, the work and the length on the server", async () => {
    const s = setup();
    const wanjiku = await caller(s, PEOPLE.wanjiku);
    const refused = (change: Partial<SuggestInput>) => suggestCall(context(s), wanjiku, input(s, change));
    await expect(refused({ times: [] })).rejects.toMatchObject({ status: 400 });
    await expect(refused({ times: [...TIMES, T0 + 3 * DAY] })).rejects.toMatchObject({ status: 400 });
    await expect(refused({ times: [T0 - MINUTE_MS] })).rejects.toMatchObject({ status: 400, message: "Choose times that haven't passed yet." });
    await expect(refused({ times: [T0 + 91 * DAY] })).rejects.toMatchObject({ status: 400 });
    await expect(refused({ bookedMinutes: 100 })).rejects.toMatchObject({ status: 400 });
    await expect(refused({ purpose: "CHECKIN", journeyId: null })).rejects.toMatchObject({ status: 400, message: "Choose the work this check-in is about." });
    // Work outside the conversation's two members can't be a check-in's.
    s.database.exec(`INSERT INTO studentProfile(id, handle, userId, headline) VALUES ('otieno-profile', 'otieno', '${PEOPLE.otieno}', 'Builder');
      INSERT INTO communityJourney (id, userId, title, description, occurredAt, visibility, state, version, updatedAt)
        VALUES ('otieno-work', '${PEOPLE.otieno}', 'Otieno''s app', 'Test', '2026-10', 'institution', 'POSTED', 1, 1);`);
    await expect(refused({ purpose: "CHECKIN", journeyId: "otieno-work" })).rejects.toMatchObject({ status: 400 });
    expect(proposals(s)).toEqual([]);
  });

  it("books a check-in on one revision of one piece of work, which ends at 30 minutes", async () => {
    const s = setup();
    const { proposalId } = await suggest(s, PEOPLE.david, { purpose: "CHECKIN", journeyId: "fare-splitter", bookedMinutes: 90, askToRecord: true });
    const [card] = await proposalCards(s, PEOPLE.wanjiku);
    expect(card).toMatchObject({ purpose: "CHECKIN", bookedMinutes: CHECKIN_LIMIT_MINUTES, askToRecord: true, work: { title: "Bus fare splitter", version: 4 } });
    await answerProposal(context(s), await caller(s, PEOPLE.wanjiku), proposalId, { kind: "pick", at: TIMES[1]! });
    expect(s.row(proposalId)).toMatchObject({
      purpose: "CHECKIN", title: "Check-in on “Bus fare splitter”", scheduledStartAt: TIMES[1], bookedMinutes: 30, limitMinutes: CHECKIN_LIMIT_MINUTES,
      recordingPolicy: "BOTH_AGREE", journeyId: "fare-splitter", journeyVersion: 4, state: "SCHEDULED", createdBy: PEOPLE.wanjiku,
    });
  });

  it("limits how many calls one person suggests in a day", async () => {
    const s = setup();
    const wanjiku = await caller(s, PEOPLE.wanjiku);
    for (let n = 0; n < CALL_PROPOSALS_PER_DAY; n++) {
      const { proposalId } = await suggestCall(context(s), wanjiku, input(s));
      await answerProposal(context(s), wanjiku, proposalId, { kind: "withdraw" });
    }
    await expect(suggestCall(context(s), wanjiku, input(s))).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    s.advance(24 * 60);
    expect((await suggestCall(context(s), wanjiku, input(s, { times: TIMES.map((time) => time + DAY) }))).card).toBe("posted");
  });
});

describe("answering a suggestion", () => {
  it("books the call when the other person picks a time: the meeting, its card, and the suggester told", async () => {
    const s = setup();
    const { proposalId } = await suggest(s);
    const events: CallEvent[] = [];
    const answered = await answerProposal(context(s, events), await caller(s, PEOPLE.david), proposalId, { kind: "pick", at: TIMES[2]! });
    expect(answered).toMatchObject({ meetingId: proposalId, card: "posted", proposal: { state: "accepted" } });
    expect(events).toEqual([{ kind: "booked", proposalId, meetingId: proposalId }]);
    expect(s.row(proposalId)).toMatchObject({
      channelId: s.conversation, purpose: "CALL", title: "Mentoring call", scheduledStartAt: TIMES[2], bookedMinutes: 30,
      limitMinutes: CALL_LIMIT_MINUTES, recordingPolicy: "NONE", state: "SCHEDULED", createdBy: PEOPLE.david,
    });
    const shown = await cards(s, PEOPLE.wanjiku);
    expect(shown.map((card) => [card.type, card.state])).toEqual([["callProposal", "accepted"], ["meeting", "scheduled"]]);
    expect(shown[0]).toMatchObject({ call: { meetingId: proposalId, state: "SCHEDULED", scheduledStartAt: TIMES[2] } });
    expect(shown[1]).toMatchObject({ purpose: "CALL", title: "Mentoring call" });
    expect(lines(s, s.conversation)[1]).toMatchObject({ authorId: PEOPLE.david, body: "Booked the call for Thu 26 Nov at 11:00 EAT, 30 minutes." });

    await callBookedAttention(env(s), proposalId, proposalId, s.now());
    expect(await bell(s, PEOPLE.wanjiku)).toEqual([{ kind: "call_booked", summary: "David Kamau picked Thu 26 Nov at 11:00 EAT. It's in your calls.",
      href: `/dashboard/me/calls/${proposalId}` }]);
  });

  it("answers a double submit once, and refuses another answer to an answered suggestion", async () => {
    const s = setup();
    const { proposalId } = await suggest(s);
    const david = await caller(s, PEOPLE.david);
    const [one, two] = await Promise.all([
      answerProposal(context(s), david, proposalId, { kind: "pick", at: TIMES[0]! }),
      answerProposal(context(s), david, proposalId, { kind: "pick", at: TIMES[0]! }),
    ]);
    expect(one.meetingId).toBe(two.meetingId);
    expect(s.database.prepare("SELECT count(*) AS n FROM meeting").get()).toEqual({ n: 1 });
    expect(lines(s, s.conversation)).toHaveLength(2);
    await expect(answerProposal(context(s), david, proposalId, { kind: "pick", at: TIMES[1]! })).rejects.toMatchObject({ status: 409 });
    await expect(answerProposal(context(s), david, proposalId, { kind: "notNow" })).rejects.toMatchObject({ status: 409 });
  });

  it("lets only the other person pick or say Not now, and only the suggester withdraw", async () => {
    const s = setup();
    const { proposalId } = await suggest(s);
    const wanjiku = await caller(s, PEOPLE.wanjiku);
    const david = await caller(s, PEOPLE.david);
    await expect(answerProposal(context(s), wanjiku, proposalId, { kind: "pick", at: TIMES[0]! })).rejects.toMatchObject({ status: 404 });
    await expect(answerProposal(context(s), wanjiku, proposalId, { kind: "notNow" })).rejects.toMatchObject({ status: 404 });
    await expect(answerProposal(context(s), david, proposalId, { kind: "withdraw" })).rejects.toMatchObject({ status: 404 });
    await expect(answerProposal(context(s), david, proposalId, { kind: "pick", at: T0 + 5 * DAY })).rejects.toMatchObject({ status: 400 });
    const withdrawn = await answerProposal(context(s), wanjiku, proposalId, { kind: "withdraw" });
    expect(withdrawn.proposal.state).toBe("withdrawn");
    expect((await answerProposal(context(s), wanjiku, proposalId, { kind: "withdraw" })).proposal.state).toBe("withdrawn");
    expect((await proposalCards(s))[0]?.state).toBe("withdrawn");
  });

  it("answers with other times: the first is declined and the new one made in one write, and its card says so", async () => {
    const s = setup();
    const { proposalId: first } = await suggest(s);
    s.advance(1);
    const events: CallEvent[] = [];
    const counter = await suggestCall(context(s, events), await caller(s, PEOPLE.david), input(s, { instead: first, times: [T0 + 3 * DAY] }));
    expect(events).toEqual([{ kind: "proposed", proposalId: counter.proposalId, countered: true }]);
    expect(proposals(s).map(({ id, state }) => [id, state])).toEqual([[first, "DECLINED"], [counter.proposalId, "OPEN"]]);
    expect((await proposalCards(s)).map((card) => [card.proposalId, card.state])).toEqual([[first, "countered"], [counter.proposalId, "open"]]);
    expect(lines(s, s.conversation)[1]?.body).toBe("Suggested other times: Fri 27 Nov at 11:00 EAT. 30 minutes.");
    await callProposedAttention(env(s), counter.proposalId, true, s.now());
    expect(await bell(s, PEOPLE.wanjiku)).toEqual([{ kind: "call_countered", summary: "David Kamau suggested other times.",
      href: `/dashboard/me/calls/suggested/${counter.proposalId}` }]);
    // Answering one's own suggestion with other times isn't a thing: the same 404.
    await expect(suggestCall(context(s), await caller(s, PEOPLE.david), input(s, { instead: counter.proposalId }))).rejects.toMatchObject({ status: 404 });
  });

  it("stops offering actions once every time has passed, and lets a new suggestion take its place", async () => {
    const s = setup();
    const { proposalId } = await suggest(s, PEOPLE.wanjiku, { times: [T0 + HOUR, T0 + 2 * HOUR] });
    await callProposedAttention(env(s), proposalId, false, s.now());
    s.advance(90);
    // One time is left: only it can be picked.
    await expect(answerProposal(context(s), await caller(s, PEOPLE.david), proposalId, { kind: "pick", at: T0 + HOUR })).rejects.toMatchObject({ status: 409 });
    s.advance(60);
    expect((await proposalCards(s))[0]?.state).toBe("expired");
    expect((await readProposal(s.d1, await caller(s, PEOPLE.david), proposalId, s.now())).state).toBe("expired");
    await expect(answerProposal(context(s), await caller(s, PEOPLE.david), proposalId, { kind: "pick", at: T0 + 2 * HOUR }))
      .rejects.toMatchObject({ status: 409, message: "These times have passed. Suggest new ones." });
    await expect(answerProposal(context(s), await caller(s, PEOPLE.david), proposalId, { kind: "notNow" })).rejects.toMatchObject({ status: 409 });
    // Its notice has left the bell, and the conversation is free for new times.
    expect(await bell(s, PEOPLE.david)).toEqual([]);
    const next = await suggest(s, PEOPLE.david, { times: [T0 + DAY] });
    expect(proposals(s).map(({ id, state }) => [id, state])).toEqual([[proposalId, "EXPIRED"], [next.proposalId, "OPEN"]]);
  });
});

describe("saying Not now", () => {
  it("leaves no trace outside the conversation: the profile, Discover, the assessment and the other person's bell read as before", async () => {
    const s = setup();
    const { proposalId } = await suggest(s, PEOPLE.david, { purpose: "CHECKIN", journeyId: "fare-splitter" });
    await callProposedAttention(env(s), proposalId, false, s.now());
    const reads = await outsideReads(s);
    await answerProposal(context(s), await caller(s, PEOPLE.wanjiku), proposalId, { kind: "notNow" });

    // Every table outside the suggestion and its conversation is exactly as it was.
    expect(await outsideReads(s)).toEqual(reads);
    // The suggester learns it on the card alone: no notice, and the Calls page lists nothing waiting.
    expect(await bell(s, PEOPLE.david)).toEqual([]);
    expect(await bell(s, PEOPLE.wanjiku)).toEqual([]);
    expect((await listCalls(s.d1, await caller(s, PEOPLE.david), s.now())).waiting).toEqual([]);
    expect((await proposalCards(s))[0]?.state).toBe("declined");
  });
});

/**
 * Every table a member's work and standing is read from outside the conversation: the member's profile
 * and work (what their member page, `/talent` and Discover read), their confirmations and set-asides,
 * visitor messages, mentor requests and profiles, calls, and every Attention item. (not-now.test.ts
 * reads the profile, Discover and the assessment themselves.)
 */
async function outsideReads(s: MeetingFixture) {
  const tables = ["studentProfile", "communityJourney", "communityConfirmation", "communitySetAside", "attention_item", "profileContact",
    "mentor_request", "mentor_profile", "meeting"];
  return Object.fromEntries(tables.map((table) => [table, s.database.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()]));
}

describe("changing and cancelling a booked call", () => {
  async function booked(s: Fixture) {
    const { proposalId } = await suggest(s);
    await answerProposal(context(s), await caller(s, PEOPLE.david), proposalId, { kind: "pick", at: TIMES[0]! });
    return proposalId;
  }

  it("keeps the booked time until a new one is picked, then moves the call and its card", async () => {
    const s = setup();
    const meetingId = await booked(s);
    const before = s.row(meetingId).updatedAt as number;
    const round = await suggest(s, PEOPLE.david, { change: meetingId, times: [T0 + 3 * DAY], bookedMinutes: 45 });
    expect(lines(s, s.conversation).at(-1)?.body).toBe(
      "Suggested new times for our call on Wed 25 Nov at 11:00 EAT: Fri 27 Nov at 11:00 EAT. It stays booked until one is picked.");
    expect(s.row(meetingId)).toMatchObject({ scheduledStartAt: TIMES[0], state: "SCHEDULED" });
    expect((await readBookedCall(s.d1, await caller(s, PEOPLE.wanjiku), meetingId)).pendingChange).toBe(round.proposalId);
    const [, change] = await proposalCards(s, PEOPLE.wanjiku);
    expect(change).toMatchObject({ moves: true, state: "open", call: { meetingId, scheduledStartAt: TIMES[0] } });

    s.advance(1);
    await answerProposal(context(s), await caller(s, PEOPLE.wanjiku), round.proposalId, { kind: "pick", at: T0 + 3 * DAY });
    expect(s.row(meetingId)).toMatchObject({ scheduledStartAt: T0 + 3 * DAY, bookedMinutes: 45, state: "SCHEDULED" });
    expect(s.row(meetingId).updatedAt as number).toBeGreaterThanOrEqual(before + 1000);
    const meetingCard = (await cards(s)).find((card): card is MeetingCardView => card.type === "meeting");
    expect(meetingCard).toMatchObject({ scheduledStartAt: T0 + 3 * DAY, bookedMinutes: 45 });
  });

  it("keeps the booked time when the other person says Not now to new times", async () => {
    const s = setup();
    const meetingId = await booked(s);
    const round = await suggest(s, PEOPLE.wanjiku, { change: meetingId, times: [T0 + 3 * DAY] });
    await answerProposal(context(s), await caller(s, PEOPLE.david), round.proposalId, { kind: "notNow" });
    expect(s.row(meetingId)).toMatchObject({ scheduledStartAt: TIMES[0], state: "SCHEDULED" });
  });

  it("cancels a call that hasn't started, closes its round of new times and tells the other person", async () => {
    const s = setup();
    const meetingId = await booked(s);
    const round = await suggest(s, PEOPLE.david, { change: meetingId, times: [T0 + 3 * DAY] });
    const events: CallEvent[] = [];
    const { call, note } = await cancelBookedCall(context(s, events), await caller(s, PEOPLE.wanjiku), meetingId);
    expect([call.state, note]).toEqual(["CANCELLED", "posted"]);
    expect(events).toEqual([{ kind: "cancelled", meetingId, byUserId: PEOPLE.wanjiku }]);
    expect(proposals(s).find(({ id }) => id === round.proposalId)?.state).toBe("WITHDRAWN");
    expect(lines(s, s.conversation).at(-1)).toMatchObject({ authorId: PEOPLE.wanjiku,
      body: "Cancelled our call on Wed 25 Nov at 11:00 EAT. If you added it to your calendar, remove it there." });
    expect((await cards(s)).find((card) => card.type === "meeting")?.state).toBe("cancelled");
    // Again changes nothing.
    expect((await cancelBookedCall(context(s), await caller(s, PEOPLE.wanjiku), meetingId)).note).toBeNull();

    await callCancelledAttention(env(s), meetingId, PEOPLE.wanjiku, s.now());
    expect(await bell(s, PEOPLE.david)).toContainEqual({ kind: "call_cancelled",
      summary: "Wanjiku Njeri cancelled your call on Wed 25 Nov at 11:00 EAT.", href: `/dashboard/me/calls/${meetingId}` });
  });

  it("refuses to cancel or move a call that has started", async () => {
    const s = setup();
    const meetingId = await booked(s);
    s.database.prepare("UPDATE meeting SET state = 'LIVE', openedAt = ?2, hardEndAt = ?2 + 5400000 WHERE id = ?1").run(meetingId, s.now());
    await expect(cancelBookedCall(context(s), await caller(s, PEOPLE.wanjiku), meetingId)).rejects.toMatchObject({ status: 409 });
    await expect(suggest(s, PEOPLE.wanjiku, { change: meetingId })).rejects.toMatchObject({ status: 409 });
  });
});

describe("who sees calls between two people", () => {
  it("is the conversation's two members: a third person and an admin get the same 404 everywhere, and so does the flag off", async () => {
    const s = setup();
    const { proposalId } = await suggest(s);
    await answerProposal(context(s), await caller(s, PEOPLE.david), proposalId, { kind: "pick", at: TIMES[0]! });
    const { proposalId: open } = await suggest(s, PEOPLE.wanjiku, { change: proposalId });
    for (const outsider of [await caller(s, PEOPLE.otieno), await caller(s, PEOPLE.amina), await caller(s, PEOPLE.wanjiku, false)]) {
      const refusals = [
        callConversation(s.d1, outsider, s.conversation, s.now()),
        readProposal(s.d1, outsider, open, s.now()),
        readBookedCall(s.d1, outsider, proposalId),
        suggestCall(context(s), outsider, input(s)),
        answerProposal(context(s), outsider, open, { kind: "notNow" }),
        answerProposal(context(s), outsider, open, { kind: "withdraw" }),
        cancelBookedCall(context(s), outsider, proposalId),
      ];
      for (const refusal of refusals) await expect(refusal).rejects.toMatchObject({ status: 404, code: "not_found", message: "Not found." });
    }
    expect((await listCalls(s.d1, await caller(s, PEOPLE.amina), s.now()))).toEqual({ comingUp: [], waiting: [], past: [] });
    expect(await bell(s, PEOPLE.amina)).toEqual([]);
    // A cohort session is not a call between two people.
    const session = s.meeting();
    await expect(readBookedCall(s.d1, await caller(s, PEOPLE.wanjiku), session)).rejects.toMatchObject({ status: 404 });
  });
});

describe("the Calls page's list", () => {
  it("lists calls coming up soonest first, suggestions waiting for either person, and calls that took place", async () => {
    const s = setup();
    const { proposalId: booked } = await suggest(s);
    await answerProposal(context(s), await caller(s, PEOPLE.david), booked, { kind: "pick", at: TIMES[1]! });
    const waiting = await suggest(s, PEOPLE.otieno, { conversationId: s.other, times: [T0 + 3 * DAY] });
    const ended = s.meeting({ channelId: s.conversation, purpose: "CALL", state: "SCHEDULED", recordingPolicy: "NONE", title: "Mentoring call" });
    s.database.prepare("UPDATE meeting SET state = 'ENDED', openedAt = ?2, endedAt = ?2 + 1800000, endReason = 'HOST_ENDED' WHERE id = ?1")
      .run(ended, T0 - DAY);

    const list = await listCalls(s.d1, await caller(s, PEOPLE.wanjiku), s.now());
    expect(list.comingUp.map(({ id, counterpart }) => [id, counterpart.name])).toEqual([[booked, "David Kamau"]]);
    expect(list.waiting.map(({ id, mine, counterpart }) => [id, mine, counterpart.name])).toEqual([[waiting.proposalId, false, "Otieno Ouma"]]);
    expect(list.past.map(({ id, capture }) => [id, capture])).toEqual([[ended, null]]);
    // Otieno sees his own suggestion waiting for Wanjiku.
    expect((await listCalls(s.d1, await caller(s, PEOPLE.otieno), s.now())).waiting.map(({ mine }) => mine)).toEqual([true]);
  });
});
