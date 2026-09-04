import { describe, expect, it } from "vitest";
import {
  autosaveReducer,
  canSaveNow,
  draftsEqual,
  effectiveSlug,
  initialAutosaveState,
  isDirty,
  isWorthSaving,
  publishBlockers,
  saveStatus,
  saveStatusLabel,
  shouldSave,
  wordCount,
  type AutosaveState,
  type PostDraft,
} from "./editor-state";

const EMPTY: PostDraft = {
  title: "",
  slug: "",
  excerpt: "",
  contentMarkdown: "",
};

function draft(overrides: Partial<PostDraft> = {}): PostDraft {
  return { ...EMPTY, ...overrides };
}

function edited(state: AutosaveState, overrides: Partial<PostDraft>) {
  return autosaveReducer(state, {
    type: "edit",
    draft: { ...state.current, ...overrides },
  });
}

describe("autosaveReducer", () => {
  it("marks the editor dirty on an edit and clean once that edit is saved", () => {
    let state = initialAutosaveState(draft({ title: "First" }));
    expect(isDirty(state)).toBe(false);

    state = edited(state, { title: "Second" });
    expect(isDirty(state)).toBe(true);
    expect(shouldSave(state)).toBe(true);

    state = autosaveReducer(state, { type: "save-start" });
    state = autosaveReducer(state, { type: "save-ok", at: 1_000 });
    expect(isDirty(state)).toBe(false);
    expect(state.savedAt).toBe(1_000);
  });

  it("ignores an edit that produces an identical draft", () => {
    const state = initialAutosaveState(draft({ title: "Same" }));
    expect(edited(state, { title: "Same" })).toBe(state);
  });

  it("keeps edits made during a save dirty when the save succeeds", () => {
    // The bug this exists to prevent: a response that marks the editor clean
    // wholesale silently drops everything typed while the request was open.
    let state = initialAutosaveState(EMPTY);
    state = edited(state, { contentMarkdown: "first" });
    state = autosaveReducer(state, { type: "save-start" });

    state = edited(state, { contentMarkdown: "first and second" });
    state = autosaveReducer(state, { type: "save-ok", at: 2_000 });

    expect(state.saved.contentMarkdown).toBe("first");
    expect(state.current.contentMarkdown).toBe("first and second");
    expect(isDirty(state)).toBe(true);
    expect(shouldSave(state)).toBe(true);
  });

  it("does not start a second save while one is in flight", () => {
    let state = initialAutosaveState(EMPTY);
    state = edited(state, { title: "A" });
    state = autosaveReducer(state, { type: "save-start" });
    const inFlight = state.inFlight;

    state = edited(state, { title: "AB" });
    const unchanged = autosaveReducer(state, { type: "save-start" });

    expect(shouldSave(state)).toBe(false);
    expect(unchanged).toBe(state);
    // The open request still carries the snapshot it was started with, so its
    // success cannot move the baseline forward past the newer edit.
    expect(unchanged.inFlight).toBe(inFlight);
  });

  it("leaves the draft dirty and reports the message when a save fails", () => {
    let state = initialAutosaveState(EMPTY);
    state = edited(state, { title: "A" });
    state = autosaveReducer(state, { type: "save-start" });
    state = autosaveReducer(state, { type: "save-error", message: "Offline" });

    expect(state.phase).toBe("idle");
    expect(state.error).toBe("Offline");
    expect(isDirty(state)).toBe(true);
    expect(saveStatus(state)).toBe("error");
  });

  it("does not retry the exact draft the server rejected", () => {
    // Autosave re-arms whenever the state changes, and a failed save leaves the
    // draft dirty. Without this guard the editor sends the same rejected body
    // every interval for as long as the tab is open.
    let state = initialAutosaveState(EMPTY);
    state = edited(state, { title: "A" });
    state = autosaveReducer(state, { type: "save-start" });
    state = autosaveReducer(state, { type: "save-error", message: "Nope" });

    expect(shouldSave(state)).toBe(false);
    // An explicit ⌘S is a reason to try again.
    expect(canSaveNow(state)).toBe(true);
  });

  it("retries once the author changes something", () => {
    let state = initialAutosaveState(EMPTY);
    state = edited(state, { title: "A" });
    state = autosaveReducer(state, { type: "save-start" });
    state = autosaveReducer(state, { type: "save-error", message: "Nope" });

    state = edited(state, { title: "AB" });
    expect(shouldSave(state)).toBe(true);
  });

  it("still refuses to retry a draft edited back to the rejected one", () => {
    let state = initialAutosaveState(EMPTY);
    state = edited(state, { title: "A" });
    state = autosaveReducer(state, { type: "save-start" });
    state = autosaveReducer(state, { type: "save-error", message: "Nope" });

    state = edited(state, { title: "AB" });
    state = edited(state, { title: "A" });
    expect(shouldSave(state)).toBe(false);
  });

  it("clears the rejection once a save succeeds", () => {
    let state = initialAutosaveState(EMPTY);
    state = edited(state, { title: "A" });
    state = autosaveReducer(state, { type: "save-start" });
    state = autosaveReducer(state, { type: "save-error", message: "Nope" });
    state = edited(state, { title: "AB" });
    state = autosaveReducer(state, { type: "save-start" });
    state = autosaveReducer(state, { type: "save-ok", at: 5 });

    expect(state.failed).toBeNull();
    state = edited(state, { title: "ABC" });
    expect(shouldSave(state)).toBe(true);
  });

  it("clears a previous error when the next save starts", () => {
    let state = initialAutosaveState(EMPTY);
    state = edited(state, { title: "A" });
    state = autosaveReducer(state, { type: "save-start" });
    state = autosaveReducer(state, { type: "save-error", message: "Offline" });
    state = autosaveReducer(state, { type: "save-start" });

    expect(state.error).toBeNull();
    expect(saveStatus(state)).toBe("saving");
  });
});

