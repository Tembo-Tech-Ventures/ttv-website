// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessRequestSummary, Intent, OnboardingState } from "../contracts";
import { accessRequests, onboardingByPersona } from "../fixtures";
import { createApiClient, type ApiClient } from "./apiClient";
import { createMockTransport, type MockReply } from "./mockTransport";
import { onboardingDraftKey, type DraftStorage } from "./onboarding-drafts";
import { accessStatus, createOnboardingStore, selectAccessStatus, type OnboardingOptions } from "./onboarding";

type Reply = MockReply | Promise<MockReply>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const tick = () => new Promise(resolve => { setTimeout(resolve, 0); });
const ok = (data: OnboardingState): MockReply => ({ data });
const fail = (status: number, code: string, retryAfterMs?: number): MockReply =>
  ({ status, data: { error: { code, message: code, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) } } });

const NOW = 1_793_500_000_000;
const { wairimu, mercyAkinyi: mercy, peter } = onboardingByPersona;
const mentorNote = "I build Flutter apps at work and can review mobile projects.";
const pendingMentor: AccessRequestSummary = { ...accessRequests.mercyMentor, id: "req-new", note: mentorNote, link: null };
const wairimuPending: OnboardingState = { ...wairimu, stage: "DONE", intents: ["MEMBER", "MENTOR"], requests: [pendingMentor] };
const mercyWithdrawn: OnboardingState = {
  ...mercy, intents: ["MEMBER"], requests: [{ ...accessRequests.mercyMentor, status: "WITHDRAWN", updatedAt: NOW }],
};
const mercyApproved: OnboardingState = {
  ...mercy, roles: ["MENTOR"],
  requests: [{ ...accessRequests.mercyMentor, status: "APPROVED", decidedAt: NOW, updatedAt: NOW }],
};

function memoryStorage(entries: Record<string, string> = {}): DraftStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() { return map.size; },
    key: index => [...map.keys()][index] ?? null,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: key => { map.delete(key); },
  };
}

function harness(server: OnboardingState | null = wairimu, options: OnboardingOptions = {}) {
  const get = vi.fn<() => Reply>(() => ok(server ?? wairimu));
  const put = vi.fn<(request: Request) => Reply>(() => ok(server ?? wairimu));
  const create = vi.fn<(request: Request) => Reply>(() => ok(wairimuPending));
  const withdraw = vi.fn<(id: string) => Reply>(() => ok(mercyWithdrawn));
  const dismiss = vi.fn<(id: string) => Reply>(() => ok(server ?? wairimu));
  const transport = createMockTransport([
    { method: "GET", path: "/api/platform/onboarding", reply: () => get() },
    { method: "PUT", path: "/api/platform/onboarding", reply: ({ request }) => put(request) },
    { method: "POST", path: "/api/platform/access-requests", reply: ({ request }) => create(request) },
    { method: "POST", path: "/api/platform/access-requests/:id/withdraw", reply: ({ params }) => withdraw(params.id) },
    { method: "POST", path: "/api/platform/access-requests/:id/dismiss", reply: ({ params }) => dismiss(params.id) },
  ]);
  const network = { offline: false, loseNextResponse: false };
  const signals: AbortSignal[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    if (init?.signal) signals.push(init.signal);
    if (network.offline) throw new TypeError("Failed to fetch");
    const response = await transport(input, init);
    if (network.loseNextResponse) {
      // The server processed the write, but the response never arrived.
      network.loseNextResponse = false;
      throw new TypeError("Network connection was lost");
    }
    return response;
  });
  const storage = memoryStorage();
  const store = createOnboardingStore({
    enabled: true, api: createApiClient({ fetch, retry: { maxRetries: 0 } }),
    ...(server ? { initialState: server } : {}), draftKey: onboardingDraftKey("synthetic-user"), storage: () => storage,
    ...options,
  });
  const writes = () => fetch.mock.calls.filter(([, init]) => init?.method !== "GET").length;
  const reads = () => fetch.mock.calls.filter(([, init]) => init?.method === "GET").length;
  return { store, get, put, create, withdraw, dismiss, fetch, network, storage, signals, writes, reads };
}

const draftKey = onboardingDraftKey("synthetic-user");
const fillMentorDraft = (store: ReturnType<typeof harness>["store"]) => store.updateDraft("MENTOR", { note: mentorNote });

