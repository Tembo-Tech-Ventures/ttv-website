import { describe, expect, it, vi } from "vitest";
import { MAX_MONTHLY_CAPACITY, type MentorAvailability } from "../contracts";
import { availability, people } from "../fixtures";
import { createApiClient } from "./apiClient";
import {
  areaProblem, createAvailabilityStore, draftOf, isDirty, MAX_AREA, MAX_AREAS, validateAvailability,
} from "./mentor-availability";
import { createMentoringMock } from "./mentoring.mock";
import { createMockTransport, type MockReply } from "./mockTransport";

function editor(reply: (body: unknown) => MockReply | Promise<MockReply> = body => ({ data: { ...availability, ...(body as object), listed: true } })) {
  const sent: unknown[] = [];
  const api = createApiClient({ retry: { maxRetries: 0 }, fetch: createMockTransport([
    { method: "PUT", path: "/api/mentoring/availability", reply: async ({ request }) => {
      const body = await request.json();
      sent.push(body);
      return reply(body);
    } },
  ]) });
  return { store: createAvailabilityStore({ initial: availability, api }), sent };
}

describe("rules", () => {
  it("knows when the draft differs from what is saved", () => {
    const saved = availability;
    expect(isDirty({ saved, draft: draftOf(saved) })).toBe(false);
    expect(isDirty({ saved, draft: { ...draftOf(saved), formats: saved.formats.toReversed() } })).toBe(false);
    expect(isDirty({ saved, draft: { ...draftOf(saved), areas: saved.areas.toReversed() } })).toBe(true);
    expect(isDirty({ saved, draft: { ...draftOf(saved), paused: true } })).toBe(true);
  });

  it("explains each field the contract would refuse", () => {
    const result = validateAvailability({
      ...draftOf(availability), headline: "x".repeat(121), areas: ["Mobile", "mobile"], formats: [], monthlyCapacity: 21, bio: "x".repeat(2001),
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors).toSorted()).toEqual(["areas", "bio", "formats", "headline", "monthlyCapacity"]);
    expect(validateAvailability({ ...draftOf(availability), headline: "   " }).ok).toBe(false);
  });

  it("saves trimmed text", () => {
    const result = validateAvailability({ ...draftOf(availability), headline: "  Backend engineer ", bio: " Hi ", areas: [" Mobile "] });
    expect(result).toMatchObject({ ok: true, body: { headline: "Backend engineer", bio: "Hi", areas: ["Mobile"] } });
  });

  it("says why an area can't be added", () => {
    expect(areaProblem([], " ")).toBe("Type an area first.");
    expect(areaProblem([], "x".repeat(MAX_AREA + 1))).toContain(String(MAX_AREA));
    expect(areaProblem(["Code review"], "code REVIEW ")).toBe('"code REVIEW" is already listed.');
    expect(areaProblem(Array.from({ length: MAX_AREAS }, (_, i) => `Area ${i}`), "One more")).toContain(String(MAX_AREAS));
    expect(areaProblem(["Mobile"], "Kotlin")).toBeNull();
  });
});

