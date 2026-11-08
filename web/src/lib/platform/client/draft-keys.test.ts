import { describe, expect, it } from "vitest";
import { CHANNEL_DRAFT_PREFIX, clearAllDrafts, clearDrafts, MENTOR_REQUEST_DRAFT_PREFIX, ONBOARDING_DRAFT_PREFIX, type DraftStorage } from "./draft-keys";
import { channelDraftKey } from "./channel-drafts";
import { mentorRequestDraftKey } from "./mentor-request-form";
import { onboardingDraftKey } from "./onboarding-drafts";

function memory(entries: Record<string, string>): DraftStorage & { keys(): string[] } {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
    keys: () => [...map.keys()].toSorted(),
  };
}

describe("draft keys", () => {
  it("are the prefixes each form writes under", () => {
    expect(onboardingDraftKey("u1").startsWith(ONBOARDING_DRAFT_PREFIX)).toBe(true);
    expect(channelDraftKey("u1", "c1").startsWith(CHANNEL_DRAFT_PREFIX)).toBe(true);
    expect(mentorRequestDraftKey("u1", "m1").startsWith(MENTOR_REQUEST_DRAFT_PREFIX)).toBe(true);
  });

  it("forgets every user's unsent text on sign-out, and nothing else in the tab", () => {
    const storage = memory({
      [onboardingDraftKey("u1")]: "{}", [channelDraftKey("u2", "c1")]: "{}", [mentorRequestDraftKey("u1", "m1")]: "{}",
      "ttv-search-recent": "[]", "unrelated": "1",
    });
    clearAllDrafts(storage);
    expect(storage.keys()).toEqual(["ttv-search-recent", "unrelated"]);
  });

  it("clears only the prefixes it is given", () => {
    const storage = memory({ [onboardingDraftKey("u1")]: "{}", [channelDraftKey("u1", "c1")]: "{}" });
    clearDrafts([CHANNEL_DRAFT_PREFIX], storage);
    expect(storage.keys()).toEqual([onboardingDraftKey("u1")]);
  });

  it("does nothing, and never throws, without storage or when storage refuses", () => {
    expect(() => clearAllDrafts(undefined)).not.toThrow();
    const refusing = { ...memory({ [onboardingDraftKey("u1")]: "{}" }), removeItem: () => { throw new Error("SecurityError"); } };
    expect(() => clearAllDrafts(refusing)).not.toThrow();
  });
});
