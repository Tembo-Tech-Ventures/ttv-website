import { afterEach, describe, expect, it } from "vitest";
import { withRoundTrips } from "@/test/d1-round-trips";
import { MeetingJoin, type Meeting } from "@/lib/platform/contracts";
import { CALL_LIMIT_MINUTES, MAX_PEOPLE_PER_CALL, SEATS_KEPT_FOR_HOST } from "./rules";
import { MINUTE_MS } from "./clock";
import { member, meetingDatabase, PEOPLE, T0, type MeetingFixture } from "./test-support";

const NOT_FOUND = { error: { code: "not_found", message: "Not found." } };
const fixtures: MeetingFixture[] = [];
afterEach(() => fixtures.splice(0).forEach(({ database }) => database.close()));
function setup(...args: Parameters<typeof meetingDatabase>) {
  const s = meetingDatabase(...args);
  fixtures.push(s);
  return s;
}
const meetingOf = (body: Record<string, unknown>) => body as unknown as Meeting;
const joined = (body: Record<string, unknown>) => MeetingJoin.parse(body);
const session = (s: MeetingFixture, overrides: Record<string, unknown> = {}) => ({
  purpose: "SESSION", channelId: s.channel("cohort-04"), title: "Week 9: payments and retries", scheduledStartAt: T0, bookedMinutes: 60, ...overrides,
});

