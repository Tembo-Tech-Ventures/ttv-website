import { afterEach, describe, expect, it } from "vitest";
import { isAgentEnvironmentName } from "../../../scripts/cloudflare/agent-preview-auth.mjs";
import { ChannelError } from "@/lib/channels/errors";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { effective, type Flags } from "@/lib/platform/server/flags";
import { FlagKey } from "@/lib/platform/contracts";
import { joinMeeting, getMeeting, type Caller } from "./calls";
import { MINUTE_MS } from "./clock";
import { CALL_LIMIT_MINUTES } from "./rules";
import {
  createTestCall, TEST_CALL_DEFAULT_MINUTES, TEST_CALL_MAX_MINUTES, testCallPlaces, testCallsEnabled, type TestCallEnv,
} from "./test-calls";
import { meetingDatabase, PEOPLE, T0, type MeetingFixture } from "./test-support";

/*
 * Test calls (in-app calls T1) on SQLite with every migration and the fake provider: cohort A
 * ("Cohort 04", #cohort-04) with Faith its TA and Otieno a member; Amina an admin; David a mentor.
 */
const fixtures: MeetingFixture[] = [];
afterEach(() => fixtures.splice(0).forEach(({ database }) => database.close()));
function setup() {
  const s = meetingDatabase();
  fixtures.push(s);
  return s;
}
const ALL_ON = effective(Object.fromEntries(FlagKey.options.map((key) => [key, true])) as Flags);
async function caller(s: MeetingFixture, userId: string): Promise<Caller> {
  return { userId, capabilities: await capabilitiesFor(s.db, { id: userId }), flags: ALL_ON };
}
const ctx = (s: MeetingFixture) => ({ db: s.d1, provider: s.provider, now: s.now() });
const PREVIEW: TestCallEnv = { DEPLOYMENT_ENVIRONMENT: "agent-pr-435" };

describe("testCallsEnabled: where test calls exist", () => {
  it.each([
    ["production, whatever else is set", { DEPLOYMENT_ENVIRONMENT: "production", MEETINGS_TEST_CALLS: "on" }, true, false],
    ["production under another spelling", { DEPLOYMENT_ENVIRONMENT: " Production ", MEETINGS_TEST_CALLS: "on" }, true, false],
    ["astro dev", { DEPLOYMENT_ENVIRONMENT: "development" }, true, true],
    ["astro dev with no environment named", {}, true, true],
    ["an agent preview", { DEPLOYMENT_ENVIRONMENT: "agent-pr-435" }, false, true],
    ["staging, not switched on", { DEPLOYMENT_ENVIRONMENT: "staging" }, false, false],
    ["staging, switched on", { DEPLOYMENT_ENVIRONMENT: "staging", MEETINGS_TEST_CALLS: "on" }, false, true],
    ["staging, with anything but \"on\"", { DEPLOYMENT_ENVIRONMENT: "staging", MEETINGS_TEST_CALLS: "true" }, false, false],
    ["a build with no environment named", {}, false, false],
    ["another environment with the variable", { DEPLOYMENT_ENVIRONMENT: "demo", MEETINGS_TEST_CALLS: "on" }, false, false],
    ["a name that only starts like a preview", { DEPLOYMENT_ENVIRONMENT: "agent-" }, false, false],
  ] as const)("%s", (_, env: TestCallEnv, dev, enabled) => {
    expect(testCallsEnabled(env, { dev })).toBe(enabled);
  });

  it("knows an agent preview exactly as the deploy scripts do", () => {
    const names = ["agent-pr-435", "agent-a", "agent-", "agent-x-", `agent-${"a".repeat(34)}`, `agent-${"a".repeat(35)}`, "agent-A1", "staging"];
    expect(names.map((name) => [name, testCallsEnabled({ DEPLOYMENT_ENVIRONMENT: name }, { dev: false })]))
      .toEqual(names.map((name) => [name, isAgentEnvironmentName(name)]));
  });
});

