import {
  ErrorEnvelope, MentorRequest, MentorRequestFormat,
  type CreateMentorRequest, type MentorDirectoryItem, type ProjectEmbedRef,
} from "@/lib/platform/contracts";
import { isSameOriginRequest } from "@/lib/agent-auth";
import { hasOpenSpot } from "@/lib/platform/client/mentor-directory";
import { requestFailure, validateRequestDraft, type RequestDraft, type ServerRequestForm } from "@/lib/platform/client/mentor-request-form";
import { boundedForm } from "@/components/platform/onboarding/welcome-flow";

/**
 * Asking for time without JavaScript (U-4.1). The request drawer is a real
 * form: with JavaScript the island sends it to the API itself; without, it
 * posts here, to the directory page, which hands the same body to the API's
 * own handler (B-4.1's `mentoringRequest`), so every gate, check and notice
 * is the API's. The person then lands back on the directory: with the request
 * under Your requests, or with the drawer open again on what they wrote and
 * why it didn't go through.
 */

/** The form field that marks this post as a mentor request, so the page can carry the conduct form too. */
export const REQUEST_INTENT = "mentor-request";

/** A project radio's value: the work and the revision it was offered at. */
export const projectValue = (ref: Pick<ProjectEmbedRef, "journeyId" | "version">) => `${ref.journeyId}@${ref.version}`;

export type RequestPostResult =
  | { kind: "redirect"; location: string }
  | { kind: "render"; status: number; mentorId: string; form: ServerRequestForm }
  | { kind: "refuse"; status: 400 | 403 | 413 };

export interface RequestPostOptions {
  /** Listed mentors, as the page read them: the drawer can only ask one of these. */
  mentors: readonly MentorDirectoryItem[];
  /** Sends the JSON body through the API's own handler, as `POST /api/mentor-requests` would. */
  send: (body: CreateMentorRequest) => Promise<Response>;
  /** Where to land once sent, naming the new request. */
  sent: (requestId: string) => string;
}

function readProject(value: FormDataEntryValue | null): ProjectEmbedRef | null {
  if (typeof value !== "string" || value === "") return null;
  const match = /^(.{1,255})@([1-9]\d{0,8})$/.exec(value);
  return match ? { type: "project", journeyId: match[1]!, version: Number(match[2]) } : null;
}

function readDraft(form: FormData): RequestDraft {
  const note = form.get("note");
  const format = MentorRequestFormat.safeParse(form.get("format"));
  return {
    note: typeof note === "string" ? note.slice(0, 4_000) : "",
    project: readProject(form.get("project")),
    format: format.success ? format.data : null,
  };
}

/** Whether this post is a mentor request (and not, say, the conduct form). Reads a copy of the body. */
export async function isRequestPost(request: Request): Promise<boolean> {
  if (request.method !== "POST") return false;
  const form = await boundedForm(request.clone() as Request);
  return form?.get("intent") === REQUEST_INTENT;
}

/**
 * Handles a mentor request posted from the drawer without JavaScript. The caller has already
 * checked that `mentor_requests` is on and that this is a person's browser session.
 */
export async function handleRequestPost(request: Request, options: RequestPostOptions): Promise<RequestPostResult> {
  if (!isSameOriginRequest(request)) return { kind: "refuse", status: 403 };
  const form = await boundedForm(request);
  if (!form) return { kind: "refuse", status: 413 };
  if (form.get("intent") !== REQUEST_INTENT) return { kind: "refuse", status: 400 };
  const mentorId = form.get("mentorId");
  const mentor = typeof mentorId === "string" ? options.mentors.find((item) => item.person.id === mentorId) : undefined;
  if (!mentor || typeof mentorId !== "string") return { kind: "refuse", status: 400 };
  const draft = readDraft(form);
  const render = (status: number, rest: Omit<ServerRequestForm, keyof RequestDraft>): RequestPostResult =>
    ({ kind: "render", status, mentorId, form: { ...draft, ...rest } });

  if (!hasOpenSpot(mentor)) return render(409, { status: "error", errors: {}, failure: "conflict" });
  const checked = validateRequestDraft(draft, mentor);
  if (!checked.ok) return render(400, { status: "editing", errors: checked.errors, failure: null });

  const response = await options.send({ mentorId, note: checked.note, project: draft.project, format: checked.format });
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const created = MentorRequest.safeParse(body);
    return created.success ? { kind: "redirect", location: options.sent(created.data.id) } : render(500, { status: "error", errors: {}, failure: "other" });
  }
  const envelope = ErrorEnvelope.safeParse(body);
  const code = envelope.success ? envelope.data.error.code : "server";
  if (code === "conduct_required") return render(403, { status: "conduct", errors: {}, failure: null });
  const message = envelope.success ? envelope.data.error.message : undefined;
  return render(response.status, { status: "error", errors: {}, failure: requestFailure({ status: response.status, code, message }) });
}