describe("the availability editor", () => {
  it("adds and removes areas, saying so", () => {
    const { store } = editor();
    store.setAreaInput("  Kotlin ");
    expect(store.addArea()).toBe(true);
    expect(store.getState()).toMatchObject({ areaInput: "", announcement: "Added Kotlin." });
    expect(store.getState().draft.areas).toEqual(["Code review", "API design", "Kotlin"]);
    store.setAreaInput("kotlin");
    expect(store.addArea()).toBe(false);
    expect(store.getState().errors.areas).toBe('"kotlin" is already listed.');
    store.setAreaInput("Data");
    expect(store.getState().errors.areas).toBeUndefined();
    store.removeArea("API design");
    expect(store.getState()).toMatchObject({ announcement: "Removed API design." });
    expect(store.getState().draft.areas).toEqual(["Code review", "Kotlin"]);
    store.removeArea("Not listed");
    expect(store.getState().draft.areas).toHaveLength(2);
  });

  it("keeps at least one format, in the contract's order", () => {
    const { store } = editor();
    store.toggleFormat("QUICK_QUESTION");
    expect(store.getState().draft.formats).toEqual(["WRITTEN_REVIEW", "CALL_30_MIN", "QUICK_QUESTION"]);
    store.toggleFormat("WRITTEN_REVIEW");
    store.toggleFormat("CALL_30_MIN");
    expect(store.getState().draft.formats).toEqual(["QUICK_QUESTION"]);
    store.toggleFormat("QUICK_QUESTION");
    expect(store.getState().draft.formats).toEqual(["QUICK_QUESTION"]);
    expect(store.getState().errors.formats).toBe("Offer at least one way to help.");
    store.toggleFormat("CALL_30_MIN");
    expect(store.getState().errors.formats).toBeUndefined();
  });

  it("holds the monthly number to whole requests between 0 and the maximum", () => {
    const { store } = editor();
    store.setMonthlyCapacity(2.6);
    expect(store.getState().draft.monthlyCapacity).toBe(3);
    store.setMonthlyCapacity(-4);
    expect(store.getState().draft.monthlyCapacity).toBe(0);
    store.setMonthlyCapacity(99);
    expect(store.getState().draft.monthlyCapacity).toBe(MAX_MONTHLY_CAPACITY);
    store.setMonthlyCapacity(Number.NaN);
    expect(store.getState().draft.monthlyCapacity).toBe(MAX_MONTHLY_CAPACITY);
  });

  it("saves the draft and takes the server's answer as the saved state", async () => {
    const { store, sent } = editor(body => ({ data: { ...availability, ...(body as object), listed: false, capacity: { used: 1, limit: 3, nextOpeningAt: null } } }));
    store.setPaused(true);
    store.setHeadline("Backend engineer · payments");
    expect(isDirty(store.getState())).toBe(true);
    const saved = await store.save();
    expect(sent).toEqual([{ ...draftOf(availability), paused: true, headline: "Backend engineer · payments" }]);
    expect(saved?.listed).toBe(false);
    expect(store.getState()).toMatchObject({ status: "saved", announcement: "Saved. You're not listed in the directory right now." });
    expect(isDirty(store.getState())).toBe(false);
  });

  it("says when saving puts the mentor in the directory", async () => {
    const { store } = editor();
    store.setBio("Reviews APIs.");
    await store.save();
    expect(store.getState().announcement).toBe("Saved. Members can find you in the directory.");
  });

  it("refuses an invalid draft without sending it", async () => {
    const { store, sent } = editor();
    store.setHeadline("");
    await expect(store.save()).resolves.toBeNull();
    expect(sent).toEqual([]);
    expect(store.getState()).toMatchObject({ errors: { headline: expect.any(String) }, announcement: "Check the highlighted fields." });
    store.setHeadline("Back");
    expect(store.getState().errors).toEqual({});
  });

  it("keeps every change when saving fails, and resets to what is saved", async () => {
    const { store } = editor(() => ({ status: 500, data: { error: { code: "server", message: "Down" } } }));
    store.setBio("New bio");
    await store.save();
    expect(store.getState()).toMatchObject({ status: "error", announcement: "Couldn't save. Your changes are still here.", draft: { bio: "New bio" } });
    store.reset();
    expect(store.getState()).toMatchObject({ status: "editing", error: null, draft: draftOf(availability) });
  });

  it("ignores edits and a second save while one is in flight", async () => {
    let answer!: (reply: MockReply) => void;
    const { store, sent } = editor(() => new Promise(resolve => { answer = resolve; }));
    store.setBio("One");
    const saving = store.save();
    store.setBio("Two");
    store.toggleFormat("QUICK_QUESTION");
    store.removeArea("Code review");
    store.setAreaInput("X");
    expect(store.addArea()).toBe(false);
    store.reset();
    await expect(store.save()).resolves.toBeNull();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(store.getState().draft).toMatchObject({ bio: "One", areas: availability.areas });
    answer({ data: { ...availability, bio: "One" } });
    await saving;
    expect(store.getState().saved.bio).toBe("One");
  });

  it("stops a save in flight when the last holder releases it", async () => {
    const { store } = editor(() => new Promise(() => {}));
    const release = store.retain();
    store.setBio("Never saved");
    const saving = store.save();
    release();
    await expect(saving).resolves.toBeNull();
    expect(store.getState()).toMatchObject({ status: "editing", error: null, draft: { bio: "Never saved" } });
  });

  it("works against the stateful mock: a first save lists a new mentor", async () => {
    const mock = createMentoringMock({ viewer: people.peter });
    const initial: MentorAvailability = mock.availability(people.peter.id);
    expect(initial).toMatchObject({ headline: "", listed: false, capacity: { limit: 0 } });
    const store = createAvailabilityStore({ initial, mock: mock.api });
    store.setHeadline("Data engineer");
    store.setAreaInput("Data pipelines");
    store.addArea();
    store.setMonthlyCapacity(2);
    const saved = await store.save();
    expect(saved).toMatchObject({ listed: true, capacity: { used: 0, limit: 2 } });
  });
});
