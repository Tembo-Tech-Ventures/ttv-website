/**
 * Confirm work (/dashboard/mentoring/confirm) as plain forms (style-guide rollout M17, D5): what a
 * mentor posts there, checked, then sent to the community API's own handlers in process
 * (`communityFetch`), so the API's mentor, revision and origin checks stay exactly those the island
 * relied on. A refusal keeps what the mentor wrote; success is a flash after a 303.
 */
import {
  confirmContribution,
  loadMentorship,
  setAsideContribution,
  undoSetAside,
} from "@/components/community/community-client";
import type { MentorReviewRequest } from "@/components/community/MentorReview";
import { UiApiError } from "@/components/discovery/ui-errors";
import type { Flash } from "@/lib/platform/server/flash";

export type ConfirmIntent = "confirm" | "set-aside" | "undo";

export interface ConfirmPost {
  intent: ConfirmIntent;
  id: string;
  /** The revision the mentor read: a newer one is refused (409) rather than confirmed unseen. */
  expectedRevision: number;
  /** For the contribution's own name in what the page says back. */
  title: string;
  note: string;
  method: string;
}

/** What a refused confirmation keeps, and says under each field. */
export interface ConfirmKept {
  id: string;
  note: string;
  method: string;
  errors: { note?: string; method?: string };
}

export type ConfirmOutcome =
  | { ok: true; flash: Flash }
  | { ok: false; status: number; title: string; detail: string; kept: ConfirmKept | null };

const INTENTS: readonly ConfirmIntent[] = ["confirm", "set-aside", "undo"];

export function validateMentorNote(note: string): string | null {
  const text = note.trim();
  if (text.length < 20 || text.split(/\s+/u).length < 3) {
    return "Describe what you personally checked in at least 20 characters and three words.";
  }
  if (text.length > 2000) return "Keep your review note within 2,000 characters.";
  return null;
}

export function validateMentorMethod(method: string): string | null {
  const length = method.trim().length;
  return length < 3 || length > 500 ? "Describe how you checked it in 3 to 500 characters." : null;
}

/** The form's fields, or null when it isn't one of this page's forms. */
export function readConfirmPost(form: FormData): ConfirmPost | null {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const intent = INTENTS.find((candidate) => candidate === text("intent"));
  const id = text("id").trim();
  const expectedRevision = Number(text("revision"));
  if (!intent || !id || id.length > 200 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return null;
  return {
    intent,
    id,
    expectedRevision,
    title: text("title").trim().slice(0, 200) || "This contribution",
    note: text("note").slice(0, 4000),
    method: text("method").slice(0, 1000),
  };
}

const CHANGED = {
  title: "This contribution changed since you opened it",
  detail: "Review its latest revision below before confirming. What you wrote is kept.",
};

/** Runs one posted action through the community API, in process. */
export async function runConfirmPost(post: ConfirmPost, fetcher: typeof fetch): Promise<ConfirmOutcome> {
  if (post.intent === "confirm") {
    const errors = {
      ...(validateMentorMethod(post.method) ? { method: validateMentorMethod(post.method)! } : {}),
      ...(validateMentorNote(post.note) ? { note: validateMentorNote(post.note)! } : {}),
    };
    const kept: ConfirmKept = { id: post.id, note: post.note, method: post.method, errors };
    if (errors.note || errors.method) {
      return { ok: false, status: 400, title: "Your confirmation wasn't saved", detail: "Fix the fields marked below. What you wrote is kept.", kept };
    }
    try {
      await confirmContribution(
        post.id,
        { decision: "confirmed", note: post.note.trim(), method: post.method.trim(), expectedRevision: post.expectedRevision },
        fetcher,
      );
      return { ok: true, flash: { tone: "success", title: `Confirmed: ${post.title}` } };
    } catch (failure) {
      return refused(failure, kept, "Your confirmation wasn't saved");
    }
  }
  try {
    if (post.intent === "set-aside") {
      await setAsideContribution(post.id, post.expectedRevision, fetcher);
      return { ok: true, flash: { tone: "success", title: `You've set aside ${post.title}`, message: "Only you see this. The member isn't told." } };
    }
    await undoSetAside(post.id, fetcher);
    return { ok: true, flash: { tone: "success", title: `${post.title} is back in your waiting list` } };
  } catch (failure) {
    return refused(failure, null, post.intent === "set-aside" ? "This wasn't set aside" : "This wasn't put back");
  }
}

function refused(failure: unknown, kept: ConfirmKept | null, title: string): ConfirmOutcome {
  const status = failure instanceof UiApiError ? failure.status : 503;
  if (status === 409) return { ok: false, status, ...CHANGED, kept };
  // Anything the API answers that isn't the mentor's to fix reads as a service failure.
  const ours = status === 400 || status === 403 || status === 404;
  return {
    ok: false,
    status: ours ? status : 503,
    title,
    detail: failure instanceof UiApiError && ours ? failure.message : "That didn't save, through no fault of yours. Try again in a moment.",
    kept,
  };
}

/** The contributions, split as the page shows them: waiting or confirmed, and set aside. */
export function splitContributions(requests: readonly MentorReviewRequest[]) {
  const setAside = requests.filter((request) => request.setAside);
  const listed = requests.filter((request) => !request.setAside);
  const waiting = listed.filter((request) => request.status === "pending").length;
  return { listed, setAside, waiting };
}

export { loadMentorship };
