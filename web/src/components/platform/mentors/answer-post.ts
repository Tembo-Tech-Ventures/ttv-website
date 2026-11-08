import { ErrorEnvelope, type MentorRequest } from "@/lib/platform/contracts";
import { isSameOriginRequest } from "@/lib/agent-auth";
import { movedText } from "@/lib/platform/client/mentor-requests";
import { boundedForm } from "@/components/platform/onboarding/welcome-flow";
import {
  CHOOSE_MENTOR, DIDNT_GO_THROUGH, FIX_AND_SEND, isAnswerIntent, NOTE_MAX, REPORT_REQUIRED, suggestField,
  type AnswerIntent, type AnswerPanel, type ServerAnswer,
} from "./answer-fields";

/**
 * A mentor's answers without JavaScript (U-4.1, screen 06). Accept, a
 * suggestion, "Not this month" and a report are real forms: with JavaScript
 * the queue's island sends each to the API itself; without, they post here, to
 * the Requests page, which hands the same body to the API's own handler
 * (B-4.1's `mentoringRequest`), so every gate and notice is the API's. The
 * mentor then lands back on the queue with what happened, or with the panel
 * open again on what they wrote and why it didn't go through.
 */

/** The JSON body each answer's API route takes, as the island's store sends it. */
export type AnswerBody = Record<string, never> | { mentorId: string; note?: string } | { note?: string } | { reason: string };

/** An answer the API (or the page, for a field to fix) refused, before the page has read the request again. */
export type PostedAnswer = Omit<ServerAnswer, "failure"> & { status: number; code: string; message: string | null };

export type AnswerPostResult =
  | { kind: "redirect"; location: string }
  | { kind: "render"; status: number; answer: PostedAnswer }
  | { kind: "refuse"; status: 400 | 403 | 413 };

export interface AnswerPostOptions {
  /** Sends the body through the API's own handler, as `POST /api/mentor-requests/:id/<move>` would. */
  send: (intent: AnswerIntent, requestId: string, body: AnswerBody) => Promise<Response>;
  /** Where to land once answered, naming the request. */
  answered: (requestId: string) => string;
}

const PANEL: Record<AnswerIntent, AnswerPanel | null> = { accept: null, redirect: "suggest", decline: "decline", report: "report" };

const text = (value: FormDataEntryValue | null) => typeof value === "string" ? value.slice(0, NOTE_MAX * 2) : "";

/**
 * Handles an answer posted from the queue without JavaScript. The caller has already checked that
 * `mentor_requests` is on and that this is the mentor's own page; the API decides the rest.
 */
export async function handleAnswerPost(request: Request, options: AnswerPostOptions): Promise<AnswerPostResult> {
  if (!isSameOriginRequest(request)) return { kind: "refuse", status: 403 };
  const form = await boundedForm(request);
  if (!form) return { kind: "refuse", status: 413 };
  const intent = form.get("intent");
  const requestId = form.get("requestId");
  if (!isAnswerIntent(intent) || typeof requestId !== "string" || requestId === "" || requestId.length > 255) {
    return { kind: "refuse", status: 400 };
  }
  // A report's reason and an answer's note are one field each; the panel shows whichever was written.
  const note = text(form.get(intent === "report" ? "reason" : "note"));
  const chosen = form.get(suggestField(requestId));
  const mentorId = typeof chosen === "string" && chosen !== "" ? chosen : null;
  const render = (status: number, rest: { code: string; message: string | null; error: string | null }): AnswerPostResult => ({
    kind: "render", status, answer: { requestId, panel: PANEL[intent], note, mentorId, status, ...rest },
  });

  let body: AnswerBody;
  const withNote = note.trim() ? { note: note.trim() } : {};
  switch (intent) {
    case "accept": body = {}; break;
    case "decline": body = withNote; break;
    case "redirect":
      if (!mentorId) return render(400, { code: "validation", message: null, error: CHOOSE_MENTOR });
      body = { mentorId, ...withNote };
      break;
    case "report":
      if (!note.trim()) return render(400, { code: "validation", message: null, error: REPORT_REQUIRED });
      body = { reason: note.trim() };
      break;
  }

  const response = await options.send(intent, requestId, body);
  if (response.ok) return { kind: "redirect", location: options.answered(requestId) };
  const envelope = ErrorEnvelope.safeParse(await response.json().catch(() => null));
  return render(response.status, {
    code: envelope.success ? envelope.data.error.code : "server",
    message: envelope.success ? envelope.data.error.message : null,
    error: null,
  });
}

/**
 * The refused answer as the page shows it, once it has read the request again: a request that has moved
 * on meanwhile (the person withdrew while the mentor read) says what happened instead and opens no panel;
 * otherwise the panel opens again on what was written, with the API's own sentence when it is one the
 * mentor can act on ("Suggest another mentor who is taking requests"), and fixed words when it is not.
 */
export function settleAnswer(posted: PostedAnswer, request: MentorRequest | undefined): ServerAnswer {
  const { status: _status, code, message, ...answer } = posted;
  if (answer.error) return { ...answer, failure: FIX_AND_SEND };
  if (request && request.status !== "PENDING") return { ...answer, panel: null, failure: movedText(request.requester.name, request.status) };
  if (request?.check === "reported") return { ...answer, panel: null, failure: message ?? DIDNT_GO_THROUGH };
  const actionable = (code === "validation" || code === "conflict") && message?.trim() ? message : null;
  return { ...answer, failure: actionable ?? DIDNT_GO_THROUGH };
}
