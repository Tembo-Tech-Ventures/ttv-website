/*
 * A mentor's answers as forms (U-4.1, screen 06): the field names the queue's
 * forms write and answer-post.ts reads, and the words both sides say. Kept
 * apart from answer-post.ts, so the queue's island ships the names without the
 * server's post handling, and without zod.
 */

/** What a posted answer does: each is one of the API's moves on a waiting request. */
const ANSWER_INTENTS = ["accept", "redirect", "decline", "report"] as const;
export type AnswerIntent = (typeof ANSWER_INTENTS)[number];

export function isAnswerIntent(value: unknown): value is AnswerIntent {
  return (ANSWER_INTENTS as readonly unknown[]).includes(value);
}

/** The answers that open a panel first: suggesting another mentor, "Not this month" and a report. */
export type AnswerPanel = "suggest" | "decline" | "report";

export function isAnswerPanel(value: unknown): value is AnswerPanel {
  return value === "suggest" || value === "decline" || value === "report";
}

/** Without JavaScript a panel opens through the page's URL: `?request=<id>&answer=decline`. */
export const REQUEST_PARAM = "request";
export const PANEL_PARAM = "answer";
/** After an answer posted without JavaScript, the page names the request it answered: `?answered=<id>`. */
export const ANSWERED_PARAM = "answered";

/** A request's heading, which a panel's link lands on and every answer names. */
export const requestAnchor = (requestId: string) => `request-${requestId}`;

/**
 * The suggestion's radios, one group per request: the kit gives each radio the id `name-value`, so two
 * suggestion panels open with JavaScript would otherwise share ids.
 */
export const suggestField = (requestId: string) => `suggest-${requestId}`;

/** How much a note or a report may say: the API's limit. */
export const NOTE_MAX = 2000;

export const REPORT_REQUIRED = "Say what's wrong with this request, so TTV knows what to check.";
export const CHOOSE_MENTOR = "Choose a mentor to suggest.";
export const DIDNT_GO_THROUGH = "That didn't go through, so nothing changed. Try again.";
export const FIX_AND_SEND = "Your answer wasn't sent. Fix what's marked, then send it again.";

/** An answer posted without JavaScript that did not go through, as the page renders it again. */
export interface ServerAnswer {
  requestId: string;
  /** The panel to open again on what was written; null for Accept, or a request that has moved on. */
  panel: AnswerPanel | null;
  note: string;
  mentorId: string | null;
  /** The field's own error: a report with no reason, a suggestion with no mentor. */
  error: string | null;
  /** The danger notice's words. */
  failure: string;
}
