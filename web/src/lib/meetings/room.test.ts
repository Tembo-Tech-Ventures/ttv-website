import type { APIContext } from "astro";
import { afterEach, describe, expect, it } from "vitest";
import { ORIGIN, VIEWER } from "@/lib/channels/test-support";
import type { FakePresence } from "./fake-presence";
import { fakePresenceRequest } from "./http";
import { FakeCallProvider, type CallProvider } from "./provider";
import { resolveCallRoom } from "./room";
import type { CallRoomProps } from "./room-model";
import { meetingDatabase, PEOPLE, T0, type MeetingFixture } from "./test-support";

const fixtures: MeetingFixture[] = [];
afterEach(() => fixtures.splice(0).forEach(({ database }) => database.close()));
function setup(...args: Parameters<typeof meetingDatabase>) {
  const s = meetingDatabase(...args);
  fixtures.push(s);
  return s;
}

const NOT_FOUND = { error: { code: "not_found", message: "Not found." } };

/** GET /api/meetings/:id/presence as `user`, with the fixture's clock and provider unless told. */
async function presence(s: MeetingFixture, id: string, { user = VIEWER, provider, locals = {}, env = {} }: {
  user?: string | null; provider?: CallProvider | null; locals?: Partial<App.Locals>; env?: Record<string, unknown>;
} = {}) {
  const request = new Request(`${ORIGIN}/api/meetings/${id}/presence`);
  const context = {
    request, params: { id },
    locals: { user: user === null ? null : { id: user }, personalAccessToken: null, ...locals } as App.Locals,
  } as Pick<APIContext, "request" | "locals" | "params">;
  const response = await fakePresenceRequest(context, { DB: s.d1, PLATFORM_FLAGS_OVERRIDE: "all", ...env } as never, {
    now: s.now, provider: provider === undefined ? s.provider : provider,
  });
  return { status: response.status, body: await response.json() as FakePresence & Record<string, unknown>, cache: response.headers.get("cache-control") };
}

describe("GET /api/meetings/:id/presence (the fake room client's view of who is in)", () => {
  it("lists who holds a seat, by name, with the caller's own seat and the recording a provider would report", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    const id = s.meeting();
    expect((await s.call("joinMeeting", { id })).status).toBe(200);
    expect((await s.call("joinMeeting", { id, user: PEOPLE.otieno })).status).toBe(200);
    const answer = await presence(s, id);
    expect(answer.status).toBe(200);
    expect(answer.cache).toContain("no-store");
    expect(answer.body).toEqual({
      state: "LIVE", you: "HELD", recording: "recording",
      // In the order they took their seats; at the same moment, by id.
      people: [{ userId: PEOPLE.otieno, name: expect.any(String) }, { userId: VIEWER, name: expect.any(String) }],
    });
  });

  it("tells a removed person they were removed, and drops them from the list", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    const id = s.meeting();
    await s.call("joinMeeting", { id });
    await s.call("joinMeeting", { id, user: PEOPLE.otieno });
    expect((await s.call("removeFromMeeting", { id, body: { userId: PEOPLE.otieno } })).status).toBe(200);
    const removed = await presence(s, id, { user: PEOPLE.otieno });
    expect(removed.body.you).toBe("REMOVED");
    expect(removed.body.people.map(({ userId }) => userId)).toEqual([VIEWER]);
  });

  it("says the call ended once it has, at its limit", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    const id = s.meeting();
    await s.call("joinMeeting", { id });
    s.advance(91);
    const answer = await presence(s, id);
    expect(answer.body).toEqual({ state: "ENDED", you: null, recording: "off", people: [] });
  });

  it("reports the recording row's state when a recording exists", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    const id = s.meeting();
    await s.call("joinMeeting", { id });
    s.database.prepare("INSERT INTO meeting_recording (id, meetingId, state, createdAt, updatedAt) VALUES ('r', ?, 'FAILED', 0, 0)").run(id);
    expect((await presence(s, id)).body.recording).toBe("failed");
  });

  it("is the same 404 to anyone without a seat in a live call, to everyone off the fake provider, and with the flag off", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    const id = s.meeting();
    await s.call("joinMeeting", { id });
    const realish: CallProvider = Object.assign(Object.create(FakeCallProvider.prototype) as CallProvider, { kind: "realtimekit" as const });
    const token = { personalAccessToken: { id: "pat", scopes: ["channels:read"] } } as unknown as Partial<App.Locals>;
    for (const refused of [
      await presence(s, id, { user: PEOPLE.otieno }),
      await presence(s, id, { user: PEOPLE.kevin }),
      await presence(s, id, { user: null }),
      await presence(s, id, { locals: token }),
      await presence(s, id, { provider: null }),
      await presence(s, id, { provider: realish }),
      await presence(s, id, { env: { PLATFORM_FLAGS_OVERRIDE: undefined } }),
      await presence(s, "no-such-call"),
    ]) expect({ status: refused.status, body: refused.body }).toEqual({ status: 404, body: NOT_FOUND });
  });
});

/** The call room page's server side, as `user`. */
function room(s: MeetingFixture, id: string, { user = VIEWER, name = "Wanjiku Njeri", locals = {}, env = {} }: {
  user?: string | null; name?: string; locals?: Partial<App.Locals>; env?: Record<string, unknown>;
} = {}) {
  const astro = {
    params: { id },
    locals: { user: user === null ? null : { id: user, name, image: null }, personalAccessToken: null, ...locals } as App.Locals,
  };
  return resolveCallRoom(astro, { DB: s.d1, PLATFORM_FLAGS_OVERRIDE: "all", ...env } as never, s.now());
}

