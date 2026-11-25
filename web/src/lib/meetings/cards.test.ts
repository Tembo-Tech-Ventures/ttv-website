import { createId } from "@paralleldrive/cuid2";
import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import { ORIGIN } from "@/lib/channels/test-support";
import { channelRequest } from "@/lib/channels/http";
import { MessageList, type Message, type MeetingCardView } from "@/lib/platform/contracts";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { touchRecordingCard } from "./card-state";
import { openedCardBody } from "./cards";
import { MINUTE_MS } from "./clock";
import { scheduleSessions } from "./sessions";
import { meetingDatabase, PEOPLE, T0, type MeetingFixture } from "./test-support";

/*
 * The session card (slice P9) in cohort A's #cohort-04, read the way an open channel page reads it:
 * the latest page once, then `since` polls through GET /api/channels/:id/messages, validated against
 * the wire contract. Otieno, a member, has the page open; Faith, the cohort's TA, hosts. The fake
 * provider and a clock the test moves stand in for the call; a recording is a fixture row.
 */

/** A GET of the channel's messages as `user`, through the real route. */
async function messages(s: MeetingFixture, user: string, query = "") {
  const request = new Request(`${ORIGIN}/api/channels/x/messages${query}`, { headers: { Origin: ORIGIN } });
  const locals = { user: { id: user }, personalAccessToken: null } as unknown as App.Locals;
  const context = { request, locals, params: { id: s.channel("cohort-04") } } as Pick<APIContext, "request" | "locals" | "params">;
  const response = await channelRequest("listMessages", context, { DB: s.d1, PLATFORM_FLAGS_OVERRIDE: "all" } as Parameters<typeof channelRequest>[2]);
  expect(response.status).toBe(200);
  return MessageList.parse(await response.json());
}

/** An open page: the latest messages, kept up to date by `since` polls, as the channel store does. */
async function openPage(s: MeetingFixture, user: string = PEOPLE.otieno) {
  const first = await messages(s, user);
  const shown = new Map(first.items.map((item) => [item.id, item]));
  let cursor = first.sinceCursor;
  return {
    /** One poll: what changed since the last, applied to the page. */
    async poll() {
      const page = await messages(s, user, `?since=${encodeURIComponent(cursor)}`);
      for (const item of page.items) shown.set(item.id, item);
      for (const id of page.removedIds) shown.delete(id);
      cursor = page.sinceCursor;
      return page.items;
    },
    cards: () => [...shown.values()].flatMap((item: Message) => item.embeds.filter((embed): embed is MeetingCardView => embed.type === "meeting")),
    message: (id: string) => shown.get(id),
  };
}

const state = (cards: MeetingCardView[]) => cards.map((card) => card.state);

async function scheduleOne(s: MeetingFixture, startAt = T0 + 60 * MINUTE_MS) {
  const faith = { userId: PEOPLE.faith, capabilities: await capabilitiesFor(s.db, { id: PEOPLE.faith }), meetings: true };
  const { meetingIds } = await scheduleSessions({ db: s.d1, now: s.now() }, faith, {
    programId: "cohort-a", token: createId(), title: "Testing payment callbacks", startTimes: [startAt], bookedMinutes: 45,
  });
  return meetingIds[0]!;
}

