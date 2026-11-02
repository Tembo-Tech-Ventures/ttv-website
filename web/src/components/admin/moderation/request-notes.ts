import {
  Cursor, ErrorEnvelope, MentorRequestCase, MentorRequestCaseAction, MentorRequestCaseList, MentorRequestCaseState,
  type DecideMentorRequestCase, type MentorCapacity, type MentorRequestCaseQuery,
} from "@/lib/platform/contracts";
import { boundedForm } from "@/components/platform/onboarding/welcome-flow";
import { firstName } from "./case-model";
import { REASON_MAX } from "./decision-form";

/*
 * The "Request notes" tab of /admin/moderation (U-4.1 on B-4.1's checks; src/lib/mentoring/README.md,
 * "Checks"): mentor requests whose note Tembo's check held before the mentor saw it, or that the mentor
 * reported. An admin keeps one (it goes, or goes back, to its mentor as it is) or removes it (it closes;
 * the person asking reads "This request wasn't sent" or "This request was closed"). Plain form posts.
 *
 * The page hands every read and decision to the API's own handler (`/api/moderation/mentor-requests`),
 * so the flag, the admin check, same-origin, the "not your own request" rule and the notice a keep sends
 * are all B-4.1's. This module reads the address and the form and says what to render.
 */

export const REQUEST_NOTES_TAB = "request-notes";
export const REQUEST_NOTES_LABEL = "Request notes";

/**
 * Which list /admin/moderation shows: Request notes only while `mentor_requests` is on for this admin and
 * the address asks for it; otherwise the message queue, whatever `?tab=` says.
 */
export function moderationView(search: URLSearchParams, requestNotesOn: boolean): "request-notes" | "queue" {
  return requestNotesOn && search.get("tab") === REQUEST_NOTES_TAB ? "request-notes" : "queue";
}

/** The message queue's link to Request notes: none while `mentor_requests` is off. */
export function requestNotesLink(requestNotesOn: boolean, paths: Pick<RequestNotesPaths, "tab">): string | undefined {
  return requestNotesOn ? paths.tab("OPEN") : undefined;
}

/** Sends to the API's own handler, as GET /api/moderation/mentor-requests and POST …/:id would. */
export interface RequestNotesSource {
  list(query: MentorRequestCaseQuery): Promise<Response>;
  decide(requestId: string, body: DecideMentorRequestCase): Promise<Response>;
}

export interface RequestNotesPaths {
  tab(state: MentorRequestCaseState): string;
  page(state: MentorRequestCaseState, cursor: string): string;
  decided(action: MentorRequestCaseAction): string;
}

export interface RequestNotesViewProps {
  state: MentorRequestCaseState;
  items: MentorRequestCase[];
  formAction: string;
  tabHrefs: Record<MentorRequestCaseState, string>;
  nextHref: string | null;
  paged: boolean;
  notice?: string;
  failure?: string;
  rowError?: { id: string; message: string; draft: string };
}

export type RequestNotesOutcome =
  | { kind: "redirect"; location: string }
  | { kind: "page"; status: number; props: RequestNotesViewProps };

export const DECIDED_NOTE_NOTICE: Record<MentorRequestCaseAction, string> = {
  keep: "Kept. The request is with its mentor, as it was written.",
  remove: "Removed. The request is closed; the person who asked sees that, never who raised it.",
};

type ParsedDecision =
  | { ok: true; requestId: string; action: MentorRequestCaseAction; reason: string }
  | { ok: false; requestId?: string; reason: string; error: string };

function parseDecision(form: FormData): ParsedDecision {
  const requestId = form.get("requestId");
  const id = typeof requestId === "string" && requestId.length > 0 && requestId.length <= 255 ? requestId : undefined;
  const raw = form.get("reason");
  const reason = typeof raw === "string" ? raw.trim().slice(0, REASON_MAX) : "";
  const action = MentorRequestCaseAction.safeParse(form.get("action"));
  if (!id) return { ok: false, reason, error: "That decision didn't say which request it was for. Nothing changed." };
  if (!action.success) return { ok: false, requestId: id, reason, error: "Choose keep or remove. Nothing changed." };
  if (!reason) return { ok: false, requestId: id, reason, error: "Say why, for the record. Nothing changed." };
  return { ok: true, requestId: id, action: action.data, reason };
}

