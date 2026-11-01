import { describe, expect, it } from "vitest";
import { OnboardingState } from "../contracts";
import { onboardingByPersona } from "../fixtures";
import { accessStatus, createOnboardingStore } from "./onboarding";
import { createOnboardingMock, MOCK_DAILY_REQUEST_LIMIT } from "./onboarding.mock";

const note = "I review Flutter apps and can look at shared mobile work.";
const institution = { note: "We look for junior mobile developers.", organisation: "Mto Labs", scopeAcknowledged: true };

describe("onboarding mock mode", () => {
  it("serves each persona's fixture and never shares state between mocks", async () => {
    for (const [persona, state] of Object.entries(onboardingByPersona)) {
      const mock = createOnboardingMock(persona as keyof typeof onboardingByPersona);
      const store = createOnboardingStore({ enabled: true, mock: mock.api });
      expect(await store.refresh()).toBe(true);
      expect(store.getState().server).toEqual(state);
    }
    expect(createOnboardingMock().state()).toEqual(onboardingByPersona.wairimu);
  });

  it("runs the whole welcome flow: member + mentor, request, approval and dismissal", async () => {
    const mock = createOnboardingMock("wairimu");
    const store = createOnboardingStore({ enabled: true, mock: mock.api, initialState: mock.state() });
    store.select({ type: "toggle", intent: "MEMBER" });
    store.select({ type: "toggle", intent: "MENTOR" });
    expect(await store.saveIntents()).toBe(true);
    expect(mock.state()).toMatchObject({ stage: "DONE", intents: ["MEMBER", "MENTOR"] });
    store.updateDraft("MENTOR", { note, link: "https://example.com/synthetic/wairimu" });
    expect(await store.submitRequest("MENTOR")).toBe(true);
    expect(accessStatus(store.getState().server, "MENTOR")).toBe("PENDING");
    mock.decide("MENTOR", "approve");
    expect(await store.refresh()).toBe(true);
    expect(accessStatus(store.getState().server, "MENTOR")).toBe("APPROVED");
    expect(await store.dismissRequest("MENTOR")).toBe(true);
    expect(accessStatus(store.getState().server, "MENTOR")).toBe("ACTIVE");
    expect(OnboardingState.safeParse(mock.state()).success).toBe(true);
  });

  it("an institution request with a decline and message, then a new request", async () => {
    const mock = createOnboardingMock("wairimu");
    const store = createOnboardingStore({ enabled: true, mock: mock.api, initialState: mock.state() });
    store.updateDraft("INSTITUTION", institution);
    expect(await store.submitRequest("INSTITUTION")).toBe(true);
    expect(mock.state().intents).toEqual(["INSTITUTION"]);
    mock.decide("INSTITUTION", "decline", "Not this time.");
    await store.refresh();
    expect(store.getState().server?.requests[0]).toMatchObject({ status: "DECLINED", decisionMessage: "Not this time." });
    store.updateDraft("INSTITUTION", institution);
    expect(await store.submitRequest("INSTITUTION")).toBe(true);
    expect(accessStatus(store.getState().server, "INSTITUTION")).toBe("PENDING");
    expect(() => mock.decide("MENTOR", "approve")).toThrow(/No pending MENTOR/);
  });

  it("withdraw removes the intent; exploring and dismissPrompt follow SPEC rules", async () => {
    const mock = createOnboardingMock("mercyAkinyi");
    const store = createOnboardingStore({ enabled: true, mock: mock.api, initialState: mock.state() });
    expect(await store.withdrawRequest("MENTOR")).toBe(true);
    expect(mock.state()).toMatchObject({ intents: ["MEMBER"], requests: [{ status: "WITHDRAWN" }] });
    store.select({ type: "explore" });
    expect(await store.saveIntents()).toBe(true);
    expect(mock.state().intents).toEqual(["EXPLORING"]);
    store.updateDraft("MENTOR", { note });
    expect(await store.submitRequest("MENTOR")).toBe(true);
    expect(mock.state().intents).toEqual(["MENTOR"]);
    expect(await store.dismissPrompt()).toBe(true);
    expect(mock.state()).toMatchObject({ stage: "DONE", intents: ["MENTOR"] });
  });

  it("a withdraw that empties a completed onboarding leaves EXPLORING, as B-O.2 does", async () => {
    const mock = createOnboardingMock("josephOchieng");
    const store = createOnboardingStore({ enabled: true, mock: mock.api, initialState: mock.state() });
    expect(await store.withdrawRequest("INSTITUTION")).toBe(true);
    expect(mock.state().intents).toEqual(["EXPLORING"]);
    expect(store.getState().selection.intents).toEqual(["EXPLORING"]);
  });

  it("answers an unknown id with 404 not_found and a wrong state with 409; the store settles both from truth", async () => {
    const mock = createOnboardingMock("wairimu");
    const declined = createOnboardingStore({ enabled: true, mock: mock.api, initialState: onboardingByPersona.peter });
    // The server has no such request, so there is no card left to dismiss: settled by truth, still open.
    expect(await declined.dismissRequest("MENTOR")).toBe(true);
    expect(declined.getState()).toMatchObject({ closed: null, failure: null, server: onboardingByPersona.wairimu });
    const withdrawing = createOnboardingStore({ enabled: true, mock: mock.api, initialState: onboardingByPersona.mercyAkinyi });
    expect(await withdrawing.withdrawRequest("MENTOR")).toBe(true); // Gone on the server: nothing left pending.
    expect(withdrawing.getState()).toMatchObject({ closed: null, failure: null, server: onboardingByPersona.wairimu });
    const pending = createOnboardingMock("mercyAkinyi");
    const early = createOnboardingStore({
      enabled: true, mock: pending.api,
      initialState: { ...onboardingByPersona.mercyAkinyi, requests: [{ ...onboardingByPersona.peter.requests[0], id: onboardingByPersona.mercyAkinyi.requests[0].id }] },
    });
    expect(await early.dismissRequest("MENTOR")).toBe(false);
    expect(early.getState().failure).toMatchObject({ kind: "conflict", error: { status: 409 } });
    pending.decide("MENTOR", "approve");
    const racing = createOnboardingStore({ enabled: true, mock: pending.api, initialState: onboardingByPersona.mercyAkinyi });
    expect(await racing.withdrawRequest("MENTOR")).toBe(false); // Approved first: the approval is shown, not a withdrawal.
    expect(racing.getState().failure).toMatchObject({ kind: "conflict", error: { status: 409 } });
    expect(accessStatus(racing.getState().server, "MENTOR")).toBe("APPROVED");
  });

  it("answers conflicts with 409, as the server would", async () => {
    const mock = createOnboardingMock("mercyAkinyi");
    const stale = createOnboardingStore({ enabled: true, mock: mock.api, initialState: onboardingByPersona.wairimu });
    stale.updateDraft("MENTOR", { note });
    // The stale page thinks nothing is pending; the server says otherwise, and the store settles on that.
    expect(await stale.submitRequest("MENTOR")).toBe(true);
    expect(stale.getState().server?.requests[0].id).toBe(onboardingByPersona.mercyAkinyi.requests[0].id);
    const peter = createOnboardingMock("peter");
    const store = createOnboardingStore({ enabled: true, mock: peter.api, initialState: onboardingByPersona.mercyAkinyi });
    expect(await store.withdrawRequest("MENTOR")).toBe(false);
    expect(store.getState().failure).toMatchObject({ kind: "conflict" });
    const pending = createOnboardingStore({ enabled: true, mock: peter.api, initialState: onboardingByPersona.peter });
    pending.updateDraft("MENTOR", { note });
    await pending.submitRequest("MENTOR");
    const dismissStale = createOnboardingStore({ enabled: true, mock: peter.api, initialState: onboardingByPersona.peter });
    expect(await dismissStale.dismissRequest("MENTOR")).toBe(true); // 409 from the server, then settled by truth.
  });

  it("enforces the daily request limit with a 429 and a cooldown", async () => {
    const mock = createOnboardingMock("wairimu");
    const store = createOnboardingStore({ enabled: true, mock: mock.api, initialState: mock.state() });
    for (let i = 0; i < MOCK_DAILY_REQUEST_LIMIT; i++) {
      store.updateDraft("MENTOR", { note });
      expect(await store.submitRequest("MENTOR")).toBe(true);
      expect(await store.withdrawRequest("MENTOR")).toBe(true);
    }
    store.updateDraft("MENTOR", { note });
    expect(await store.submitRequest("MENTOR")).toBe(false);
    expect(store.getState().failure).toMatchObject({ kind: "rate_limited", retryAfterMs: 3_600_000 });
  });

  it("passes failure injection through for harnesses", async () => {
    const mock = createOnboardingMock("wairimu", { failure: () => new TypeError("offline") });
    const store = createOnboardingStore({ enabled: true, mock: mock.api });
    expect(await store.refresh()).toBe(false);
    expect(store.getState().loadError).toMatchObject({ code: "network_error" });
  });
});
