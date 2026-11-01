// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearOnboardingDrafts, EMPTY_DRAFTS, ONBOARDING_DRAFT_PREFIX, onboardingDraftKey, patchDraft, readDrafts,
  sessionDraftStorage, toCreateAccessRequest, writeDrafts, type DraftStorage,
} from "./onboarding-drafts";

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

const mentor = { note: "I review Flutter and Kotlin apps for offline use.", link: "https://example.com/synthetic/portfolio" };
const institution = {
  note: "We want to find junior mobile developers with offline-first work.", organisation: "Mto Labs",
  organisationRole: "Engineering lead", link: "", scopeAcknowledged: true,
};

describe("draft storage", () => {
  afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); localStorage.clear(); });

  it("uses sessionStorage by default and never localStorage", () => {
    const storage = sessionDraftStorage();
    expect(storage).toBe(window.sessionStorage);
    const key = onboardingDraftKey("synthetic-user");
    expect(key).toBe(`${ONBOARDING_DRAFT_PREFIX}synthetic-user`);
    expect(writeDrafts(storage, key, { MENTOR: mentor })).toBe(true);
    expect(readDrafts(storage, key)).toEqual({ MENTOR: mentor });
    expect(sessionStorage.getItem(key)).toBe(JSON.stringify({ MENTOR: mentor }));
    expect(localStorage.length).toBe(0);
  });

  it("is SSR safe and tolerates a blocked storage getter", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    expect(sessionDraftStorage()).toBeUndefined();
    expect(readDrafts(undefined, "k")).toEqual({});
    expect(writeDrafts(undefined, "k", { MENTOR: mentor })).toBe(false);
    expect(() => clearOnboardingDrafts()).not.toThrow();
    expect(() => clearOnboardingDrafts(undefined)).not.toThrow();
  });

  it("removes the key once no draft is left", () => {
    const storage = memoryStorage();
    writeDrafts(storage, "k", { MENTOR: mentor, INSTITUTION: institution });
    expect(JSON.parse(storage.map.get("k")!)).toEqual({ MENTOR: mentor, INSTITUTION: institution });
    writeDrafts(storage, "k", {});
    expect(storage.map.has("k")).toBe(false);
  });

  it.each([
    ["corrupt JSON", "{"],
    ["a wrong shape", JSON.stringify({ MENTOR: { note: 5, link: "" } })],
    ["an over-long field", JSON.stringify({ MENTOR: { note: "x".repeat(4_097), link: "" } })],
    ["an oversized value", JSON.stringify({ MENTOR: { note: "", link: "" }, padding: "x".repeat(40_000) })],
    ["a non-object", "\"note\""],
  ])("drops %s instead of trusting it", (_name, raw) => {
    const storage = memoryStorage({ k: raw });
    expect(readDrafts(storage, "k")).toEqual({});
    expect(storage.map.has("k")).toBe(false);
  });

  it("strips unknown stored keys", () => {
    const storage = memoryStorage({ k: JSON.stringify({ MENTOR: { ...mentor, role: "ADMIN" }, ADMIN: { note: "x" } }) });
    expect(readDrafts(storage, "k")).toEqual({ MENTOR: mentor });
  });

  it("reports refused writes and throwing reads without throwing", () => {
    const storage = memoryStorage();
    storage.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
    expect(writeDrafts(storage, "k", { MENTOR: mentor })).toBe(false);
    storage.getItem = () => { throw new Error("denied"); };
    storage.removeItem = () => { throw new Error("denied"); };
    expect(readDrafts(storage, "k")).toEqual({});
  });

  it("sign-out clears every user's drafts and nothing else", () => {
    const storage = memoryStorage({
      [onboardingDraftKey("a")]: "{}", [onboardingDraftKey("b")]: "{}", "ttv-other": "keep", "ttv-onboarding-draft": "keep",
    });
    clearOnboardingDrafts(storage);
    expect([...storage.map.keys()]).toEqual(["ttv-other", "ttv-onboarding-draft"]);
    storage.key = () => { throw new Error("denied"); };
    expect(() => clearOnboardingDrafts(storage)).not.toThrow();
  });

  it("clears the real sessionStorage by default", () => {
    sessionStorage.setItem(onboardingDraftKey("a"), "{}");
    sessionStorage.setItem("unrelated", "1");
    clearOnboardingDrafts();
    expect(sessionStorage.getItem(onboardingDraftKey("a"))).toBeNull();
    expect(sessionStorage.getItem("unrelated")).toBe("1");
  });
});

describe("draft patches", () => {
  it("starts from the empty draft, keeps known fields and bounds text", () => {
    expect(patchDraft("MENTOR", undefined, { note: "hello" })).toEqual({ note: "hello", link: "" });
    const patched = patchDraft("INSTITUTION", institution, { organisation: "x".repeat(5_000), scopeAcknowledged: false });
    expect(patched.organisation).toHaveLength(4_096);
    expect(patched.scopeAcknowledged).toBe(false);
  });

  it("ignores unknown keys and wrong types", () => {
    const patch = { role: "ADMIN", note: 5, scopeAcknowledged: "yes", link: true } as unknown as Partial<typeof institution>;
    expect(patchDraft("INSTITUTION", institution, patch)).toEqual(institution);
    expect(patchDraft("MENTOR", undefined, { organisation: "x" } as never)).toEqual(EMPTY_DRAFTS.MENTOR);
  });
});

describe("request validation", () => {
  it("builds a trimmed mentor request with an optional link", () => {
    expect(toCreateAccessRequest("MENTOR", { MENTOR: { note: `  ${mentor.note}  `, link: "  " } }))
      .toEqual({ ok: true, body: { role: "MENTOR", note: mentor.note, link: null } });
  });

  it("builds an institution request with the scope acknowledgement", () => {
    expect(toCreateAccessRequest("INSTITUTION", { INSTITUTION: { ...institution, organisationRole: " " } })).toEqual({
      ok: true, body: { role: "INSTITUTION", note: institution.note, organisation: "Mto Labs", organisationRole: null, link: null, scopeAcknowledged: true },
    });
  });

  it("returns field errors for every invalid field, using the shared contract", () => {
    const mentorResult = toCreateAccessRequest("MENTOR", { MENTOR: { note: "too short", link: "ftp://example.com/synthetic/work" } });
    expect(mentorResult.ok).toBe(false);
    expect(Object.keys(!mentorResult.ok ? mentorResult.fieldErrors : {}).toSorted()).toEqual(["link", "note"]);
    const missing = toCreateAccessRequest("INSTITUTION", {});
    expect(Object.keys(!missing.ok ? missing.fieldErrors : {}).toSorted()).toEqual(["note", "organisation", "scopeAcknowledged"]);
    const credentials = toCreateAccessRequest("MENTOR", { MENTOR: { ...mentor, link: "https://tembotechventures.com@other.example" } });
    expect(credentials).toEqual({ ok: false, fieldErrors: { link: "Links cannot carry credentials" } });
  });

  it("reads only the asked-for role's draft", () => {
    expect(toCreateAccessRequest("MENTOR", { INSTITUTION: institution }).ok).toBe(false);
    expect(toCreateAccessRequest("INSTITUTION", { MENTOR: mentor }).ok).toBe(false);
  });
});