async function refusal(response: Response): Promise<string> {
  const envelope = ErrorEnvelope.safeParse(await response.json().catch(() => null));
  const why = envelope.success ? envelope.data.error.message : "The decision wasn't saved.";
  return `${why} Nothing changed.`;
}

export async function requestNotesRequest(
  request: Request, url: URL, source: RequestNotesSource, paths: RequestNotesPaths,
): Promise<RequestNotesOutcome> {
  const search = url.searchParams;
  const state = MentorRequestCaseState.safeParse(search.get("state")).data ?? "OPEN";
  const cursor = Cursor.safeParse(search.get("cursor")).data;
  const formAction = cursor ? paths.page(state, cursor) : paths.tab(state);
  let status = 200;
  let failure: string | undefined;
  let rowError: RequestNotesViewProps["rowError"];

  if (request.method === "POST") {
    const form = await boundedForm(request);
    const parsed: ParsedDecision = form ? parseDecision(form) : { ok: false, reason: "", error: "That form was too large. Nothing changed." };
    if (!parsed.ok) {
      status = 400;
      if (parsed.requestId) rowError = { id: parsed.requestId, message: parsed.error, draft: parsed.reason };
      else failure = parsed.error;
    } else {
      const response = await source.decide(parsed.requestId, { action: parsed.action, reason: parsed.reason });
      if (response.ok) return { kind: "redirect", location: paths.decided(parsed.action) };
      status = response.status;
      rowError = { id: parsed.requestId, message: await refusal(response), draft: parsed.reason };
    }
  }

  const listed = await source.list({ state, ...(cursor ? { cursor } : {}) });
  // A stale or forged cursor: start the tab again.
  if (listed.status === 400 && cursor) return { kind: "redirect", location: paths.tab(state) };
  if (!listed.ok) throw new Error(`Request notes could not be read (${listed.status})`);
  const page = MentorRequestCaseList.parse(await listed.json());
  if (rowError && !page.items.some((item) => item.id === rowError?.id)) {
    failure = rowError.message;
    rowError = undefined;
  }
  const decided = request.method === "GET" ? MentorRequestCaseAction.safeParse(search.get("decided")).data : undefined;

  return {
    kind: "page",
    status,
    props: {
      state,
      items: page.items.map((item) => MentorRequestCase.parse(item)),
      formAction,
      tabHrefs: { OPEN: paths.tab("OPEN"), DECIDED: paths.tab("DECIDED") },
      nextHref: page.nextCursor ? paths.page(state, page.nextCursor) : null,
      paged: Boolean(cursor),
      notice: decided && !failure ? DECIDED_NOTE_NOTICE[decided] : undefined,
      failure,
      rowError,
    },
  };
}

/** The tab's own addresses, under the moderation page. */
export function requestNotesPaths(base: string): RequestNotesPaths {
  const at = (query: Record<string, string>) => `${base}?${new URLSearchParams({ tab: REQUEST_NOTES_TAB, ...query })}`;
  const stateQuery = (state: MentorRequestCaseState): Record<string, string> => (state === "OPEN" ? {} : { state });
  return {
    tab: (state) => at(stateQuery(state)),
    page: (state, cursor) => at({ ...stateQuery(state), cursor }),
    decided: (action) => at({ decided: action }),
  };
}

/** What brought a request here, in an admin's words. Admins see who reported it; nobody else does. */
export function caseCause(item: Pick<MentorRequestCase, "clefReasons" | "report" | "request">): string {
  const mentor = firstName(item.request.mentor.name);
  if (item.report) return `${mentor} reported it after reading it.`;
  return `Tembo's check held it before ${mentor} saw it: ${item.clefReasons.join(", ")}.`;
}

/** "1 request note waiting for a check", "3 request notes waiting for a check". */
export function requestNotesWaitingText(count: number): string {
  return `${count} ${count === 1 ? "request note" : "request notes"} waiting for a check`;
}

