// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MentorDirectoryItem, MentorRequest } from "../contracts";
import { mentors, people, projects } from "../fixtures";
import { createApiClient } from "./apiClient";
import {
  clearMentorRequestDrafts, createRequestFormStore, MAX_NOTE, MENTOR_REQUEST_DRAFT_PREFIX, mentorRequestDraftKey,
  readRequestDraft, requestFailure, validateRequestDraft, writeRequestDraft,
} from "./mentor-request-form";
import { createMentoringMock } from "./mentoring.mock";
import { createMockTransport, type MockReply } from "./mockTransport";
import type { DraftStorage } from "./onboarding-drafts";

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

const david = mentors.items[0];
const userId = people.wanjiku.id;
const key = mentorRequestDraftKey(userId, david.person.id);
const own = [projects.fareSplitter];

function store(options: { storage?: DraftStorage; reply?: (body: unknown) => MockReply; mentor?: MentorDirectoryItem } = {}) {
  const sent: unknown[] = [];
  const api = createApiClient({ retry: { maxRetries: 0 }, fetch: createMockTransport([
    { method: "POST", path: "/api/mentor-requests", reply: async ({ request }) => {
      const body = await request.json();
      sent.push(body);
      return options.reply?.(body) ?? { status: 201, data: { ...created, note: (body as { note: string }).note } };
    } },
  ]) });
  const form = createRequestFormStore({ userId, mentor: options.mentor ?? david, projects: own, api, storage: options.storage ?? memoryStorage() });
  return { form, sent };
}
const created: MentorRequest = {
  id: "request-new", requester: people.wanjiku, mentor: david.person, note: "x", project: null, format: "WRITTEN_REVIEW",
  status: "PENDING", channelId: null, redirectedTo: null, responseNote: null, createdAt: 1, updatedAt: 1,
};
const failure = (status: number, code: string): MockReply => ({ status, data: { error: { code, message: "No." } } });

describe("request drafts", () => {
  afterEach(() => sessionStorage.clear());

  it("keeps one draft per person and mentor, in the tab's sessionStorage", () => {
    expect(key).toBe(`${MENTOR_REQUEST_DRAFT_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(david.person.id)}`);
    expect(mentorRequestDraftKey("other", david.person.id)).not.toBe(key);
    const { form } = store({ storage: sessionStorage });
    form.setNote("Could you look at my retries?");
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({ note: "Could you look at my retries?", project: null, format: "WRITTEN_REVIEW" });
    expect(localStorage.length).toBe(0);
  });

  it("restores a kept draft, dropping a project or format that can no longer be sent", () => {
    const storage = memoryStorage({ [key]: JSON.stringify({ note: "Kept", project: { type: "project", journeyId: "gone", version: 1 }, format: "QUICK_QUESTION" }) });
    const { form } = store({ storage });
    expect(form.getState().note).toBe("");
    form.restore();
    // David offers no quick questions, and that project is not Wanjiku's to attach.
    expect(form.getState()).toMatchObject({ note: "Kept", project: null, format: "WRITTEN_REVIEW" });
  });

  it("drops corrupt, oversized or empty drafts", () => {
    const storage = memoryStorage({ [key]: "{not json" });
    expect(readRequestDraft(storage, key)).toBeNull();
    expect(storage.map.has(key)).toBe(false);
    storage.map.set(key, JSON.stringify({ note: "x".repeat(20_000), project: null, format: null }));
    expect(readRequestDraft(storage, key)).toBeNull();
    writeRequestDraft(storage, key, { note: "  ", project: null, format: "CALL_30_MIN" });
    expect(storage.map.has(key)).toBe(false);
    expect(readRequestDraft(undefined, key)).toBeNull();
  });

  it("survives storage that throws", () => {
    const broken: DraftStorage = {
      length: 0, key: () => null, getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("denied"); },
    };
    const { form } = store({ storage: broken });
    form.restore();
    form.setNote("Still works");
    expect(form.getState().note).toBe("Still works");
    expect(() => clearMentorRequestDrafts(broken)).not.toThrow();
  });

  it("clears every mentor request draft on sign-out, and nothing else", () => {
    const storage = memoryStorage({ [key]: "{}", [mentorRequestDraftKey(userId, "m2")]: "{}", "ttv-channel-drafts:u:c": "{}" });
    clearMentorRequestDrafts(storage);
    expect([...storage.map.keys()]).toEqual(["ttv-channel-drafts:u:c"]);
    expect(() => clearMentorRequestDrafts(undefined)).not.toThrow();
  });
});

