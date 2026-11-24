import { afterEach, describe, expect, it } from "vitest";
import type { Meeting } from "@/lib/platform/contracts";
import { advanceMeeting, cancelMeeting, dueEnd, endMeeting, MINUTE_MS, openMeeting, type MeetingClock } from "./clock";
import {
  CALL_LIMIT_MINUTES, CHECKIN_LIMIT_MINUTES, EMPTY_ROOM_END_MINUTES, NO_HOST_END_MINUTES, NOBODY_CAME_END_MINUTES,
} from "./rules";
import { meetingDatabase, PEOPLE, T0, type MeetingFixture } from "./test-support";

const fixtures: MeetingFixture[] = [];
afterEach(() => fixtures.splice(0).forEach(({ database }) => database.close()));
function setup(...args: Parameters<typeof meetingDatabase>) {
  const s = meetingDatabase(...args);
  fixtures.push(s);
  return s;
}
const state = async (s: MeetingFixture, id: string, user: string = PEOPLE.wanjiku) =>
  ((await s.call("getMeeting", { id, user })).body as unknown as Meeting);
const ctx = (s: MeetingFixture) => ({ db: s.d1, provider: s.provider, now: s.now() });
/** Just before a moment, by one millisecond: still not due. */
const justBefore = (s: MeetingFixture, minutes: number) => { s.at(minutes); s.advance(-1 / MINUTE_MS); };

describe("dueEnd", () => {
  const live: MeetingClock = { purpose: "SESSION", state: "LIVE", openedAt: T0, hardEndAt: T0 + CALL_LIMIT_MINUTES * MINUTE_MS,
    limitMinutes: CALL_LIMIT_MINUTES, seats: [{ role: "HOST", state: "HELD", updatedAt: T0 }] };
  const at = (minutes: number) => T0 + minutes * MINUTE_MS;

  it("ends a call at its hard end, to the millisecond", () => {
    expect(dueEnd(live, at(CALL_LIMIT_MINUTES) - 1)).toBeNull();
    expect(dueEnd(live, at(CALL_LIMIT_MINUTES))).toBe("LIMIT");
  });

  it("never ends a call that isn't live", () => {
    for (const s of ["SCHEDULED", "ENDED", "CANCELLED"] as const) expect(dueEnd({ ...live, state: s }, at(CALL_LIMIT_MINUTES * 2))).toBeNull();
  });

  it("falls back to the limit from opening when a check-in's second person never came", () => {
    const checkin: MeetingClock = { ...live, purpose: "CHECKIN", hardEndAt: null, limitMinutes: CHECKIN_LIMIT_MINUTES };
    expect(dueEnd(checkin, at(NOBODY_CAME_END_MINUTES))).toBe("NOBODY_CAME");
    expect(dueEnd({ ...checkin, seats: [...checkin.seats, ...checkin.seats] }, at(CHECKIN_LIMIT_MINUTES))).toBe("LIMIT");
  });

  it("ends an empty room, then a session or event without a host, then a two-person call the other never joined", () => {
    const gone = { role: "HOST" as const, state: "RELEASED" as const, updatedAt: at(10) };
    expect(dueEnd({ ...live, seats: [gone] }, at(10 + EMPTY_ROOM_END_MINUTES) - 1)).toBeNull();
    expect(dueEnd({ ...live, seats: [gone] }, at(10 + EMPTY_ROOM_END_MINUTES))).toBe("EMPTY");
    const member = { role: "MEMBER" as const, state: "HELD" as const, updatedAt: at(1) };
    for (const purpose of ["SESSION", "EVENT"] as const) {
      expect(dueEnd({ ...live, purpose, seats: [gone, member] }, at(10 + NO_HOST_END_MINUTES) - 1)).toBeNull();
      expect(dueEnd({ ...live, purpose, seats: [gone, member] }, at(10 + NO_HOST_END_MINUTES))).toBe("NO_HOST");
    }
    // Two-person calls have two hosts and no "no host" rule.
    expect(dueEnd({ ...live, purpose: "CALL", seats: [gone, member] }, at(CALL_LIMIT_MINUTES) - 1)).toBeNull();
    const alone = { ...live, purpose: "CALL" as const, seats: [{ ...gone, state: "HELD" as const }] };
    expect(dueEnd(alone, at(NOBODY_CAME_END_MINUTES) - 1)).toBeNull();
    expect(dueEnd(alone, at(NOBODY_CAME_END_MINUTES))).toBe("NOBODY_CAME");
  });
});