describe("saveStatus", () => {
  it("has nothing to say before anything has been saved", () => {
    // The top bar shows the post's own status there instead; a save indicator
    // reading "Draft" on a published post said the opposite of the truth.
    expect(saveStatus(initialAutosaveState(EMPTY))).toBe("idle");
    expect(saveStatusLabel(initialAutosaveState(EMPTY))).toBe("");
  });

  it("prefers the error over every other state", () => {
    let state = initialAutosaveState(EMPTY);
    state = edited(state, { title: "A" });
    state = autosaveReducer(state, { type: "save-start" });
    state = autosaveReducer(state, { type: "save-ok", at: 1 });
    state = edited(state, { title: "B" });
    state = autosaveReducer(state, { type: "save-start" });
    state = autosaveReducer(state, { type: "save-error", message: "boom" });

    expect(saveStatusLabel(state)).toBe("Couldn't save");
  });

  it("says unsaved rather than saved once a saved draft is edited again", () => {
    let state = initialAutosaveState(EMPTY);
    state = edited(state, { title: "A" });
    state = autosaveReducer(state, { type: "save-start" });
    state = autosaveReducer(state, { type: "save-ok", at: 1 });
    expect(saveStatusLabel(state)).toBe("Saved");

    state = edited(state, { title: "AB" });
    expect(saveStatusLabel(state)).toBe("Unsaved changes");
  });
});

describe("draftsEqual", () => {
  it("compares every persisted field", () => {
    const base = draft({
      title: "T",
      slug: "s",
      excerpt: "e",
      contentMarkdown: "c",
    });
    expect(draftsEqual(base, { ...base })).toBe(true);
    expect(draftsEqual(base, { ...base, title: "U" })).toBe(false);
    expect(draftsEqual(base, { ...base, slug: "t" })).toBe(false);
    expect(draftsEqual(base, { ...base, excerpt: "f" })).toBe(false);
    expect(draftsEqual(base, { ...base, contentMarkdown: "d" })).toBe(false);
  });
});

describe("effectiveSlug", () => {
  it("derives from the title when the slug field is blank", () => {
    expect(effectiveSlug(draft({ title: "Hello There, World!" }))).toBe(
      "hello-there-world"
    );
  });

  it("prefers a typed slug and normalises its case and padding", () => {
    expect(effectiveSlug(draft({ title: "Ignored", slug: "  My-Slug  " }))).toBe(
      "my-slug"
    );
  });

  it("returns an empty slug for an empty title rather than inventing one", () => {
    expect(effectiveSlug(EMPTY)).toBe("");
  });
});

describe("wordCount", () => {
  it("counts prose words", () => {
    expect(wordCount("one two three")).toBe(3);
  });

  it("does not count Markdown syntax as words", () => {
    // The naive whitespace split scores this 8: `##`, `-` and `**` all count.
    expect(wordCount("## A heading\n\n- **bold** item\n- second item")).toBe(6);
  });

  it("does not count list numbering or task checkboxes", () => {
    expect(wordCount("1. first item\n2. second item")).toBe(4);
    expect(wordCount("- [ ] todo item\n- [x] done item")).toBe(4);
  });

  it("counts link text but not the URL", () => {
    expect(wordCount("see [the docs](https://example.com/deep/path)")).toBe(3);
  });

  it("ignores fenced code blocks", () => {
    expect(wordCount("intro text\n\n```\nconst x = 1;\n```\n\nafter")).toBe(3);
  });

  it("keeps hyphenated and apostrophised words whole", () => {
    expect(wordCount("well-known isn’t two")).toBe(3);
  });

  it("is zero for an empty body", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("   \n\n  ")).toBe(0);
  });
});

describe("isWorthSaving", () => {
  it("is false for an untouched draft, so opening the editor creates nothing", () => {
    expect(isWorthSaving(EMPTY)).toBe(false);
    expect(isWorthSaving(draft({ slug: "typed-a-slug-only" }))).toBe(false);
  });

  it("is true once there is a title or a body", () => {
    expect(isWorthSaving(draft({ title: "A" }))).toBe(true);
    expect(isWorthSaving(draft({ contentMarkdown: "A" }))).toBe(true);
  });

  it("ignores whitespace-only input", () => {
    expect(isWorthSaving(draft({ title: "   ", contentMarkdown: "\n\n" }))).toBe(
      false
    );
  });
});

describe("publishBlockers", () => {
  it("lists what is missing", () => {
    expect(publishBlockers(EMPTY)).toEqual(["Add a title", "Write something"]);
    expect(publishBlockers(draft({ title: "T" }))).toEqual(["Write something"]);
  });

  it("is empty for a publishable draft", () => {
    expect(
      publishBlockers(draft({ title: "T", contentMarkdown: "Body" }))
    ).toEqual([]);
  });
});