describe("testCallPlaces", () => {
  it("offers a TA their cohort, an admin every cohort and the community channels, a member nothing", async () => {
    const s = setup();
    const places = async (userId: string, env: TestCallEnv = PREVIEW) => testCallPlaces(s.d1, await capabilitiesFor(s.db, { id: userId }), env);
    expect((await places(PEOPLE.faith)).map(({ purpose, label }) => [purpose, label])).toEqual([["SESSION", "Cohort 04: a session in #cohort-04"]]);
    const admin = await places(PEOPLE.amina);
    expect(admin.filter(({ purpose }) => purpose === "SESSION")).toHaveLength(2);
    expect(admin.filter(({ purpose }) => purpose === "EVENT").map(({ label }) => label)).toContain("Community: an event in #introductions");
    // A mentor moderates community channels, so may host an event there; never a cohort session outside their cohorts.
    expect((await places(PEOPLE.david)).every(({ purpose }) => purpose === "EVENT")).toBe(true);
    expect(await places(PEOPLE.otieno)).toEqual([]);
  });

  it("offers only the SAM personas' fictional cohorts on staging", async () => {
    const s = setup();
    const capabilities = await capabilitiesFor(s.db, { id: PEOPLE.amina });
    const staging = { DEPLOYMENT_ENVIRONMENT: "staging", MEETINGS_TEST_CALLS: "on" };
    expect((await testCallPlaces(s.d1, capabilities, staging)).filter(({ purpose }) => purpose === "SESSION")).toEqual([]);
    s.database.exec(`INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES
      ('ttv-sam-persona-cohort-current','Cohort 91 (fictional)','Test',(SELECT curriculumId FROM program LIMIT 1),0,4102444800)`);
    const sessions = (await testCallPlaces(s.d1, capabilities, staging)).filter(({ purpose }) => purpose === "SESSION");
    expect(sessions.map(({ label }) => label)).toEqual([expect.stringMatching(/^Cohort 91 \(fictional\): a session in #cohort-91$/)]);
  });
});

describe("createTestCall", () => {
  it("makes a session that starts now, with the caller as host, and ends its length after the room opens", async () => {
    const s = setup();
    const faith = await caller(s, PEOPLE.faith);
    const places = await testCallPlaces(s.d1, faith.capabilities, PREVIEW);
    const { meeting, roomPath } = await createTestCall(ctx(s), faith, places,
      { channelId: places[0].channelId, title: "  Test   call ", minutes: TEST_CALL_DEFAULT_MINUTES });
    expect(roomPath).toBe(`/dashboard/calls/${meeting.id}`);
    expect(meeting).toMatchObject({
      purpose: "SESSION", title: "Test call", scheduledStartAt: T0, bookedMinutes: 2, limitMinutes: 2, state: "SCHEDULED", recordingPolicy: "ALWAYS",
      you: { canJoin: true, canHost: true },
    });

    // The host opens the room; two minutes later the clock ends it at its limit.
    const opened = await joinMeeting(ctx(s), faith, meeting.id);
    expect(opened.meeting).toMatchObject({ state: "LIVE", hardEndAt: T0 + 2 * MINUTE_MS });
    s.advance(1);
    expect((await getMeeting(ctx(s), faith, meeting.id)).state).toBe("LIVE");
    s.advance(1);
    expect(await getMeeting(ctx(s), faith, meeting.id)).toMatchObject({ state: "ENDED", endReason: "LIMIT" });
  });

  it("makes an unrecorded event in a community channel for a moderator", async () => {
    const s = setup();
    const david = await caller(s, PEOPLE.david);
    const places = await testCallPlaces(s.d1, david.capabilities, PREVIEW);
    const { meeting } = await createTestCall(ctx(s), david, places, { channelId: s.channel("introductions"), title: "", minutes: 5 });
    expect(meeting).toMatchObject({ purpose: "EVENT", title: "Test call", recordingPolicy: "NONE", limitMinutes: 5 });
  });

  it("refuses a place the caller doesn't host as the same 404, and a length outside 1 to the call limit", async () => {
    const s = setup();
    const faith = await caller(s, PEOPLE.faith);
    const places = await testCallPlaces(s.d1, faith.capabilities, PREVIEW);
    const attempt = (channelId: string, minutes: number, title = "Test call") => createTestCall(ctx(s), faith, places, { channelId, title, minutes });
    await expect(attempt(s.channel("introductions"), 2)).rejects.toMatchObject({ status: 404 });
    for (const minutes of [0, 1.5, TEST_CALL_MAX_MINUTES + 1, Number.NaN]) {
      await expect(attempt(places[0].channelId, minutes)).rejects.toMatchObject({ code: "validation", status: 400 });
    }
    await expect(attempt(places[0].channelId, 2, "x".repeat(121))).rejects.toBeInstanceOf(ChannelError);
    expect(TEST_CALL_MAX_MINUTES).toBe(CALL_LIMIT_MINUTES);
    expect(s.database.prepare("SELECT count(*) AS n FROM meeting").get()).toEqual({ n: 0 });
  });

  it("still needs the host's agreement to the code of conduct", async () => {
    const s = setup();
    s.database.exec(`DELETE FROM channel_conduct WHERE userId = '${PEOPLE.faith}'`);
    const faith = await caller(s, PEOPLE.faith);
    const places = await testCallPlaces(s.d1, faith.capabilities, PREVIEW);
    await expect(createTestCall(ctx(s), faith, places, { channelId: places[0].channelId, title: "Test call", minutes: 2 }))
      .rejects.toMatchObject({ code: "conduct_required", status: 403 });
  });
});