describe("meeting routes: who gets in", () => {
  it("answers the same 404 to everything while `meetings` is off, admins and the flag's own parents included", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    const id = s.meeting({ state: "LIVE" });
    const off = { env: { PLATFORM_FLAGS_OVERRIDE: undefined } };
    for (const [operation, options] of [
      ["getMeeting", { id }], ["joinMeeting", { id }], ["leaveMeeting", { id }], ["endMeeting", { id }],
      ["removeFromMeeting", { id, body: { userId: PEOPLE.otieno } }], ["createMeeting", { body: session(s) }],
    ] as const) {
      const response = await s.call(operation, { ...options, ...off });
      expect(response.status).toBe(404);
      expect(response.body).toEqual(NOT_FOUND);
    }
    // `channels` and `spaces` on, `meetings` off: still nothing.
    s.database.exec("UPDATE feature_flag SET audience = 'ALL' WHERE key <> 'meetings'");
    expect((await s.call("getMeeting", { id, ...off })).body).toEqual(NOT_FOUND);
    s.database.exec("UPDATE feature_flag SET audience = 'ALL'");
    expect((await s.call("getMeeting", { id, ...off })).status).toBe(200);
  });

  it("reads a STAFF audience from the roles table, never from locals.isAdmin", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    s.database.exec("UPDATE feature_flag SET audience = 'ALL'; UPDATE feature_flag SET audience = 'STAFF' WHERE key = 'meetings'");
    const id = s.meeting();
    const env = { PLATFORM_FLAGS_OVERRIDE: undefined };
    expect((await s.call("getMeeting", { id, env, locals: { isAdmin: true } })).body).toEqual(NOT_FOUND);
    expect((await s.call("getMeeting", { id, env, user: PEOPLE.amina, locals: { isAdmin: false } })).status).toBe(200);
  });

  it("answers 404 for a purpose whose own flag is off", async () => {
    const s = setup();
    s.database.exec("UPDATE feature_flag SET audience = 'ALL'; UPDATE feature_flag SET audience = 'OFF' WHERE key IN ('meeting_events', 'meeting_checkins')");
    const env = { PLATFORM_FLAGS_OVERRIDE: undefined };
    const event = s.meeting({ channelId: s.channel("introductions"), purpose: "EVENT", recordingPolicy: "NONE" });
    const call = s.meeting({ channelId: s.direct(), purpose: "CALL", recordingPolicy: "BOTH_AGREE" });
    for (const id of [event, call]) expect((await s.call("getMeeting", { id, env })).body).toEqual(NOT_FOUND);
    const created = await s.call("createMeeting", { env, user: PEOPLE.david, body: { ...session(s), purpose: "EVENT", channelId: s.channel("introductions"), record: false } });
    expect(created.body).toEqual(NOT_FOUND);
  });

  it("refuses signed-out callers, personal access tokens (admin ones too) and writes from anywhere else, with the same 404", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    const id = s.meeting();
    const token = { personalAccessToken: { id: "pat", scopes: ["admin:read", "admin:write", "channels:write"] } } as unknown as Partial<App.Locals>;
    const refusals = [
      await s.call("getMeeting", { id, user: null }),
      await s.call("getMeeting", { id, locals: token }),
      await s.call("joinMeeting", { id, locals: token }),
      await s.call("createMeeting", { body: session(s), locals: token }),
      await s.call("joinMeeting", { id, origin: "https://elsewhere.example" }),
      await s.call("endMeeting", { id, origin: null }),
      await s.call("createMeeting", { body: session(s), origin: "https://elsewhere.example" }),
    ];
    for (const { status, body } of refusals) expect({ status, body }).toEqual({ status: 404, body: NOT_FOUND });
    // A browser's GET carries no Origin.
    expect((await s.call("getMeeting", { id, origin: null })).status).toBe(200);
    expect(s.row(id).state).toBe("SCHEDULED");
  });

  it("answers 503 in production, where calls have no provider yet, and never pretends to connect", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    s.database.exec("UPDATE feature_flag SET audience = 'ALL'");
    const id = s.meeting();
    const response = await s.call("joinMeeting", { id, provider: undefined, env: { DEPLOYMENT_ENVIRONMENT: "production" } });
    expect(response.status).toBe(503);
    expect(s.row(id).state).toBe("SCHEDULED");
  });

  it("refuses a body naming a role, a seat, a preset or a provider id like a forged id", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting({ state: "LIVE" });
    for (const body of [{ role: "HOST" }, { preset: "host" }, { providerParticipantId: "p" }, { seat: "HELD" }]) {
      expect((await s.call("joinMeeting", { id, body })).body).toEqual(NOT_FOUND);
    }
    const faith = { user: PEOPLE.faith };
    for (const extra of [{ recordingPolicy: "NONE" }, { state: "LIVE" }, { limitMinutes: CALL_LIMIT_MINUTES * 2 }, { providerMeetingId: "m" }]) {
      expect((await s.call("createMeeting", { ...faith, body: session(s, extra) })).body).toEqual(NOT_FOUND);
    }
    expect((await s.call("removeFromMeeting", { ...faith, id, body: { userId: PEOPLE.otieno, role: "HOST" } })).body).toEqual(NOT_FOUND);
    expect(s.seats(id)).toEqual([]);
    // The member joins as a member, whatever they asked.
    expect(joined((await s.call("joinMeeting", { id })).body).meeting.you.role).toBe("MEMBER");
    // A bad value of a real field is a plain 400.
    expect((await s.call("createMeeting", { ...faith, body: session(s, { bookedMinutes: CALL_LIMIT_MINUTES + 1 }) })).status).toBe(400);
  });

  it("refuses ids from outside the caller's channels: another cohort's call or channel, a call from the wrong kind of channel", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const elsewhere = s.meeting({ channelId: s.channel("cohort-05"), state: "LIVE" });
    for (const operation of ["getMeeting", "joinMeeting", "leaveMeeting", "endMeeting"] as const) {
      expect((await s.call(operation, { id: elsewhere })).body).toEqual(NOT_FOUND);
    }
    expect((await s.call("getMeeting", { id: "no-such-meeting" })).body).toEqual(NOT_FOUND);
    const faith = { user: PEOPLE.faith };
    // Faith teaches cohort A, not B; and a session belongs only in a cohort channel.
    expect((await s.call("createMeeting", { ...faith, body: session(s, { channelId: s.channel("cohort-05") }) })).body).toEqual(NOT_FOUND);
    expect((await s.call("createMeeting", { ...faith, body: session(s, { channelId: s.channel("introductions") }) })).body).toEqual(NOT_FOUND);
    expect((await s.call("createMeeting", { ...faith, body: session(s, { channelId: "no-such-channel" }) })).body).toEqual(NOT_FOUND);
    // An event belongs only in a community channel; a member of cohort A doesn't host its sessions.
    expect((await s.call("createMeeting", { user: PEOPLE.david, body: { ...session(s), purpose: "EVENT", record: true } })).body).toEqual(NOT_FOUND);
    expect((await s.call("createMeeting", { body: session(s) })).body).toEqual(NOT_FOUND);
  });

  it("keeps admins out of a direct conversation's call, whatever their role", async () => {
    const s = setup();
    const id = s.meeting({ channelId: s.direct(), purpose: "CALL", recordingPolicy: "BOTH_AGREE", state: "LIVE" });
    for (const operation of ["getMeeting", "joinMeeting", "endMeeting"] as const) {
      expect((await s.call(operation, { id, user: PEOPLE.amina, locals: { isAdmin: true } })).body).toEqual(NOT_FOUND);
    }
    expect((await s.call("joinMeeting", { id })).status).toBe(200);
    expect((await s.call("removeFromMeeting", { id, user: PEOPLE.amina, body: { userId: PEOPLE.wanjiku } })).body).toEqual(NOT_FOUND);
    expect(s.seats(id).map(({ state }) => state)).toEqual(["HELD"]);
  });

  it("asks for the code of conduct before creating or joining, and shows the call meanwhile", async () => {
    const s = setup({ assignments: [{ programId: "cohort-a", name: "TA" }], conduct: false });
    const id = s.meeting();
    expect((await s.call("getMeeting", { id })).status).toBe(200);
    for (const response of [await s.call("joinMeeting", { id }), await s.call("createMeeting", { body: session(s) })]) {
      expect(response.status).toBe(403);
      expect((response.body.error as { code: string }).code).toBe("conduct_required");
    }
    expect(s.row(id).state).toBe("SCHEDULED");
    s.agree();
    expect((await s.call("joinMeeting", { id })).status).toBe(200);
  });
});

