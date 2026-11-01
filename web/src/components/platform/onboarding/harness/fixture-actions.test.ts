import { beforeEach, describe, expect, it } from "vitest";
import { onboardingByPersona } from "@/lib/platform/fixtures";
import { fixtureActions, isHarnessFailure, isOnboardingPersona, resetHarnessState } from "./fixture-actions";

const MENTOR = { role: "MENTOR", note: "Backend and data work: SQL, APIs and tests.", link: null } as const;

beforeEach(() => resetHarnessState());

describe("the onboarding harness's fixture actions", () => {
  it("starts each persona from its fixture", async () => {
    expect(await fixtureActions("peter").load()).toEqual(onboardingByPersona.peter);
  });

  it("saves intents and finishes the step, granting nothing", async () => {
    const state = await fixtureActions("wairimu").saveIntents(["MEMBER", "MENTOR"]);
    expect(state).toMatchObject({ stage: "DONE", intents: ["MEMBER", "MENTOR"], roles: [] });
    expect(await fixtureActions("wairimu").load()).toEqual(state);
  });

  it("answers a request as Pending, replacing the earlier one for that role", async () => {
    const state = await fixtureActions("peter").requestAccess(MENTOR);
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]).toMatchObject({ role: "MENTOR", status: "PENDING", note: MENTOR.note, decidedAt: null });
    expect(state.roles).toEqual([]);
  });

  it("refuses writes on cue, the way the routes do", async () => {
    await expect(fixtureActions("wairimu", "save").saveIntents(["MEMBER"])).rejects.toMatchObject({ status: 503 });
    await expect(fixtureActions("peter", "rate").requestAccess(MENTOR)).rejects.toMatchObject({ status: 429 });
    expect((await fixtureActions("peter").load()).requests[0]?.status).toBe("DECLINED");
  });

  it("records a conflicting request as sent before answering 409", async () => {
    await expect(fixtureActions("peter", "conflict").requestAccess(MENTOR)).rejects.toMatchObject({ status: 409 });
    expect((await fixtureActions("peter").load()).requests[0]?.status).toBe("PENDING");
  });

  it("forgets one persona or all of them", async () => {
    await fixtureActions("wairimu").saveIntents(["MEMBER"]);
    await fixtureActions("peter").saveIntents(["MEMBER"]);
    resetHarnessState("wairimu");
    expect((await fixtureActions("wairimu").load()).stage).toBe("NEW");
    expect((await fixtureActions("peter").load()).intents).toEqual(["MEMBER"]);
  });

  it("knows its personas and failures", () => {
    expect(["wairimu", "amina", null].map(isOnboardingPersona)).toEqual([true, false, false]);
    expect(["rate", "save", "conflict", "slow"].map(isHarnessFailure)).toEqual([true, true, true, false]);
  });
});