describe("the call room page (resolveCallRoom)", () => {
  it("gives a cohort member the call, its hosts, the cohort, the chat and the way back", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting();
    const props = await room(s, id) as CallRoomProps;
    expect(props).toMatchObject({
      self: { userId: VIEWER, name: "Wanjiku Njeri", image: null },
      cohortName: expect.any(String),
      chat: { href: expect.stringMatching(/^\/dashboard\/cohort\/c\/cohort-04$/), place: "#cohort-04" },
      back: { href: "/dashboard/cohort/sessions", label: "Back to Sessions" },
      recordingRefused: false, conductAgreed: true, conductHref: "/dashboard/community/conduct", unavailable: false, renderedAt: T0,
    });
    expect(props.meeting).toMatchObject({ id, state: "SCHEDULED", you: { canJoin: false, canHost: false, seat: null } });
    // The cohort's TA and the admin host it; members, alumni and invited mentors don't.
    expect(props.hostIds).toContain(PEOPLE.faith);
    expect(props.hostIds).toContain(PEOPLE.amina);
    expect(props.hostIds).not.toContain(PEOPLE.otieno);
    expect(props.hostIds).not.toContain(PEOPLE.joseph);
    expect(props.hostIds).not.toContain(PEOPLE.david);
  });

  it("links the chat to the call's thread once its card exists", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting();
    s.database.exec(`INSERT INTO channel_message(id,channelId,seq,changeSeq,authorId,body) VALUES ('card','${s.channel("cohort-04")}',1,1,'${PEOPLE.faith}','Session card');
      UPDATE meeting SET messageId = 'card' WHERE id = '${id}'`);
    expect(((await room(s, id)) as CallRoomProps).chat.href).toBe("/dashboard/cohort/c/cohort-04?thread=card");
  });

  it("hosts a conversation's call between its two members, and an event between the community channel's moderators", async () => {
    const s = setup();
    const call = s.meeting({ channelId: s.direct(), purpose: "CALL", recordingPolicy: "BOTH_AGREE" });
    const props = await room(s, call) as CallRoomProps;
    expect(props.hostIds.toSorted()).toEqual([VIEWER, PEOPLE.otieno].toSorted());
    expect(props).toMatchObject({ cohortName: null, back: { label: "Back to the conversation" }, chat: { place: "your conversation" } });
    const event = s.meeting({ channelId: s.channel("introductions"), purpose: "EVENT", recordingPolicy: "NONE" });
    const hosts = ((await room(s, event)) as CallRoomProps).hostIds;
    expect(hosts).toContain(PEOPLE.amina);
    expect(hosts).toContain(PEOPLE.david);
    expect(hosts).not.toContain(VIEWER);
  });

  it("says when the month's recording limit stopped the recording, and when the person hasn't agreed to the code of conduct", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }], conduct: false });
    const id = s.meeting();
    s.database.prepare("INSERT INTO meeting_recording (id, meetingId, state, createdAt, updatedAt) VALUES ('r', ?, 'REFUSED', 0, 0)").run(id);
    expect(await room(s, id)).toMatchObject({ recordingRefused: true, conductAgreed: false });
  });

  it("brings a live call up to date first: one past its limit shows as ended", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    const id = s.meeting();
    await s.call("joinMeeting", { id });
    s.advance(95);
    const props = await room(s, id) as CallRoomProps;
    expect(props.meeting).toMatchObject({ state: "ENDED", endReason: "LIMIT" });
  });

  it("has no Join in production until the real provider arrives", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting();
    expect(await room(s, id, { env: { DEPLOYMENT_ENVIRONMENT: "production", PLATFORM_FLAGS_OVERRIDE: undefined } })).toBeInstanceOf(Response);
    s.database.exec("UPDATE feature_flag SET audience = 'ALL'");
    expect(await room(s, id, { env: { DEPLOYMENT_ENVIRONMENT: "production", PLATFORM_FLAGS_OVERRIDE: undefined } })).toMatchObject({ unavailable: true });
  });

  it("is the same 404 for anyone the call isn't for, whatever the reason", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.meeting();
    const direct = s.meeting({ channelId: s.direct([PEOPLE.otieno, PEOPLE.achieng]), purpose: "CALL", recordingPolicy: "BOTH_AGREE" });
    const token = { personalAccessToken: { id: "pat", scopes: ["channels:read"] } } as unknown as Partial<App.Locals>;
    for (const refused of [
      await room(s, id, { user: null }),
      await room(s, id, { locals: token }),
      await room(s, id, { user: PEOPLE.kevin }),
      await room(s, id, { user: PEOPLE.amani }),
      await room(s, id, { env: { PLATFORM_FLAGS_OVERRIDE: undefined } }),
      await room(s, direct),
      await room(s, direct, { user: PEOPLE.amina }),
      await room(s, "no-such-call"),
    ]) {
      expect(refused).toBeInstanceOf(Response);
      expect((refused as Response).status).toBe(404);
      expect(await (refused as Response).text()).toBe("Not found");
    }
  });
});