describe("a cohort session's card in an open channel page", () => {
  it("moves through scheduled, live, ended and Watch recording without a reload", async () => {
    const s = meetingDatabase();
    const id = await scheduleOne(s);
    const card = s.row(id).messageId as string;
    expect(card).toEqual(expect.any(String));

    const page = await openPage(s);
    expect(page.cards()).toEqual([expect.objectContaining({
      type: "meeting", meetingId: id, title: "Testing payment callbacks", state: "scheduled", scheduledStartAt: T0 + 60 * MINUTE_MS,
      bookedMinutes: 45, recordingId: null,
    })]);

    // Faith opens the room ten minutes early: the card turns live in Otieno's page on the next poll.
    s.at(50);
    expect((await s.call("joinMeeting", { id, user: PEOPLE.faith })).status).toBe(200);
    expect((await page.poll()).map((item) => item.id)).toEqual([card]);
    expect(state(page.cards())).toEqual(["live"]);
    expect(page.cards()[0]?.openedAt).toBe(T0 + 50 * MINUTE_MS);

    // The recording on its way in (slice P4's row), then Faith ends it for everyone: ended, recording on its way.
    s.database.prepare("INSERT INTO meeting_recording(id, meetingId, state, providerRecordingId, createdAt, updatedAt) VALUES ('capture', ?, 'RECORDING', 'fake-rec', ?, ?)")
      .run(id, s.now(), s.now());
    s.at(100);
    expect((await s.call("endMeeting", { id, user: PEOPLE.faith })).status).toBe(200);
    await page.poll();
    expect(page.cards()).toEqual([expect.objectContaining({ state: "processing", endedAt: T0 + 100 * MINUTE_MS, recordingId: null })]);

    // Its recording is stored and processed (the pipeline's last step moves the card): Watch recording, then Ask Tembo.
    s.database.prepare(`INSERT INTO recording(id, programId, title, processingStatus, r2VideoKey, accessScope, scopeChosen, meetingId)
      VALUES ('session-video', 'cohort-a', 'Testing payment callbacks', 'transcribing', 'videos/session.mp4', 'COHORT', 1, ?)`).run(id);
    await touchRecordingCard(s.d1, "session-video");
    expect(await page.poll()).toHaveLength(1);
    expect(page.cards()).toEqual([expect.objectContaining({ state: "ready", recordingId: "session-video", transcriptReady: false })]);
    s.database.exec("UPDATE recording SET processingStatus = 'complete' WHERE id = 'session-video'");
    await touchRecordingCard(s.d1, "session-video");
    await page.poll();
    expect(page.cards()).toEqual([expect.objectContaining({ state: "ready", recordingId: "session-video", transcriptReady: true })]);

    // Nothing else moved: a poll with no change brings nothing.
    expect(await page.poll()).toEqual([]);
  });

  it("gives a series date its card when its room opens, posted by the host who opened it", async () => {
    const s = meetingDatabase();
    const id = s.meeting({ title: "Week 9: payments and retries" });
    expect(s.row(id).messageId).toBeNull();
    const page = await openPage(s);
    expect(page.cards()).toEqual([]);

    expect((await s.call("joinMeeting", { id, user: PEOPLE.faith })).status).toBe(200);
    const added = await page.poll();
    expect(added).toEqual([expect.objectContaining({
      body: openedCardBody("Week 9: payments and retries"), author: expect.objectContaining({ id: PEOPLE.faith }),
      embeds: [expect.objectContaining({ type: "meeting", meetingId: id, state: "live" })],
    })]);
    expect(s.row(id).messageId).toBe(added[0]!.id);

    // A second host joining doesn't post another card.
    expect((await s.call("joinMeeting", { id, user: PEOPLE.amina })).status).toBe(200);
    expect(await page.poll()).toEqual([]);

    // The card's thread is the session's chat: the room's Chat links to it.
    expect((await s.call("leaveMeeting", { id, user: PEOPLE.faith })).status).toBe(200);
  });

  it("says when a session wasn't recorded, failed, or was cancelled, and never 'not recorded' for a hidden recording", async () => {
    const s = meetingDatabase();
    const cases = {
      none: s.meeting({ state: "LIVE" }), limit: s.meeting({ state: "LIVE" }), failed: s.meeting({ state: "LIVE" }),
      hidden: s.meeting({ state: "LIVE" }), cancelled: s.meeting({ state: "CANCELLED" }),
    };
    s.database.exec(`UPDATE meeting SET state = 'ENDED', endedAt = ${T0 + MINUTE_MS}, endReason = 'HOST_ENDED' WHERE state = 'LIVE'`);
    const capture = (meetingId: string, captured: string) => s.database.prepare(
      "INSERT INTO meeting_recording(id, meetingId, state, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0)").run(`capture-${meetingId}`, meetingId, captured);
    capture(cases.limit, "REFUSED");
    capture(cases.failed, "FAILED");
    s.database.prepare(`INSERT INTO recording(id, programId, title, processingStatus, r2VideoKey, accessScope, scopeChosen, meetingId, hiddenAt)
      VALUES ('hidden-video', 'cohort-a', 'Hidden', 'complete', 'videos/hidden.mp4', 'COHORT', 1, ?, 1)`).run(cases.hidden);
    for (const [index, meetingId] of Object.values(cases).entries()) {
      const message = s.message("cohort-04", { author: "synthetic-faith", body: `Card ${index}` });
      s.database.prepare("UPDATE channel_message SET embeds = json_array(json_object('type', 'meeting', 'meetingId', ?)) WHERE id = ?").run(meetingId, message);
      s.database.prepare("UPDATE meeting SET messageId = ? WHERE id = ?").run(message, meetingId);
    }
    // Faith hosts and may watch the hidden recording elsewhere, but the card speaks for the whole channel.
    for (const user of [PEOPLE.otieno, PEOPLE.faith, PEOPLE.amina]) {
      const page = await openPage(s, user);
      expect(page.cards().map(({ state: at, notRecordedReason }) => [at, notRecordedReason])).toEqual([
        ["notRecorded", null], ["notRecorded", "limit"], ["failed", null], ["ended", null], ["cancelled", null],
      ]);
    }
  });

  it("can't be deleted while it holds a session, and a stranger's message can't carry one", async () => {
    const s = meetingDatabase();
    const id = await scheduleOne(s);
    const card = s.row(id).messageId as string;
    const request = new Request(`${ORIGIN}/api/messages/${card}`, { method: "DELETE", headers: { Origin: ORIGIN } });
    const locals = { user: { id: PEOPLE.faith }, personalAccessToken: null } as unknown as App.Locals;
    const response = await channelRequest("deleteMessage", { request, locals, params: { id: card } } as Pick<APIContext, "request" | "locals" | "params">,
      { DB: s.d1, PLATFORM_FLAGS_OVERRIDE: "all" } as Parameters<typeof channelRequest>[2]);
    expect(response.status).toBe(409);
    expect(s.database.prepare("SELECT deletedAt FROM channel_message WHERE id = ?").get(card)).toEqual({ deletedAt: null });

    // A card naming another channel's call shows nothing.
    const elsewhere = s.meeting({ channelId: s.channel("cohort-05") });
    s.database.prepare("UPDATE channel_message SET embeds = json_array(json_object('type', 'meeting', 'meetingId', ?)) WHERE id = ?").run(elsewhere, card);
    const page = await openPage(s);
    expect(page.cards()).toEqual([]);
  });

  it("follows a moved or cancelled date in an open page", async () => {
    const s = meetingDatabase();
    const id = await scheduleOne(s);
    const page = await openPage(s);
    const faith = { userId: PEOPLE.faith, capabilities: await capabilitiesFor(s.db, { id: PEOPLE.faith }), meetings: true };
    const { changeSession, cancelSession } = await import("./sessions");
    await changeSession({ db: s.d1, now: s.now() }, faith, id, { title: "Testing callbacks", startAt: T0 + 120 * MINUTE_MS, bookedMinutes: 45 });
    await page.poll();
    expect(page.cards()).toEqual([expect.objectContaining({ title: "Testing callbacks", scheduledStartAt: T0 + 120 * MINUTE_MS, state: "scheduled" })]);
    await cancelSession({ db: s.d1, now: s.now() }, faith, id);
    await page.poll();
    expect(state(page.cards())).toEqual(["cancelled"]);
  });
});