describe("validation", () => {
  it("needs a note within the limit and a format the mentor offers", () => {
    expect(validateRequestDraft({ note: "  ", project: null, format: null }, david)).toEqual({
      ok: false, errors: { note: "Say what you'd like help with.", format: "Choose how you'd like their help." },
    });
    expect(validateRequestDraft({ note: "x".repeat(MAX_NOTE + 1), project: null, format: "QUICK_QUESTION" }, david)).toMatchObject({
      ok: false, errors: { note: expect.stringContaining("2000"), format: expect.any(String) },
    });
    expect(validateRequestDraft({ note: " Help? ", project: null, format: "CALL_30_MIN" }, david)).toEqual({ ok: true, note: "Help?", format: "CALL_30_MIN" });
  });
});

describe("the request form", () => {
  it("starts on the mentor's first format, and only takes formats and projects that can be sent", () => {
    const { form } = store();
    expect(form.getState().format).toBe("WRITTEN_REVIEW");
    form.setFormat("QUICK_QUESTION");
    expect(form.getState().format).toBe("WRITTEN_REVIEW");
    form.setFormat("CALL_30_MIN");
    form.setProject({ journeyId: projects.chamaLedger.journeyId, version: 3 });
    expect(form.getState().project).toBeNull();
    form.setProject(projects.fareSplitter);
    expect(form.getState().project).toEqual({ type: "project", journeyId: projects.fareSplitter.journeyId, version: 4 });
    form.setProject(null);
    expect(form.getState().project).toBeNull();
  });

  it("explains what to fix without sending, and clears a message once its field changes", async () => {
    const { form, sent } = store();
    await expect(form.submit()).resolves.toBeNull();
    expect(sent).toEqual([]);
    expect(form.getState().errors).toEqual({ note: "Say what you'd like help with." });
    form.setNote("Help with retries");
    expect(form.getState().errors).toEqual({});
  });

  it("sends the trimmed note, the attached revision and the format, then forgets the draft", async () => {
    const storage = memoryStorage();
    const { form, sent } = store({ storage });
    form.setNote("  Could you check my callback handling?  ");
    form.setProject(projects.fareSplitter);
    expect(storage.map.has(key)).toBe(true);
    const request = await form.submit();
    expect(sent).toEqual([{
      mentorId: david.person.id, note: "Could you check my callback handling?",
      project: { type: "project", journeyId: projects.fareSplitter.journeyId, version: 4 }, format: "WRITTEN_REVIEW",
    }]);
    expect(request?.id).toBe("request-new");
    expect(form.getState()).toMatchObject({ status: "sent", note: "", project: null, announcement: "Request sent to David Kamau." });
    expect(storage.map.has(key)).toBe(false);
    // Sent is final: no second request, no more edits.
    await form.submit();
    form.setNote("again");
    expect(sent).toHaveLength(1);
    expect(form.getState().note).toBe("");
  });

  it("asks for the code of conduct, keeps the draft, and sends after agreeing", async () => {
    let agreed = false;
    const storage = memoryStorage();
    const { form, sent } = store({ storage, reply: () => agreed ? { status: 201, data: created } : failure(403, "conduct_required") });
    form.setNote("Could we talk about interviews?");
    await form.submit();
    expect(form.getState()).toMatchObject({ status: "conduct", note: "Could we talk about interviews?" });
    expect(storage.map.has(key)).toBe(true);
    agreed = true;
    form.agreed();
    expect(form.getState().status).toBe("editing");
    await form.submit();
    expect(form.getState().status).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it.each([
    [409, "conflict", "conflict"],
    [404, "not_found", "notFound"],
    [401, "unauthorized", "signedOut"],
    [500, "server", "other"],
  ] as const)("keeps the note when the server answers %i", async (status, code, kind) => {
    const { form } = store({ reply: () => failure(status, code) });
    form.setNote("Help with a deploy");
    await form.submit();
    expect(form.getState()).toMatchObject({ status: "error", failure: kind, note: "Help with a deploy", announcement: "Your request wasn't sent. Your note is kept." });
    form.setNote("Help with a deploy, please");
    expect(form.getState()).toMatchObject({ status: "editing" });
  });

  it("ignores edits and a second send while one is in flight", async () => {
    let finish!: (reply: MockReply) => void;
    let calls = 0;
    const api = createApiClient({ retry: { maxRetries: 0 }, fetch: createMockTransport([
      { method: "POST", path: "/api/mentor-requests", reply: () => { calls += 1; return new Promise<MockReply>(resolve => { finish = resolve; }); } },
    ]) });
    const slow = createRequestFormStore({ userId, mentor: david, projects: own, api, storage: memoryStorage() });
    slow.setNote("One");
    const first = slow.submit();
    await Promise.resolve();
    slow.setNote("Two");
    const again = slow.submit();
    expect(slow.getState()).toMatchObject({ status: "sending", note: "One" });
    await vi.waitFor(() => expect(calls).toBe(1));
    finish({ status: 201, data: created });
    await Promise.all([first, again]);
    expect(slow.getState().status).toBe("sent");
    expect(calls).toBe(1);
  });

  it("stops a send in flight when the last holder releases it, and goes back to editing", async () => {
    const api = createApiClient({ retry: { maxRetries: 0 }, fetch: createMockTransport([
      { method: "POST", path: "/api/mentor-requests", reply: () => new Promise<MockReply>(() => {}) },
    ]) });
    const form = createRequestFormStore({ userId, mentor: david, projects: own, api, storage: memoryStorage() });
    const release = form.retain();
    const second = form.retain();
    form.setNote("Will be stopped");
    const sending = form.submit();
    release();
    release();
    expect(form.getState().status).toBe("sending");
    second();
    await expect(sending).resolves.toBeNull();
    expect(form.getState()).toMatchObject({ status: "editing", note: "Will be stopped" });
  });

  it("works against the stateful mock: a second request to the same mentor is refused", async () => {
    const mock = createMentoringMock();
    const joseph = mentors.items[2];
    const make = () => createRequestFormStore({ userId, mentor: joseph, projects: mock.projects, mock: mock.api, storage: memoryStorage() });
    const first = make();
    first.setNote("Could we talk about interviews?");
    expect(await first.submit()).toMatchObject({ status: "PENDING", mentor: { id: joseph.person.id } });
    const second = make();
    second.setNote("And again?");
    await second.submit();
    expect(second.getState().failure).toBe("conflict");
  });
});

describe("requestFailure", () => {
  it("names each refusal the drawer can explain, and only a plain 403 as not being a member", () => {
    expect(requestFailure({ status: 409, code: "conflict" })).toBe("conflict");
    expect(requestFailure({ status: 429, code: "rate_limited" })).toBe("limit");
    expect(requestFailure({ status: 404, code: "not_found" })).toBe("notFound");
    expect(requestFailure({ status: 401, code: "unauthorized" })).toBe("signedOut");
    expect(requestFailure({ status: 403, code: "forbidden" })).toBe("notMember");
    // conduct_required is its own state, handled before this; any other 403 is not a membership answer.
    expect(requestFailure({ status: 403, code: "flag_off" })).toBe("other");
    expect(requestFailure({ status: 500, code: "server" })).toBe("other");
  });
});