/**
 * Admin Home's line for Request notes (QA4-04): only while the tab exists for this admin
 * (`channels` and `mentor_requests` on) and something waits in it.
 */
export function requestNotesAttention(count: number, on: boolean, paths: Pick<RequestNotesPaths, "tab">): { text: string; href: string } | null {
  return on && count > 0 ? { text: requestNotesWaitingText(count), href: paths.tab("OPEN") } : null;
}

const spots = (count: number) => `${count} ${count === 1 ? "spot" : "spots"}`;

/** "David has used 2 of 3 spots this month.", or that he is full. Nothing once he has no availability saved. */
function capacityLine(mentor: string, capacity: MentorCapacity | null): string | null {
  if (!capacity) return null;
  if (capacity.used < capacity.limit) return `${mentor} has used ${capacity.used} of ${spots(capacity.limit)} this month.`;
  return capacity.limit === 0 ? `${mentor} has no spots this month.` : `${mentor} is full this month: ${capacity.used} of ${spots(capacity.limit)} used.`;
}

/** The two choices on an open check, each with what it does, so neither is a guess (QA4-10). */
export interface RequestNoteChoices {
  keepLabel: string;
  removeLabel: string;
  /** What keeping does, the mentor's spots included. */
  keep: string;
  /** What removing does for the person asking; null when it changes nothing (they withdrew it). */
  remove: string | null;
}

/**
 * What keep and remove mean for this request. A keep takes one of the mentor's spots this month,
 * even when they are full (B-4.1: a held or reported request holds none until then). A request the
 * mentor reported goes back to them; one Tembo's check held is sent for the first time. Removing
 * closes it, and the person asking reads what their own list says (mentor-display's checks), never
 * who raised it, and may ask again. A reported request its asker withdrew stays withdrawn either way.
 */
export function requestNoteChoices(item: Pick<MentorRequestCase, "request" | "report" | "mentorCapacity">): RequestNoteChoices {
  const mentor = firstName(item.request.mentor.name);
  const asker = firstName(item.request.requester.name);
  if (item.request.status !== "PENDING") {
    return {
      keepLabel: "Keep", removeLabel: "Remove",
      keep: `${asker} withdrew this request, so it stays closed whichever you choose. Your decision is kept for the record.`,
      remove: null,
    };
  }
  const capacity = item.mentorCapacity;
  const full = Boolean(capacity && capacity.used >= capacity.limit);
  const sends = item.report ? `sends it back to ${mentor} to answer` : `sends it to ${mentor} as it was written`;
  const keep = capacity ? `Keeping ${full ? "still " : ""}${sends} and takes a spot.` : `Keeping ${sends}.`;
  const seen = item.report ? "“This request was closed”" : "“This request wasn't sent”";
  return {
    keepLabel: item.report ? `Keep: back to ${mentor}` : `Keep: send it to ${mentor}`,
    removeLabel: "Remove: close it",
    keep: [capacityLine(mentor, capacity), keep].filter(Boolean).join(" "),
    remove: `Removing closes it${item.report ? "" : `, and ${mentor} never sees it`}. ${asker} sees ${seen} and can ask again with a new note.`,
  };
}

/**
 * Where a decided request stands now (QA4-21): the decision and, after a keep, what happened next.
 * "Kept: sent to David", "Kept: David accepted it", "Removed: not sent".
 */
export function decidedStatus(item: Pick<MentorRequestCase, "request" | "report" | "decision">): string | null {
  if (!item.decision) return null;
  const mentor = firstName(item.request.mentor.name);
  if (item.decision.action === "remove") return item.report ? "Removed: closed" : "Removed: not sent";
  switch (item.request.status) {
    case "PENDING": return item.report ? `Kept: back with ${mentor}` : `Kept: sent to ${mentor}`;
    case "ACCEPTED": return `Kept: ${mentor} accepted it`;
    case "REDIRECTED": return `Kept: ${mentor} suggested another mentor`;
    case "DECLINED": return `Kept: ${mentor} said not this month`;
    case "WITHDRAWN": return `Kept: ${firstName(item.request.requester.name)} withdrew it`;
  }
}