describe("advanceMeeting, with a controlled clock", () => {
  it(`ends a cohort session ${CALL_LIMIT_MINUTES} minutes after it opened, stopping its recording and removing everyone`, async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting();
    s.at(0);
    await s.call("joinMeeting", { id, user: PEOPLE.faith });
    await s.call("joinMeeting", { id });
    const providerMeetingId = s.row(id).providerMeetingId as string;
    s.database.prepare(`INSERT INTO meeting_recording (id, meetingId, state, providerRecordingId, reservedSeconds, startedAt, createdAt, updatedAt)
      VALUES ('rec', ?, 'RECORDING', 'fake-recording', ?, ?, ?, ?)`).run(id, CALL_LIMIT_MINUTES * 60, T0, T0, T0);
    justBefore(s, CALL_LIMIT_MINUTES);
    expect((await state(s, id)).state).toBe("LIVE");
    s.at(CALL_LIMIT_MINUTES);
    expect(await state(s, id)).toMatchObject({ state: "ENDED", endReason: "LIMIT", endedAt: s.now() });
    expect(s.seats(id)).toEqual([]);
    expect(s.provider.present(providerMeetingId)).toEqual([]);
    expect(s.provider.log.slice(-2).map(({ operation }) => operation)).toEqual(["stopRecording", "endMeeting"]);
    expect(s.database.prepare("SELECT state, stoppedAt FROM meeting_recording WHERE id = 'rec'").get()).toEqual({ state: "STOPPED", stoppedAt: s.now() });
  });

  it(`ends a check-in ${CHECKIN_LIMIT_MINUTES} minutes after both people are in, not after it opened`, async () => {
    const s = setup();
    const id = s.meeting({ channelId: s.direct(), purpose: "CHECKIN", recordingPolicy: "BOTH_AGREE" });
    s.at(0);
    await s.call("joinMeeting", { id });
    expect(s.row(id).hardEndAt).toBeNull();
    s.at(10);
    await s.call("joinMeeting", { id, user: PEOPLE.otieno });
    expect(s.row(id).hardEndAt).toBe(s.now() + CHECKIN_LIMIT_MINUTES * MINUTE_MS);
    // Leaving and coming back doesn't move it.
    await s.call("leaveMeeting", { id, user: PEOPLE.otieno });
    s.at(11);
    await s.call("joinMeeting", { id, user: PEOPLE.otieno });
    justBefore(s, 10 + CHECKIN_LIMIT_MINUTES);
    expect((await state(s, id)).state).toBe("LIVE");
    s.at(10 + CHECKIN_LIMIT_MINUTES);
    expect(await state(s, id)).toMatchObject({ state: "ENDED", endReason: "LIMIT" });
  });

  it(`ends a session ${NO_HOST_END_MINUTES} minutes after its last host left, unless a host comes back`, async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting();
    s.at(0);
    await s.call("joinMeeting", { id, user: PEOPLE.faith });
    await s.call("joinMeeting", { id });
    s.at(10);
    await s.call("leaveMeeting", { id, user: PEOPLE.faith });
    s.at(13);
    await s.call("joinMeeting", { id, user: PEOPLE.amina });
    s.at(20);
    await s.call("leaveMeeting", { id, user: PEOPLE.amina });
    justBefore(s, 20 + NO_HOST_END_MINUTES);
    expect((await state(s, id)).state).toBe("LIVE");
    s.at(20 + NO_HOST_END_MINUTES);
    expect(await state(s, id)).toMatchObject({ state: "ENDED", endReason: "NO_HOST" });
  });

  it(`ends an empty room ${EMPTY_ROOM_END_MINUTES} minutes after the last person left`, async () => {
    const s = setup({ globalRoles: ["MENTOR"] });
    const id = s.meeting({ channelId: s.channel("introductions"), purpose: "EVENT", recordingPolicy: "NONE" });
    s.at(0);
    await s.call("joinMeeting", { id });
    await s.call("joinMeeting", { id, user: PEOPLE.otieno });
    s.at(4);
    await s.call("leaveMeeting", { id, user: PEOPLE.otieno });
    await s.call("leaveMeeting", { id });
    justBefore(s, 4 + EMPTY_ROOM_END_MINUTES);
    expect((await state(s, id)).state).toBe("LIVE");
    s.at(4 + EMPTY_ROOM_END_MINUTES);
    expect(await state(s, id)).toMatchObject({ state: "ENDED", endReason: "EMPTY" });
  });

  it(`ends a call between two people ${NOBODY_CAME_END_MINUTES} minutes after it opened when the other never came`, async () => {
    const s = setup();
    const id = s.meeting({ channelId: s.direct(), purpose: "CALL", recordingPolicy: "BOTH_AGREE" });
    s.at(0);
    await s.call("joinMeeting", { id });
    justBefore(s, NOBODY_CAME_END_MINUTES);
    expect((await state(s, id)).state).toBe("LIVE");
    s.at(NOBODY_CAME_END_MINUTES);
    expect(await state(s, id)).toMatchObject({ state: "ENDED", endReason: "NOBODY_CAME" });
    expect((await s.call("joinMeeting", { id, user: PEOPLE.otieno })).status).toBe(409);
  });

  it("is idempotent, and an ended or cancelled call never moves again", async () => {
    const s = setup();
    const id = s.meeting({ state: "LIVE" });
    s.at(CALL_LIMIT_MINUTES);
    expect(await advanceMeeting(ctx(s), id)).toBe("ENDED");
    const ended = s.row(id);
    const calls = s.provider.log.length;
    s.at(CALL_LIMIT_MINUTES * 3);
    expect(await advanceMeeting(ctx(s), id)).toBe("ENDED");
    expect(await endMeeting(ctx(s), id, "HOST_ENDED")).toBe("ENDED");
    expect(await openMeeting(ctx(s), id, "Again")).toBe(false);
    expect(await cancelMeeting(ctx(s), id)).toBe(false);
    expect(s.row(id)).toEqual(ended);
    // openMeeting made a provider meeting before finding the call ended; nothing else reached the provider.
    expect(s.provider.log.slice(calls).map(({ operation }) => operation)).toEqual(["createMeeting"]);

    const cancelled = s.meeting();
    expect(await cancelMeeting(ctx(s), cancelled)).toBe(true);
    expect(await cancelMeeting(ctx(s), cancelled)).toBe(false);
    expect(await openMeeting(ctx(s), cancelled, "Again")).toBe(false);
    expect(await endMeeting(ctx(s), cancelled, "HOST_ENDED")).toBe("CANCELLED");
    expect(await advanceMeeting(ctx(s), cancelled)).toBe("CANCELLED");
    expect(await advanceMeeting(ctx(s), "no-such-meeting")).toBeNull();
  });

  it("leaves the call live, seats and all, when the provider fails to end it, and ends it on the next step", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting({ state: "LIVE" });
    await s.call("joinMeeting", { id });
    s.at(CALL_LIMIT_MINUTES);
    s.provider.failNext("endMeeting");
    await expect(advanceMeeting(ctx(s), id)).rejects.toThrow("endMeeting");
    expect(s.row(id).state).toBe("LIVE");
    expect(s.seats(id)).toHaveLength(1);
    expect(await advanceMeeting(ctx(s), id)).toBe("ENDED");
    expect(s.seats(id)).toEqual([]);
  });

  it("refuses a seat past the hard end even before the clock has run", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting({ state: "LIVE" });
    s.at(CALL_LIMIT_MINUTES);
    const { claimSeat } = await import("./seats");
    expect(await claimSeat(ctx(s), id, PEOPLE.wanjiku, "MEMBER")).toEqual({ outcome: "closed" });
    expect(s.seats(id)).toEqual([]);
  });

  it("keeps consent answers only when something was recorded", async () => {
    const s = setup();
    const consent = (id: string) => s.database.prepare(`INSERT INTO meeting_consent (meetingId, userId, answer, wordingVersion, answeredAt)
      VALUES (?, ?, 'RECORD', 1, ?)`).run(id, PEOPLE.wanjiku, T0);
    const unrecorded = s.meeting({ channelId: s.direct(), purpose: "CALL", recordingPolicy: "BOTH_AGREE", state: "LIVE" });
    const recorded = s.meeting({ channelId: s.direct(), purpose: "CALL", recordingPolicy: "BOTH_AGREE", state: "LIVE" });
    for (const id of [unrecorded, recorded]) consent(id);
    s.database.prepare(`INSERT INTO meeting_recording (id, meetingId, state, reservedSeconds, createdAt, updatedAt)
      VALUES ('rec', ?, 'STOPPED', 60, ?, ?)`).run(recorded, T0, T0);
    for (const id of [unrecorded, recorded]) await endMeeting(ctx(s), id, "HOST_ENDED");
    const count = (id: string) => (s.database.prepare("SELECT count(*) AS n FROM meeting_consent WHERE meetingId = ?").get(id) as { n: number }).n;
    expect([count(unrecorded), count(recorded)]).toEqual([0, 1]);
  });
});
