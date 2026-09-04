/**
 * Autosave bookkeeping for the post editor, kept out of React so it can be
 * tested without a DOM.
 *
 * The whole point of this module is one race: an author keeps typing while a
 * save is in flight. If a successful response simply marked the editor clean,
 * every keystroke made during the request would be silently discarded — the UI
 * would say "Saved" while holding unsaved text. So a save records the exact
 * snapshot it sent (`inFlight`) and, on success, only that snapshot becomes the
 * new baseline. Anything typed since stays dirty and schedules another save.
 */
import { slugifyTitle } from "@/lib/blog/slug";

export interface PostDraft {
  title: string;
  /** What the author typed in the slug field. Blank means "derive from title". */
  slug: string;
  excerpt: string;
  contentMarkdown: string;
}

export interface AutosaveState {
  /** The draft the server is known to hold. */
  saved: PostDraft;
  /** The draft the editor currently holds. */
  current: PostDraft;
  phase: "idle" | "saving";
  /**
   * The snapshot the in-flight request carries. Held separately from `current`
   * because `current` moves while the request is open.
   */
  inFlight: PostDraft | null;
  /** Epoch ms of the last successful save, for the "Saved" timestamp. */
  savedAt: number | null;
  /** Message from the last failed save, cleared when the next one starts. */
  error: string | null;
  /**
   * The snapshot a save was rejected for.
   *
   * Autosave re-arms on every state change, and a failed save leaves the draft
   * dirty — so without remembering what failed, a server that says no produces
   * a request every autosave interval for as long as the tab is open. Editing
   * anything moves `current` away from this and the retry is allowed again.
   */
  failed: PostDraft | null;
}

export type AutosaveEvent =
  | { type: "edit"; draft: PostDraft }
  | { type: "save-start" }
  | { type: "save-ok"; at: number }
  | { type: "save-error"; message: string };

export function initialAutosaveState(draft: PostDraft): AutosaveState {
  return {
    saved: draft,
    current: draft,
    phase: "idle",
    inFlight: null,
    savedAt: null,
    error: null,
    failed: null,
  };
}

export function draftsEqual(a: PostDraft, b: PostDraft): boolean {
  return (
    a.title === b.title &&
    a.slug === b.slug &&
    a.excerpt === b.excerpt &&
    a.contentMarkdown === b.contentMarkdown
  );
}

export function autosaveReducer(
  state: AutosaveState,
  event: AutosaveEvent
): AutosaveState {
  switch (event.type) {
    case "edit":
      if (draftsEqual(state.current, event.draft)) return state;
      return { ...state, current: event.draft };

    case "save-start":
      // Guarded rather than assumed: two overlapping requests would race to
      // set the baseline, and the loser would move it backwards.
      if (state.phase === "saving") return state;
      return {
        ...state,
        phase: "saving",
        inFlight: state.current,
        error: null,
        failed: null,
      };

    case "save-ok":
      return {
        ...state,
        // The snapshot that was sent — not `current`, which may have moved on.
        saved: state.inFlight ?? state.saved,
        phase: "idle",
        inFlight: null,
        savedAt: event.at,
        error: null,
        failed: null,
      };

    case "save-error":
      return {
        ...state,
        phase: "idle",
        inFlight: null,
        error: event.message,
        failed: state.inFlight,
      };
  }
}

export function isDirty(state: AutosaveState): boolean {
  return !draftsEqual(state.saved, state.current);
}

/**
 * Whether a save should be started now.
 *
 * Dirty is not enough. While a request is open the next one waits for it, and
 * a draft the server has already rejected waits for an edit — retrying the
 * identical body on a timer would hammer a server that has said no.
 */
export function shouldSave(state: AutosaveState): boolean {
  if (state.phase !== "idle" || !isDirty(state)) return false;
  return state.failed === null || !draftsEqual(state.failed, state.current);
}

/**
 * Whether an explicit save — ⌘S — has anything to do. Unlike `shouldSave` this
 * ignores the rejected-draft guard: asking for a retry by hand is a reason to
 * try again.
 */
export function canSaveNow(state: AutosaveState): boolean {
  return state.phase === "idle" && isDirty(state);
}

export type SaveStatus = "error" | "saving" | "unsaved" | "saved" | "idle";

export function saveStatus(state: AutosaveState): SaveStatus {
  if (state.error) return "error";
  if (state.phase === "saving") return "saving";
  if (isDirty(state)) return "unsaved";
  if (state.savedAt !== null) return "saved";
  return "idle";
}

const STATUS_LABELS: Record<SaveStatus, string> = {
  error: "Couldn't save",
  saving: "Saving…",
  unsaved: "Unsaved changes",
  saved: "Saved",
  // Nothing has been saved this session and nothing is pending. The editor
  // shows the post's own status instead of inventing a save state.
  idle: "",
};

export function saveStatusLabel(state: AutosaveState): string {
  return STATUS_LABELS[saveStatus(state)];
}

/**
 * The slug a post will actually get: what the author typed, or the title
 * slugified. Mirrors `savePost`, which applies the same fallback server-side —
 * the panel shows the result rather than an empty field the author has to
 * mentally resolve.
 */
export function effectiveSlug(draft: PostDraft): string {
  const manual = draft.slug.trim().toLowerCase();
  return manual || slugifyTitle(draft.title);
}

/**
 * Words in the body, for the live counter.
 *
 * Deliberately not `estimateReadingMinutes`'s split: that counts every
 * whitespace-separated token, so `##`, `-` and the `1.` of an ordered list all
 * score as words. A counter sitting next to the prose has to match what the
 * author can see, so the syntax is stripped first and a word is then required
 * to begin with a letter or digit — which is what keeps `well-known` one word
 * while a bare list bullet is none.
 */
export function wordCount(markdown: string): number {
  const matches = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*>+/gm, " ")
    .replace(/^\s*#{1,6}\s/gm, " ")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/gm, " ")
    .replace(/[#>*_`~[\]()|]/g, " ")
    .match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}

/** Whether the draft has enough in it to be worth persisting at all. */
export function isWorthSaving(draft: PostDraft): boolean {
  return draft.title.trim().length > 0 || draft.contentMarkdown.trim().length > 0;
}

/**
 * Publishing needs a title and a body; the panel says so up front instead of
 * letting the author press Publish and collect a server-side validation error.
 */
export function publishBlockers(draft: PostDraft): string[] {
  const blockers: string[] = [];
  if (!draft.title.trim()) blockers.push("Add a title");
  if (!draft.contentMarkdown.trim()) blockers.push("Write something");
  return blockers;
}