describe("meeting routes: creating and opening", () => {
  it("creates a cohort session tied to its cohort channel, recorded always, with the server's limit", async () => {
    const s = setup({ assignments: [{ programId: "cohort-a", name: "INSTRUCTOR" }] });
    const created = await s.call("createMeeting", { body: session(s) });
    expect(created.status).toBe(201);
    const meeting = meetingOf(created.body);
    expect(meeting).toMatchObject({
      channelId: s.channel("cohort-04"), purpose: "SESSION", state: "SCHEDULED", recordingPolicy: "ALWAYS",
      limitMinutes: CALL_LIMIT_MINUTES, you: { canJoin: true, canHost: true, seat: null, role: null },
    });
    expect(s.row(meeting.id)).toMatchObject({ createdBy: PEOPLE.wanjiku, providerMeetingId: null });
    // An event's host chooses whether it is recorded; a call between two people asks both.
    const event = await s.call("createMeeting", { user: PEOPLE.david, body: { ...session(s), purpose: "EVENT", channelId: s.channel("introductions"), record: true } });
    expect(meetingOf(event.body).recordingPolicy).toBe("HOST");
    const call = await s.call("createMeeting", { body: { ...session(s), purpose: "CALL", channelId: s.direct() } });
    expect(meetingOf(call.body)).toMatchObject({ recordingPolicy: "BOTH_AGREE", you: { canHost: true } });
    expect(s.provider.log).toEqual([]);
  });

  it("keeps members waiting until a host opens the room, and opens it once", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting();
    const early = await s.call("joinMeeting", { id });
    expect(early.status).toBe(409);
    expect(meetingOf((await s.call("getMeeting", { id })).body).you.canJoin).toBe(false);
    s.advance(1);
    const host = joined((await s.call("joinMeeting", { id, user: PEOPLE.faith })).body);
    expect(host.meeting).toMatchObject({ state: "LIVE", openedAt: s.now(), hardEndAt: s.now() + CALL_LIMIT_MINUTES * MINUTE_MS,
      you: { role: "HOST", seat: "HELD" } });
    expect(host.provider).toBe("fake");
    expect(joined((await s.call("joinMeeting", { id, user: PEOPLE.amina })).body).meeting.you.role).toBe("HOST");
    expect(s.provider.log.filter(({ operation }) => operation === "createMeeting")).toHaveLength(1);
    expect(joined((await s.call("joinMeeting", { id })).body).meeting.you.role).toBe("MEMBER");
  });

  it("answers the join with a token for this tab only, never stored by a cache", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting({ state: "LIVE" });
    const first = await s.call("joinMeeting", { id });
    expect(first.response.headers.get("Cache-Control")).toBe("no-store");
    const second = await s.call("joinMeeting", { id });
    const [one, two] = [joined(first.body).token, joined(second.body).token];
    expect(one).not.toBe(two);
    // The second tab replaced the first: one seat, one live token.
    expect(s.provider.liveToken(one)).toBe(false);
    expect(s.provider.liveToken(two)).toBe(true);
    expect(s.seats(id)).toHaveLength(1);
    expect(JSON.stringify(second.body)).not.toContain("fake-meeting-");
  });

  it("gives the seat back when the provider fails to add the person, and leaves an earlier tab in the call", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting({ state: "LIVE" });
    s.provider.failNext("addParticipant");
    expect((await s.call("joinMeeting", { id })).status).toBe(503);
    expect(s.seats(id).map(({ state }) => state)).toEqual(["RELEASED"]);
    const { token } = joined((await s.call("joinMeeting", { id })).body);
    // A second tab failing to join leaves the first in the call.
    s.provider.failNext("addParticipant");
    expect((await s.call("joinMeeting", { id })).status).toBe(503);
    expect(s.seats(id).map(({ state }) => state)).toEqual(["HELD"]);
    expect(s.provider.liveToken(token)).toBe(true);
  });
});