describe("onboarding store", () => {
  beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); });
  afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); localStorage.clear(); });

  it("is OFF by default: no requests, no storage and no actions", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const storage = vi.fn(() => memoryStorage());
    const store = createOnboardingStore({ api: createApiClient({ fetch }), draftKey, storage });
    store.start();
    store.updateDraft("MENTOR", { note: mentorNote });
    store.discardDraft("MENTOR");
    expect(await store.refresh()).toBe(false);
    expect(await store.saveIntents()).toBe(false);
    expect(await store.dismissPrompt()).toBe(false);
    expect(await store.submitRequest("MENTOR")).toBe(false);
    expect(await store.withdrawRequest("MENTOR")).toBe(false);
    expect(await store.dismissRequest("MENTOR")).toBe(false);
    expect(await store.retry()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ enabled: false, server: null });
    expect(store.getState().drafts).toEqual({});
  });

  it("constructs without side effects and hydrates from server-rendered state", () => {
    const { store, fetch } = harness(mercy, { hint: "institution" });
    expect(fetch).not.toHaveBeenCalled();
    expect(store.getServerSnapshot().server).toEqual(mercy);
    expect(store.getState().selection).toEqual({ intents: ["MEMBER", "MENTOR", "INSTITUTION"], empty: false, dirty: true });
    store.start();
    expect(fetch).not.toHaveBeenCalled();
    expect(() => createOnboardingStore({ initialState: { ...mercy, intents: ["EXPLORING", "MEMBER"] } })).toThrow(/EXPLORING cannot be combined/);
  });

  it("loads state when the page supplied none, and prefills inferred intents", async () => {
    const { store, get } = harness(null);
    get.mockReturnValueOnce(ok({ ...wairimu, stage: "PROMPT", inferred: ["MENTOR"] }));
    store.start();
    expect(store.getState().loading).toBe(true);
    await tick();
    expect(store.getState()).toMatchObject({ loading: false, server: { stage: "PROMPT" }, selection: { intents: ["MENTOR"], dirty: false } });
  });

  it("reports a failed load, then recovers on refresh", async () => {
    const { store, get } = harness(null);
    get.mockReturnValueOnce(fail(500, "boom"));
    store.start();
    await tick();
    expect(store.getState()).toMatchObject({ server: null, loadError: { status: 500 }, announcement: "Couldn't load your onboarding choices." });
    expect(await store.refresh()).toBe(true);
    expect(store.getState()).toMatchObject({ server: wairimu, loadError: null });
  });

  describe("intents", () => {
    it("refuses to continue with nothing chosen and sends nothing", async () => {
      const { store, writes } = harness();
      expect(await store.saveIntents()).toBe(false);
      expect(store.getState().selection.empty).toBe(true);
      expect(writes()).toBe(0);
    });

    it("saves EXPLORING alone and reconciles with the server's answer", async () => {
      const { store, put } = harness();
      const exploring: OnboardingState = { ...wairimu, stage: "DONE", intents: ["EXPLORING"] };
      put.mockReturnValueOnce(ok(exploring));
      store.select({ type: "toggle", intent: "MEMBER" });
      store.select({ type: "toggle", intent: "MENTOR" });
      store.select({ type: "explore" });
      expect(await store.saveIntents()).toBe(true);
      expect(await put.mock.calls[0][0].json()).toEqual({ intents: ["EXPLORING"] });
      expect(store.getState()).toMatchObject({
        server: exploring, selection: { intents: ["EXPLORING"], dirty: false }, pending: null, announcement: "Saved.",
      });
    });

    it("sends exactly the selected combination", async () => {
      const { store, put } = harness();
      put.mockReturnValueOnce(ok({ ...wairimu, stage: "DONE", intents: ["MEMBER", "INSTITUTION"] }));
      store.select({ type: "toggle", intent: "INSTITUTION" });
      store.select({ type: "toggle", intent: "MEMBER" });
      expect(await store.saveIntents()).toBe(true);
      expect(await put.mock.calls[0][0].json()).toEqual({ intents: ["MEMBER", "INSTITUTION"] });
    });

    it("dismisses the one-time prompt", async () => {
      const { store, put } = harness({ ...wairimu, stage: "PROMPT" });
      put.mockReturnValueOnce(ok({ ...wairimu, stage: "DONE" }));
      expect(await store.dismissPrompt()).toBe(true);
      expect(await put.mock.calls[0][0].json()).toEqual({ dismissPrompt: true });
      expect(store.getState().server?.stage).toBe("DONE");
    });

    it("treats a server error as unknown, then settles from server truth", async () => {
      const { store, put, get } = harness();
      store.select({ type: "toggle", intent: "MEMBER" });
      put.mockReturnValueOnce(fail(503, "unavailable"));
      get.mockReturnValueOnce(ok({ ...wairimu, stage: "DONE", intents: ["MEMBER"] }));
      expect(await store.saveIntents()).toBe(true);
      expect(store.getState()).toMatchObject({ failure: null, server: { intents: ["MEMBER"] } });
      put.mockReturnValueOnce(fail(503, "unavailable"));
      store.select({ type: "toggle", intent: "MENTOR" });
      expect(await store.saveIntents()).toBe(false);
      expect(store.getState().failure).toMatchObject({ kind: "failed", action: { type: "save", intents: ["MEMBER", "MENTOR"] } });
    });

    it("matching intents are not 'Saved.' while the step is still open on the server", async () => {
      const prompt: OnboardingState = { ...wairimu, stage: "PROMPT", intents: ["MEMBER"] };
      const { store, put, get } = harness(prompt);
      put.mockReturnValueOnce(fail(503, "unavailable"));
      get.mockReturnValueOnce(ok(prompt));
      expect(await store.saveIntents()).toBe(false);
      expect(store.getState()).toMatchObject({ failure: { kind: "failed" }, server: { stage: "PROMPT" } });
      expect(store.getState().announcement).not.toBe("Saved.");
    });
  });

  describe("access requests", () => {
    it("shows Pending only after a 2xx: nothing optimistic, one write at a time", async () => {
      const { store, create, storage, writes } = harness();
      store.start();
      fillMentorDraft(store);
      expect(storage.map.get(draftKey)).toContain(mentorNote);
      const reply = deferred<MockReply>();
      create.mockReturnValueOnce(reply.promise);
      const sent = store.submitRequest("MENTOR");
      await tick();
      expect(store.getState().pending).toEqual({ type: "submit", role: "MENTOR" });
      expect(selectAccessStatus("MENTOR")(store.getState())).toBe("NOT_REQUESTED");
      expect(await store.submitRequest("MENTOR")).toBe(false);
      expect(await store.withdrawRequest("MENTOR")).toBe(false);
      expect(await store.refresh()).toBe(false);
      expect(writes()).toBe(1);
      reply.resolve(ok(wairimuPending));
      expect(await sent).toBe(true);
      expect(selectAccessStatus("MENTOR")(store.getState())).toBe("PENDING");
      expect(store.getState()).toMatchObject({
        pending: null, failure: null, announcement: "Your mentor request is with the team.",
        selection: { intents: ["MEMBER", "MENTOR"] },
      });
      expect(store.getState().drafts).toEqual({});
      expect(storage.map.has(draftKey)).toBe(false);
      expect(await create.mock.calls[0][0].json()).toEqual({ role: "MENTOR", note: mentorNote, link: null });
    });

    it("keeps the other role's draft after a send", async () => {
      const { store, storage } = harness();
      fillMentorDraft(store);
      store.updateDraft("INSTITUTION", { organisation: "Mto Labs" });
      expect(await store.submitRequest("MENTOR")).toBe(true);
      expect(store.getState().drafts).toEqual({ INSTITUTION: expect.objectContaining({ organisation: "Mto Labs" }) });
      expect(storage.map.get(draftKey)).toContain("Mto Labs");
    });

    it("validates the draft locally and never sends an invalid request", async () => {
      const { store, writes } = harness();
      store.updateDraft("INSTITUTION", { note: "short" });
      expect(await store.submitRequest("INSTITUTION")).toBe(false);
      expect(writes()).toBe(0);
      expect(store.getState().fieldErrors.INSTITUTION).toEqual({
        note: expect.any(String), organisation: expect.any(String), scopeAcknowledged: expect.any(String),
      });
      expect(store.getState().failure).toMatchObject({ kind: "invalid", action: { type: "submit", role: "INSTITUTION" } });
      store.updateDraft("INSTITUTION", { note: "We want to find junior developers.", organisation: "Mto Labs", scopeAcknowledged: true });
      expect(store.getState().fieldErrors.INSTITUTION).toBeUndefined();
      expect(await store.submitRequest("INSTITUTION")).toBe(true);
      expect(store.getState().fieldErrors).toEqual({});
    });

    it("does not offer a request the server already shows as pending or granted", async () => {
      for (const state of [mercy, mercyApproved, { ...mercyApproved, requests: [{ ...mercyApproved.requests[0], seenAt: NOW }] }]) {
        const { store, writes } = harness(state);
        fillMentorDraft(store);
        expect(await store.submitRequest("MENTOR")).toBe(false);
        expect(writes()).toBe(0);
      }
      const { store } = harness(peter);
      fillMentorDraft(store);
      expect(await store.submitRequest("MENTOR")).toBe(true); // A decline can be followed by a new request.
    });

    it("409: a request already pending elsewhere settles from truth, and this tab's text is kept", async () => {
      const { store, create, get, storage } = harness();
      fillMentorDraft(store);
      create.mockReturnValueOnce(fail(409, "conflict"));
      get.mockReturnValueOnce(ok(wairimuPending));
      expect(await store.submitRequest("MENTOR")).toBe(true);
      expect(accessStatus(store.getState().server, "MENTOR")).toBe("PENDING");
      expect(store.getState()).toMatchObject({
        failure: null, announcement: "Your mentor request is already with the team.",
      });
      expect(store.getState().drafts).toEqual({ MENTOR: { note: mentorNote, link: "" } });
      expect(storage.map.get(draftKey)).toContain(mentorNote);
    });

    it("409: access granted meanwhile settles quietly, with no request to announce", async () => {
      const { store, create, get } = harness();
      fillMentorDraft(store);
      create.mockReturnValueOnce(fail(409, "conflict"));
      get.mockReturnValueOnce(ok({ ...wairimu, roles: ["MENTOR"] }));
      expect(await store.submitRequest("MENTOR")).toBe(true);
      expect(store.getState()).toMatchObject({ failure: null, announcement: "" });
      expect(store.getState().drafts).toEqual({}); // The role is held: nothing is left to send the text to.
      expect(accessStatus(store.getState().server, "MENTOR")).toBe("ACTIVE");
    });

    it("409: an unresolved conflict shows the latest truth and keeps the draft", async () => {
      const { store, create, get } = harness();
      fillMentorDraft(store);
      create.mockReturnValueOnce(fail(409, "conflict"));
      get.mockReturnValueOnce(ok({ ...wairimu, stage: "DONE", intents: ["MEMBER"] }));
      expect(await store.submitRequest("MENTOR")).toBe(false);
      expect(store.getState()).toMatchObject({
        failure: { kind: "conflict", error: { status: 409 } }, server: { intents: ["MEMBER"] },
        drafts: { MENTOR: { note: mentorNote } }, announcement: "This changed since the page loaded. It now shows the latest.",
      });
      expect(accessStatus(store.getState().server, "MENTOR")).toBe("NOT_REQUESTED");
    });

    it("429: reports the cooldown, keeps the draft and shows no Pending", async () => {
      const { store, create, reads } = harness();
      fillMentorDraft(store);
      create.mockReturnValueOnce(fail(429, "rate_limited", 3_600_000));
      expect(await store.submitRequest("MENTOR")).toBe(false);
      expect(store.getState()).toMatchObject({
        failure: { kind: "rate_limited", retryAfterMs: 3_600_000 }, drafts: { MENTOR: { note: mentorNote } },
        announcement: "Too many requests for today. Try again later.",
      });
      expect(accessStatus(store.getState().server, "MENTOR")).toBe("NOT_REQUESTED");
      expect(reads()).toBe(0); // Nothing happened on the server, so there is nothing to reconcile.
      expect(create).toHaveBeenCalledTimes(1); // A create is never retried automatically.
    });

    it("offline: keeps the draft, shows no Pending, then retries once back online", async () => {
      const { store, network, create, storage } = harness();
      fillMentorDraft(store);
      network.offline = true;
      expect(await store.submitRequest("MENTOR")).toBe(false);
      expect(store.getState()).toMatchObject({
        failure: { kind: "offline", error: { code: "network_error" }, retryAfterMs: null }, pending: null,
        drafts: { MENTOR: { note: mentorNote } }, announcement: "Couldn't reach TTV. Check your connection and try again.",
      });
      expect(accessStatus(store.getState().server, "MENTOR")).toBe("NOT_REQUESTED");
      expect(create).not.toHaveBeenCalled();
      network.offline = false;
      expect(await store.retry()).toBe(true);
      expect(accessStatus(store.getState().server, "MENTOR")).toBe("PENDING");
      expect(storage.map.has(draftKey)).toBe(false);
    });

    it("a failed dismiss whose truth is still unseen keeps the card and offers a retry", async () => {
      const { store, dismiss, get } = harness(peter);
      dismiss.mockReturnValueOnce(fail(503, "unavailable"));
      get.mockReturnValueOnce(ok(peter));
      expect(await store.dismissRequest("MENTOR")).toBe(false);
      expect(store.getState().failure).toMatchObject({ kind: "failed", action: { type: "dismiss", role: "MENTOR" } });
      expect(store.getState().server?.requests[0].seenAt).toBeNull();
    });

    it("a lost response is resolved by asking the server, never by guessing", async () => {
      const { store, network, create, get } = harness();
      fillMentorDraft(store);
      network.loseNextResponse = true;
      get.mockReturnValueOnce(ok(wairimuPending));
      expect(await store.submitRequest("MENTOR")).toBe(true);
      expect(create).toHaveBeenCalledTimes(1);
      expect(accessStatus(store.getState().server, "MENTOR")).toBe("PENDING");
      expect(store.getState().drafts).toEqual({});
    });

    it("withdraw removes the request and its intent, keeping other local choices", async () => {
      const { store, withdraw } = harness(mercy);
      store.select({ type: "toggle", intent: "INSTITUTION" });
      expect(await store.withdrawRequest("MENTOR")).toBe(true);
      expect(withdraw).toHaveBeenCalledWith(accessRequests.mercyMentor.id);
      expect(store.getState()).toMatchObject({
        server: { intents: ["MEMBER"] }, selection: { intents: ["MEMBER", "INSTITUTION"], dirty: true }, announcement: "Request withdrawn.",
      });
      expect(accessStatus(store.getState().server, "MENTOR")).toBe("NOT_REQUESTED");
      expect(await store.withdrawRequest("MENTOR")).toBe(false);
    });

    it("withdraw racing an approval: 409 shows the approval, not a withdrawal", async () => {
      const { store, withdraw, get } = harness(mercy);
      withdraw.mockReturnValueOnce(fail(409, "conflict"));
      get.mockReturnValueOnce(ok(mercyApproved));
      expect(await store.withdrawRequest("MENTOR")).toBe(false);
      expect(store.getState().failure).toMatchObject({ kind: "conflict", action: { type: "withdraw", role: "MENTOR" } });
      expect(accessStatus(store.getState().server, "MENTOR")).toBe("APPROVED");
    });

    it("404 not_found on a write is a stale id, not a switched-off flag: it reconciles and stays open", async () => {
      const { store, withdraw, get } = harness(mercy);
      withdraw.mockReturnValueOnce(fail(404, "not_found"));
      get.mockReturnValueOnce(ok(mercyApproved));
      expect(await store.withdrawRequest("MENTOR")).toBe(false);
      expect(store.getState()).toMatchObject({ closed: null, failure: { kind: "conflict", error: { status: 404 } } });
      expect(accessStatus(store.getState().server, "MENTOR")).toBe("APPROVED");
    });

    it("404 flag_off on a write closes onboarding", async () => {
      const { store, create, reads } = harness();
      fillMentorDraft(store);
      create.mockReturnValueOnce(fail(404, "flag_off"));
      expect(await store.submitRequest("MENTOR")).toBe(false);
      expect(store.getState()).toMatchObject({ closed: "unavailable", failure: null, pending: null });
      expect(reads()).toBe(0);
    });

    it("withdraw already done in another tab settles as success", async () => {
      const { store, withdraw, get } = harness(mercy);
      withdraw.mockReturnValueOnce(fail(409, "conflict"));
      get.mockReturnValueOnce(ok(mercyWithdrawn));
      expect(await store.withdrawRequest("MENTOR")).toBe(true);
      expect(store.getState().failure).toBeNull();
    });

    it("dismisses a decided card once", async () => {
      const seen: OnboardingState = { ...peter, requests: [{ ...accessRequests.peterMentor, seenAt: NOW }] };
      const { store, dismiss } = harness(peter);
      dismiss.mockReturnValueOnce(ok(seen));
      expect(accessStatus(store.getState().server, "MENTOR")).toBe("DECLINED");
      expect(await store.dismissRequest("MENTOR")).toBe(true);
      expect(dismiss).toHaveBeenCalledWith(accessRequests.peterMentor.id);
      expect(store.getState().announcement).toBe("");
      expect(await store.dismissRequest("MENTOR")).toBe(false);
      expect(await harness(mercy).store.dismissRequest("MENTOR")).toBe(false);
      expect(await harness(wairimu).store.dismissRequest("MENTOR")).toBe(false);
    });

    it("retries each kind of failed action against current state", async () => {
      const { store, put, withdraw, network } = harness(mercy);
      network.offline = true;
      expect(await store.withdrawRequest("MENTOR")).toBe(false);
      network.offline = false;
      expect(await store.retry()).toBe(true);
      expect(withdraw).toHaveBeenCalledTimes(1);

      const declined = harness(peter);
      declined.network.offline = true;
      expect(await declined.store.dismissRequest("MENTOR")).toBe(false);
      declined.network.offline = false;
      expect(await declined.store.retry()).toBe(true);
      expect(declined.dismiss).toHaveBeenCalledTimes(1);

      network.offline = true;
      expect(await store.dismissPrompt()).toBe(false);
      network.offline = false;
      put.mockReturnValueOnce(ok({ ...mercyWithdrawn, stage: "DONE" }));
      expect(await store.retry()).toBe(true);

      network.offline = true;
      store.select({ type: "toggle", intent: "INSTITUTION" });
      expect(await store.saveIntents()).toBe(false);
      network.offline = false;
      put.mockReturnValueOnce(ok({ ...mercyWithdrawn, intents: ["MEMBER", "INSTITUTION"] }));
      expect(await store.retry()).toBe(true);
      expect(await put.mock.calls.at(-1)![0].json()).toEqual({ intents: ["MEMBER", "INSTITUTION"] });
      expect(await store.retry()).toBe(false);
    });

    it("clears a failure on request", async () => {
      const { store } = harness();
      await store.submitRequest("MENTOR");
      expect(store.getState().failure).not.toBeNull();
      store.clearFailure();
      expect(store.getState().failure).toBeNull();
    });
  });

  describe("drafts", () => {
    it("restores this user's drafts from sessionStorage on start, not at construction", () => {
      const storage = memoryStorage({
        [draftKey]: JSON.stringify({ MENTOR: { note: mentorNote, link: "" } }),
        [onboardingDraftKey("someone-else")]: JSON.stringify({ MENTOR: { note: "theirs", link: "" } }),
      });
      const getStorage = vi.fn(() => storage);
      const { store } = harness(wairimu, { storage: getStorage });
      expect(getStorage).not.toHaveBeenCalled();
      expect(store.getState().drafts).toEqual({});
      store.start();
      expect(store.getState().drafts).toEqual({ MENTOR: { note: mentorNote, link: "" } });
      store.start();
      expect(getStorage).toHaveBeenCalledTimes(1);
    });

    it("uses the real sessionStorage by default and never localStorage", () => {
      const { store } = harness(wairimu, { storage: undefined });
      fillMentorDraft(store);
      expect(JSON.parse(sessionStorage.getItem(draftKey)!)).toEqual({ MENTOR: { note: mentorNote, link: "" } });
      expect(localStorage.length).toBe(0);
      store.discardDraft("MENTOR");
      expect(sessionStorage.getItem(draftKey)).toBeNull();
    });

    it("keeps typing usable when storage is refused or absent", () => {
      const refusing = memoryStorage();
      refusing.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
      const blocked = harness(wairimu, { storage: () => refusing });
      fillMentorDraft(blocked.store);
      expect(blocked.store.getState()).toMatchObject({ draftsPersisted: false, drafts: { MENTOR: { note: mentorNote } } });
      const throwing = harness(wairimu, { storage: () => { throw new Error("denied"); } });
      fillMentorDraft(throwing.store);
      expect(throwing.store.getState().draftsPersisted).toBe(false);
      const keyless = harness(wairimu, { draftKey: undefined });
      fillMentorDraft(keyless.store);
      expect(keyless.store.getState()).toMatchObject({ draftsPersisted: false, drafts: { MENTOR: { note: mentorNote } } });
      expect(keyless.storage.map.size).toBe(0);
    });
  });

  describe("session and lifecycle", () => {
    it("401 means signed out: drafts are cleared everywhere and nothing more is sent", async () => {
      const { store, create, storage, fetch } = harness();
      storage.setItem(onboardingDraftKey("previous-user"), "{}");
      storage.setItem("unrelated", "keep");
      fillMentorDraft(store);
      create.mockReturnValueOnce(fail(401, "unauthorized"));
      expect(await store.submitRequest("MENTOR")).toBe(false);
      expect(store.getState()).toMatchObject({ closed: "signed_out", server: null, pending: null, failure: null });
      expect(store.getState().drafts).toEqual({});
      expect([...storage.map.keys()]).toEqual(["unrelated"]);
      const calls = fetch.mock.calls.length;
      store.start();
      expect(await store.refresh()).toBe(false);
      expect(await store.saveIntents()).toBe(false);
      expect(fetch.mock.calls.length).toBe(calls);
    });

    it("a disabled store's sign-out never touches storage", () => {
      const storage = vi.fn(() => memoryStorage());
      const store = createOnboardingStore({ draftKey, storage });
      store.signOut();
      expect(storage).not.toHaveBeenCalled();
      expect(store.getState().closed).toBe("signed_out");
    });

    it("drops a read that a client ignoring abort answers after a write", async () => {
      const call = vi.fn<(...args: unknown[]) => Promise<unknown>>();
      const store = createOnboardingStore({ enabled: true, api: { call } as unknown as ApiClient, initialState: wairimu });
      const read = deferred<OnboardingState>();
      call.mockReturnValueOnce(read.promise).mockResolvedValueOnce(wairimuPending);
      const refreshing = store.refresh();
      store.updateDraft("MENTOR", { note: mentorNote });
      expect(await store.submitRequest("MENTOR")).toBe(true);
      read.resolve(wairimu); // Older than the write: never applied.
      expect(await refreshing).toBe(false);
      expect(store.getState().server).toEqual(wairimuPending);
    });

    it("an explicit sign-out clears drafts before any were loaded", () => {
      const storage = memoryStorage({ [draftKey]: "{}" });
      const { store } = harness(wairimu, { storage: () => storage });
      store.signOut();
      expect(storage.map.size).toBe(0);
      expect(store.getState().closed).toBe("signed_out");
    });

    it.each([[403, "forbidden"], [404, "flag_off"], [404, "not_found"]])("%i %s on load closes onboarding without an error", async (status, code) => {
      const { store, get } = harness(null);
      get.mockReturnValueOnce(fail(status, code));
      store.start();
      await tick();
      expect(store.getState()).toMatchObject({ closed: "unavailable", loadError: null, loading: false });
      fillMentorDraft(store);
      expect(store.getState().drafts).toEqual({});
    });

    it("ignores an older read that resolves after a write", async () => {
      const { store, get } = harness();
      const stale = deferred<MockReply>();
      get.mockReturnValueOnce(stale.promise);
      const read = store.refresh();
      await tick();
      fillMentorDraft(store);
      expect(await store.submitRequest("MENTOR")).toBe(true);
      stale.resolve(ok(wairimu));
      expect(await read).toBe(false);
      expect(accessStatus(store.getState().server, "MENTOR")).toBe("PENDING");
      expect(store.getState().loading).toBe(false);
    });

    it("a newer refresh supersedes an older one", async () => {
      const { store, get } = harness();
      const first = deferred<MockReply>();
      get.mockReturnValueOnce(first.promise).mockReturnValueOnce(ok(wairimuPending));
      const older = store.refresh();
      await tick();
      expect(await store.refresh()).toBe(true);
      first.resolve(ok(wairimu));
      expect(await older).toBe(false);
      expect(store.getState().server).toEqual(wairimuPending);
    });

    it("stop aborts the write in flight and ignores its late answer", async () => {
      const { store, create, signals } = harness();
      fillMentorDraft(store);
      const reply = deferred<MockReply>();
      create.mockReturnValueOnce(reply.promise);
      const sent = store.submitRequest("MENTOR");
      await tick();
      store.stop();
      expect(signals.at(-1)?.aborted).toBe(true);
      expect(await sent).toBe(false);
      reply.resolve(ok(wairimuPending));
      await tick();
      expect(store.getState()).toMatchObject({ pending: null, server: wairimu, drafts: { MENTOR: { note: mentorNote } } });
    });

    it("stop during reconciliation drops the answer", async () => {
      const { store, create, get } = harness();
      fillMentorDraft(store);
      create.mockReturnValueOnce(fail(409, "conflict"));
      const truth = deferred<MockReply>();
      get.mockReturnValueOnce(truth.promise);
      const sent = store.submitRequest("MENTOR");
      await tick();
      store.stop();
      truth.resolve(ok(wairimuPending));
      expect(await sent).toBe(false);
      expect(store.getState()).toMatchObject({ server: wairimu, failure: null, pending: null });
    });

    it("reference-counts retainers and restarts after the last release", async () => {
      const { store, get } = harness(null);
      const releaseA = store.retain();
      const releaseB = store.retain();
      await tick();
      expect(get).toHaveBeenCalledTimes(1);
      releaseA();
      releaseA();
      expect(await store.refresh()).toBe(true);
      releaseB();
      expect(await store.refresh()).toBe(false);
      store.retain();
      expect(await store.refresh()).toBe(true);
    });
  });

  describe("server answers and unusual clients", () => {
    it("a 422 from the server is shown as invalid input", async () => {
      const { store, create } = harness();
      fillMentorDraft(store);
      create.mockReturnValueOnce(fail(422, "invalid_request"));
      expect(await store.submitRequest("MENTOR")).toBe(false);
      expect(store.getState().failure).toMatchObject({ kind: "invalid", error: { status: 422 } });
    });

    it("an unknown outcome for dismissPrompt and dismiss settles from server truth", async () => {
      const prompt = harness({ ...wairimu, stage: "PROMPT" });
      prompt.put.mockReturnValueOnce(fail(502, "bad_gateway"));
      prompt.get.mockReturnValueOnce(ok({ ...wairimu, stage: "DONE" }));
      expect(await prompt.store.dismissPrompt()).toBe(true);
      const declined = harness(peter);
      declined.dismiss.mockReturnValueOnce(fail(409, "conflict"));
      declined.get.mockReturnValueOnce(ok({ ...peter, requests: [{ ...accessRequests.peterMentor, seenAt: NOW }] }));
      expect(await declined.store.dismissRequest("MENTOR")).toBe(true);
    });

    it.each<[string, OnboardingState, Intent[]]>([
      ["a new account", { ...wairimu, stage: "NEW" }, ["MENTOR"]],
      ["the one-time card keeps the inferred prefill", { ...wairimu, stage: "PROMPT", inferred: ["MEMBER"] }, ["MEMBER", "MENTOR"]],
      ["revisit mode adds the hint to saved intents", mercy, ["MEMBER", "MENTOR"]],
    ])("the ?intent= hint survives a client-side first load: %s", async (_name, state, expected) => {
      const { store, get } = harness(null, { hint: "mentor" });
      get.mockReturnValueOnce(ok(state));
      expect(store.getState().selection.intents).toEqual(["MENTOR"]);
      store.start();
      await tick();
      expect(store.getState().selection).toMatchObject({ intents: expected });
    });

    it("choices made before the first load are replayed onto it as choices, not flips", async () => {
      const { store, get } = harness(null);
      const answer = deferred<MockReply>();
      get.mockReturnValueOnce(answer.promise);
      store.start();
      store.select({ type: "toggle", intent: "MEMBER" }); // chosen
      store.select({ type: "toggle", intent: "INSTITUTION" });
      store.select({ type: "toggle", intent: "INSTITUTION" }); // chosen, then unchosen
      answer.resolve(ok(mercy)); // The server already holds MEMBER and MENTOR.
      await tick();
      expect(store.getState().selection).toEqual({ intents: ["MEMBER", "MENTOR"], empty: false, dirty: true });
    });

    it("an explore before the first load stays exclusive after it", async () => {
      const { store, get } = harness(null, { hint: "institution" });
      const answer = deferred<MockReply>();
      get.mockReturnValueOnce(answer.promise);
      store.start();
      store.select({ type: "explore" });
      answer.resolve(ok({ ...wairimu, stage: "PROMPT", inferred: ["MEMBER"] }));
      await tick();
      expect(store.getState().selection.intents).toEqual(["EXPLORING"]);
    });

    it("a save before the first load commits the selection, so nothing is replayed onto its answer", async () => {
      const { store, put } = harness(null);
      store.select({ type: "toggle", intent: "MEMBER" });
      put.mockReturnValueOnce(ok({ ...wairimu, stage: "DONE", intents: ["MEMBER"] }));
      expect(await store.saveIntents()).toBe(true);
      expect(store.getState().selection).toEqual({ intents: ["MEMBER"], empty: false, dirty: false });
    });

    it("keeps one net choice per intent, so no early choice is lost however many follow", async () => {
      const { store, get } = harness(null);
      const answer = deferred<MockReply>();
      get.mockReturnValueOnce(answer.promise);
      store.start();
      store.select({ type: "toggle", intent: "MENTOR" });
      for (let i = 0; i < 101; i++) store.select({ type: "toggle", intent: "MEMBER" });
      answer.resolve(ok({ ...wairimu, stage: "PROMPT", inferred: ["INSTITUTION"] }));
      await tick();
      expect(store.getState().selection.intents).toEqual(["MEMBER", "MENTOR", "INSTITUTION"]);
    });

    it("a later choice never leaves an earlier one stale: member, then exploring, then mentor is mentor", async () => {
      const { store, get } = harness(null);
      const answer = deferred<MockReply>();
      get.mockReturnValueOnce(answer.promise);
      store.start();
      store.select({ type: "toggle", intent: "MEMBER" });
      store.select({ type: "explore" });
      store.select({ type: "toggle", intent: "MENTOR" });
      answer.resolve(ok({ ...wairimu, stage: "PROMPT", inferred: ["INSTITUTION"] }));
      await tick();
      expect(store.getState().selection.intents).toEqual(["MENTOR"]);
    });

    it("a pre-load save that succeeds shows the saved truth, never the hint again", async () => {
      const { store, put } = harness(null, { hint: "mentor" });
      store.select({ type: "toggle", intent: "MENTOR" }); // untick the preselected card
      store.select({ type: "toggle", intent: "MEMBER" });
      put.mockReturnValueOnce(ok({ ...wairimu, stage: "DONE", intents: ["MEMBER"] }));
      expect(await store.saveIntents()).toBe(true);
      expect(await put.mock.calls[0][0].json()).toEqual({ intents: ["MEMBER"] });
      expect(store.getState().selection).toEqual({ intents: ["MEMBER"], empty: false, dirty: false });
    });

    it("a pre-load save that fails keeps the person's choice, and the retry sends exactly it", async () => {
      const { store, put, get } = harness(null, { hint: "mentor" });
      store.select({ type: "toggle", intent: "MENTOR" });
      store.select({ type: "toggle", intent: "MEMBER" });
      put.mockReturnValueOnce(fail(503, "unavailable"));
      get.mockReturnValueOnce(ok({ ...wairimu, stage: "NEW" }));
      expect(await store.saveIntents()).toBe(false);
      expect(store.getState().selection).toEqual({ intents: ["MEMBER"], empty: false, dirty: true });
      put.mockReturnValueOnce(ok({ ...wairimu, stage: "DONE", intents: ["MEMBER"] }));
      expect(await store.retry()).toBe(true);
      expect(await Promise.all(put.mock.calls.map(([request]) => request.json()))).toEqual([{ intents: ["MEMBER"] }, { intents: ["MEMBER"] }]);
    });

    it("a definite write failure before the first load loads again, so status is never left unknown", async () => {
      const { store, get, put, reads } = harness(null, { hint: "mentor" });
      const first = deferred<MockReply>();
      get.mockReturnValueOnce(first.promise).mockReturnValueOnce(ok(mercy));
      store.start();
      store.select({ type: "toggle", intent: "MEMBER" });
      put.mockReturnValueOnce(fail(429, "rate_limited", 60_000));
      expect(await store.saveIntents()).toBe(false);
      first.resolve(ok(wairimu)); // Aborted by the write: dropped.
      await tick();
      expect(reads()).toBe(2);
      expect(store.getState()).toMatchObject({
        server: mercy, loadError: null, failure: { kind: "rate_limited" },
        selection: { intents: ["MEMBER", "MENTOR"], dirty: false },
      });
      expect(accessStatus(store.getState().server, "MENTOR")).toBe("PENDING");
    });

    it("if that second load fails too, the page gets a load error and its retry", async () => {
      const { store, get, put } = harness(null);
      get.mockReturnValueOnce(deferred<MockReply>().promise).mockReturnValueOnce(fail(500, "boom"));
      store.start();
      store.select({ type: "toggle", intent: "MEMBER" });
      put.mockReturnValueOnce(fail(422, "invalid_request"));
      expect(await store.saveIntents()).toBe(false);
      await tick();
      expect(store.getState()).toMatchObject({ server: null, loadError: { status: 500 }, failure: { kind: "invalid" } });
    });

    it("keeps 'Choose at least one' up across the first load while nothing is chosen", async () => {
      const { store, get } = harness(null);
      const answer = deferred<MockReply>();
      get.mockReturnValueOnce(answer.promise);
      store.start();
      expect(await store.saveIntents()).toBe(false);
      expect(store.getState().selection.empty).toBe(true);
      answer.resolve(ok(wairimu));
      await tick();
      expect(store.getState().selection).toEqual({ intents: [], empty: true, dirty: false });
    });

    it("a pre-load save that fails never brings back the inferred prefill", async () => {
      const { store, put, get } = harness(null);
      store.select({ type: "toggle", intent: "MENTOR" });
      put.mockReturnValueOnce(fail(503, "unavailable"));
      get.mockReturnValueOnce(ok({ ...wairimu, stage: "PROMPT", inferred: ["MEMBER"] }));
      expect(await store.saveIntents()).toBe(false);
      expect(store.getState().selection).toEqual({ intents: ["MENTOR"], empty: false, dirty: true });
    });

    it("normalizes non-API errors and ignores answers from a client that ignores abort", async () => {
      const call = vi.fn<(...args: unknown[]) => Promise<unknown>>();
      const api = { call } as unknown as ApiClient;
      const store = createOnboardingStore({ enabled: true, api, initialState: wairimu });
      call.mockRejectedValueOnce(new Error("boom"));
      store.select({ type: "toggle", intent: "MEMBER" });
      expect(await store.saveIntents()).toBe(false);
      expect(store.getState().failure).toMatchObject({ kind: "failed", error: { code: "client_error", status: 0 } });

      const read = deferred<OnboardingState>();
      call.mockReturnValueOnce(read.promise);
      const refreshing = store.refresh();
      store.stop();
      read.resolve(wairimuPending);
      expect(await refreshing).toBe(false);

      store.start();
      const written = deferred<OnboardingState>();
      call.mockReturnValueOnce(written.promise);
      const saving = store.saveIntents();
      store.stop();
      written.resolve(wairimuPending);
      expect(await saving).toBe(false);
      expect(store.getState().server).toEqual(wairimu);
    });
  });

  it.each<[string, OnboardingState, string]>([
    ["no request", wairimu, "NOT_REQUESTED"],
    ["pending", mercy, "PENDING"],
    ["declined", peter, "DECLINED"],
    ["withdrawn", mercyWithdrawn, "NOT_REQUESTED"],
    ["approved, not yet seen", mercyApproved, "APPROVED"],
    ["approved and seen", { ...mercyApproved, requests: [{ ...mercyApproved.requests[0], seenAt: NOW }] }, "ACTIVE"],
    ["a role granted without a request", { ...wairimu, roles: ["MENTOR"] }, "ACTIVE"],
    ["an approval whose role was removed", { ...mercyApproved, roles: [] }, "NOT_REQUESTED"],
  ])("access status: %s", (_name, state, expected) => {
    expect(accessStatus(state, "MENTOR")).toBe(expected);
  });

  it("access status is NOT_REQUESTED before state loads", () => {
    expect(accessStatus(null, "INSTITUTION")).toBe("NOT_REQUESTED");
  });
});