describe("meeting routes: seats", () => {
  /** A live session with `members` cohort A members, joining together over a D1 whose calls really interleave. */
  function crowd(members: number, { hostPresent = false } = {}) {
    const s = setup({ extra: members });
    const id = s.meeting({ state: "LIVE" });
    const env = { DB: withRoundTrips(s.d1) };
    const join = (user: string) => s.call("joinMeeting", { id, user, env });
    return { s, id, join, hostPresent };
  }

  it("gives 20 people joining at once exactly 15 seats, one of them the host's", async () => {
    const { s, id, join } = crowd(19);
    const people = [...Array.from({ length: 19 }, (_, i) => member(i + 1)), PEOPLE.faith];
    const results = await Promise.all(people.map(join));
    expect(results.filter(({ status }) => status === 200)).toHaveLength(MAX_PEOPLE_PER_CALL);
    expect(results.filter(({ status }) => status === 409).map(({ body }) => body)).toEqual(
      Array.from({ length: 20 - MAX_PEOPLE_PER_CALL }, () => ({ error: { code: "conflict", message: "This call is full." } })));
    const held = s.seats(id).filter(({ state }) => state === "HELD");
    expect(held).toHaveLength(MAX_PEOPLE_PER_CALL);
    expect(held.filter(({ role }) => role === "HOST").map(({ userId }) => userId)).toEqual([PEOPLE.faith]);
    const tokens = results.flatMap(({ status, body }) => status === 200 ? [joined(body).token] : []);
    expect(new Set(tokens).size).toBe(MAX_PEOPLE_PER_CALL);
    expect(tokens.every((token) => s.provider.liveToken(token))).toBe(true);
  });

  it("keeps the host's place while no host is in: 20 members get 14 seats, and the host still gets in", async () => {
    const { s, id, join } = crowd(20);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => join(member(i + 1))));
    expect(results.filter(({ status }) => status === 200)).toHaveLength(MAX_PEOPLE_PER_CALL - SEATS_KEPT_FOR_HOST);
    expect((await join(PEOPLE.otieno)).status).toBe(409);
    const host = await join(PEOPLE.faith);
    expect(joined(host.body).meeting).toMatchObject({ seatsHeld: MAX_PEOPLE_PER_CALL, you: { role: "HOST" } });
    // Full now for hosts too.
    expect((await join(PEOPLE.amina)).status).toBe(409);
    // A member leaving frees a place for a member, because a host is in.
    await s.call("leaveMeeting", { id, user: member(1) });
    expect((await join(PEOPLE.otieno)).status).toBe(200);
    expect(s.seats(id).filter(({ state }) => state === "HELD")).toHaveLength(MAX_PEOPLE_PER_CALL);
  });

  it("releases a seat on leave, and its token stops working", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting({ state: "LIVE" });
    const { token } = joined((await s.call("joinMeeting", { id })).body);
    const left = meetingOf((await s.call("leaveMeeting", { id })).body);
    expect(left).toMatchObject({ seatsHeld: 0, you: { seat: "RELEASED", canJoin: true } });
    expect(s.provider.liveToken(token)).toBe(false);
    expect(s.seats(id)).toEqual([{ userId: PEOPLE.wanjiku, role: "MEMBER", state: "RELEASED", providerParticipantId: null }]);
    // Leaving again changes nothing.
    expect((await s.call("leaveMeeting", { id })).status).toBe(200);
  });

  it("keeps a removed person out: their token dies at once and every way back in is the same 404", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting({ state: "LIVE" });
    await s.call("joinMeeting", { id, user: PEOPLE.faith });
    const { token } = joined((await s.call("joinMeeting", { id })).body);
    const removed = await s.call("removeFromMeeting", { id, user: PEOPLE.faith, body: { userId: PEOPLE.wanjiku } });
    expect(meetingOf(removed.body).seatsHeld).toBe(1);
    expect(s.provider.liveToken(token)).toBe(false);
    expect((await s.call("joinMeeting", { id })).body).toEqual(NOT_FOUND);
    expect((await s.call("joinMeeting", { id })).body).toEqual(NOT_FOUND);
    // They still see the call (it is in their channel), and that they can't join it.
    expect(meetingOf((await s.call("getMeeting", { id })).body).you).toEqual({ canJoin: false, canHost: false, seat: "REMOVED", role: "MEMBER" });
    // Leaving doesn't undo a removal; removing again changes nothing.
    await s.call("leaveMeeting", { id });
    expect((await s.call("removeFromMeeting", { id, user: PEOPLE.faith, body: { userId: PEOPLE.wanjiku } })).status).toBe(200);
    expect(s.seats(id).find(({ userId }) => userId === PEOPLE.wanjiku)?.state).toBe("REMOVED");
  });

  it("removes only members who were in the call, and only by a host", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting({ state: "LIVE" });
    await s.call("joinMeeting", { id, user: PEOPLE.faith });
    await s.call("joinMeeting", { id, user: PEOPLE.amina });
    await s.call("joinMeeting", { id, user: PEOPLE.otieno });
    const remove = (user: string, userId: string) => s.call("removeFromMeeting", { id, user, body: { userId } });
    // A member can't remove anyone; a host can't remove a host, themself, or someone never in the call.
    for (const [by, whom] of [
      [PEOPLE.otieno, PEOPLE.faith], [PEOPLE.wanjiku, PEOPLE.otieno], [PEOPLE.faith, PEOPLE.amina], [PEOPLE.faith, PEOPLE.faith],
      [PEOPLE.faith, PEOPLE.achieng], [PEOPLE.faith, PEOPLE.kevin],
    ]) expect((await remove(by, whom)).body).toEqual(NOT_FOUND);
    expect(s.seats(id).every(({ state }) => state === "HELD")).toBe(true);
    expect((await remove(PEOPLE.amina, PEOPLE.otieno)).status).toBe(200);
  });

  it("finishes a removal the provider failed, on the next try", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting({ state: "LIVE" });
    await s.call("joinMeeting", { id, user: PEOPLE.faith });
    const { token } = joined((await s.call("joinMeeting", { id })).body);
    s.provider.failNext("deleteParticipant");
    const remove = () => s.call("removeFromMeeting", { id, user: PEOPLE.faith, body: { userId: PEOPLE.wanjiku } });
    expect((await remove()).status).toBe(503);
    expect((await s.call("joinMeeting", { id })).body).toEqual(NOT_FOUND);
    expect(s.provider.liveToken(token)).toBe(true);
    expect((await remove()).status).toBe(200);
    expect(s.provider.liveToken(token)).toBe(false);
    expect(s.seats(id).find(({ userId }) => userId === PEOPLE.wanjiku)?.providerParticipantId).toBeNull();
  });

  it("deletes every seat when a host ends the call, so no record of who attended survives", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting({ state: "LIVE" });
    await s.call("joinMeeting", { id, user: PEOPLE.faith });
    const { token } = joined((await s.call("joinMeeting", { id })).body);
    await s.call("joinMeeting", { id, user: PEOPLE.otieno });
    await s.call("leaveMeeting", { id, user: PEOPLE.otieno });
    expect((await s.call("endMeeting", { id })).body).toEqual(NOT_FOUND);
    s.advance(30);
    const ended = meetingOf((await s.call("endMeeting", { id, user: PEOPLE.faith })).body);
    expect(ended).toMatchObject({ state: "ENDED", endReason: "HOST_ENDED", endedAt: s.now(), seatsHeld: 0, you: { canJoin: false, seat: null } });
    expect(s.seats(id)).toEqual([]);
    expect(s.provider.liveToken(token)).toBe(false);
    expect((await s.call("joinMeeting", { id })).status).toBe(409);
    // Ending again changes nothing.
    s.advance(1);
    expect(meetingOf((await s.call("endMeeting", { id, user: PEOPLE.faith })).body).endedAt).toBe(ended.endedAt);
  });

  it("cancels a call that never opened, for good", async () => {
    const s = setup({ assignments: [{ programId: "cohort-a", name: "TA" }] });
    const id = s.meeting();
    expect(meetingOf((await s.call("endMeeting", { id })).body).state).toBe("CANCELLED");
    expect((await s.call("joinMeeting", { id })).status).toBe(409);
    expect(meetingOf((await s.call("endMeeting", { id })).body).state).toBe("CANCELLED");
    expect(s.provider.log).toEqual([]);
  });
});

describe("meeting routes: round trips", () => {
  it("reads a scheduled call in two round trips, and a live one in three", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const { tracePerf } = await import("@/lib/observability/perf-trace");
    const db = withRoundTrips(s.d1);
    const scheduled = s.meeting();
    const live = s.meeting({ state: "LIVE" });
    const read = async (id: string) => (await tracePerf(db, () => s.call("getMeeting", { id, env: { DB: db } }))).summary.depth;
    expect(await read(scheduled)).toBe(2);
    expect(await read(live)).toBe(3);
  });
});
