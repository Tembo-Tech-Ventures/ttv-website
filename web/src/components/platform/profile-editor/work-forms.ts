import { isSameOriginRequest } from "@/lib/agent-auth";
import { boundedForm } from "@/components/platform/onboarding/welcome-flow";
import type { JourneyClaim } from "@/components/discovery/types";
import type { CommunityWrite } from "@/components/community/home/home-data";
import { confirmHref, withoutConfirm } from "@/components/platform/ui/confirm";
import { NOT_SAVED, SAVED } from "./copy";

/**
 * Posting work from the profile editor, without JavaScript: a new piece of work, its next revision,
 * moving it between posted and draft, and deleting it. Each form is read here, explained field by
 * field before the API would have to refuse it, and sent as the JSON body `/api/community/journey`
 * takes, through the API's own handler (`send`), so its sign-in, origin, scope, moderation and
 * validation checks stay the API's. The limits mirror lib/community/model.ts. GitHub repositories
 * are the RepoPicker's (POST/PUT /api/portfolio/highlights), never these forms'.
 */
export const EDITOR_PATH = "/dashboard/me/portfolio";
export const WORK_EDITOR_ID = "work-editor";
export const PROFILE_FORM_ID = "profile-form";

/** Only for building the editor's own paths: never part of a link. */
const ORIGIN = "https://ttv.invalid";
const ADD_PARAM = "add";
const EDIT_PARAM = "edit";

/** The links that open the work editor: plain GETs, so they work without a script. */
export const addWorkHref = () => `${EDITOR_PATH}?${ADD_PARAM}=1#${WORK_EDITOR_ID}`;
export const editWorkHref = (claim: Pick<JourneyClaim, "id">) =>
  `${EDITOR_PATH}?${EDIT_PARAM}=${encodeURIComponent(claim.id)}#${WORK_EDITOR_ID}`;
export const profileFormHref = () => `${EDITOR_PATH}#${PROFILE_FORM_ID}`;
/** The confirm step's action for deleting one piece of work, and the link that asks for it. */
export const deleteAction = (claim: Pick<JourneyClaim, "id">) => `delete-${claim.id}`;
export const confirmDeleteHref = (claim: Pick<JourneyClaim, "id">) => confirmHref(new URL(EDITOR_PATH, ORIGIN), deleteAction(claim));
/** Coming off the public website: its confirm step's action and the link that asks for it. */
export const UNLIST_ACTION = "unpublish";
export const unlistHref = () => confirmHref(new URL(EDITOR_PATH, ORIGIN), UNLIST_ACTION);
/** Back to the work list from a confirm step. */
/** Where a repository is changed: the editor's GitHub repositories (RepoPicker). */
export const reposHref = () => `${EDITOR_PATH}#repos-title`;
export const workListHref = () => `${withoutConfirm(new URL(EDITOR_PATH, ORIGIN))}#work`;

/** A piece of work the work forms may change: a contribution, never a repository (RepoPicker's). */
export function isContribution(claim: Pick<JourneyClaim, "kind">): boolean {
  return claim.kind !== "repo";
}

/** Which work editor is open: from the address on a GET. An edit of work that isn't the caller's opens nothing. */
export type WorkEditor = { kind: "add" } | { kind: "edit"; claim: JourneyClaim };

export function workEditorFromUrl(url: URL, claims: readonly JourneyClaim[]): WorkEditor | null {
  const edit = url.searchParams.get(EDIT_PARAM);
  if (edit !== null) {
    const claim = claims.find((item) => item.id === edit && isContribution(item));
    return claim ? { kind: "edit", claim } : null;
  }
  return url.searchParams.has(ADD_PARAM) ? { kind: "add" } : null;
}

export const TITLE_MAX = 160;
export const DESCRIPTION_MAX = 6000;
export const LINK_MAX = 2000;

export interface WorkValues {
  title: string;
  description: string;
  date: string;
  link: string;
  /** Post it now, or keep it as a draft only its author sees. */
  status: "posted" | "draft";
}
export type WorkField = Exclude<keyof WorkValues, "status">;
export type WorkErrors = Partial<Record<WorkField, string>>;

export const EMPTY_WORK: WorkValues = { title: "", description: "", date: "", link: "", status: "posted" };

export function workValuesOf(claim: JourneyClaim): WorkValues {
  return { title: claim.title, description: claim.description, date: claim.date, link: claim.evidence[0]?.url ?? "", status: claim.status };
}

const isCalendarDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** A link must be a public HTTPS page: no credentials, nothing inside this app. */
function linkProblem(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || /^\/(admin|api|dashboard)(?:\/|$)/i.test(url.pathname)) {
      return "Use a public HTTPS link without a password in it, and not a page inside TTV.";
    }
    return null;
  } catch {
    return "Use a complete link that starts with https://.";
  }
}

export function validateWork(values: WorkValues): WorkErrors {
  const errors: WorkErrors = {};
  const title = values.title.trim();
  const description = values.description.trim();
  const link = values.link.trim();
  if (title.length > TITLE_MAX) errors.title = `Keep the title within ${TITLE_MAX} characters.`;
  else if (title.length < 3) errors.title = "Give it a title of at least 3 characters.";
  if (description.length > DESCRIPTION_MAX) errors.description = "Keep the description within 6,000 characters.";
  else if (description.length < 20) errors.description = "Say what you did in at least 20 characters.";
  if (!isCalendarDate(values.date)) errors.date = "Choose the date you did it.";
  if (link.length > LINK_MAX) errors.link = `Keep the link within ${LINK_MAX.toLocaleString("en-GB")} characters.`;
  else if (link) {
    const problem = linkProblem(link);
    if (problem) errors.link = problem;
  }
  return errors;
}

/** What the API would be sent: its path under /api/community/, method and JSON body (none for DELETE). */
export type WorkWrite = CommunityWrite;

export interface WorkFailure {
  title: string;
  detail: string;
}

export type WorkSaved = keyof Pick<typeof SAVED, "added" | "addedDraft" | "updated" | "posted" | "drafted" | "deleted">;

export type WorkPostResult =
  | { kind: "saved"; saved: WorkSaved }
  /** The form comes back with what was typed: its errors, or why the save failed. */
  | { kind: "render"; status: number; claimId: string | null; values: WorkValues; errors: WorkErrors; failure: WorkFailure | null }
  /** A status change or delete that failed: said once at the top, nothing to keep. */
  | { kind: "failed"; status: number; failure: WorkFailure }
  | { kind: "refuse"; status: 400 | 403 | 413 };

/** The `_action` values these forms post. */
export const WORK_ACTIONS = ["work", "work-status", "work-delete"] as const;
export type WorkAction = (typeof WORK_ACTIONS)[number];

const text = (form: FormData, name: string, max: number) => {
  const value = form.get(name);
  // Generous bounds: a refusal shows what was typed, and nothing unbounded is held.
  return typeof value === "string" ? value.slice(0, max * 4) : "";
};
const unavailable: WorkFailure = { title: NOT_SAVED.work, detail: NOT_SAVED.unavailable };
const changed: WorkFailure = { title: NOT_SAVED.work, detail: NOT_SAVED.changed };

async function answer(send: () => Promise<Response>): Promise<{ ok: true } | { ok: false; status: number; failure: WorkFailure }> {
  let response: Response;
  try {
    response = await send();
  } catch {
    return { ok: false, status: 503, failure: unavailable };
  }
  if (response.ok) return { ok: true };
  if (response.status >= 500) return { ok: false, status: 503, failure: unavailable };
  if (response.status === 409) return { ok: false, status: 409, failure: changed };
  // A refusal the form could not foresee: the API's own sentence.
  const reply = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const reason = typeof reply?.error === "string" ? `${reply.error} ` : "";
  return { ok: false, status: response.status, failure: { title: NOT_SAVED.work, detail: `${reason}${NOT_SAVED.kept}` } };
}

/** The caller's own contribution a status change or delete names, or null for anything else. */
function ownContribution(form: FormData, claims: readonly JourneyClaim[]): JourneyClaim | null {
  const id = form.get("id");
  return (typeof id === "string" && claims.find((claim) => claim.id === id && isContribution(claim))) || null;
}

/**
 * Handles one of the work forms, already read (`form`, its `_action` one of WORK_ACTIONS). `claims`
 * are the caller's own, as the page read them; `send` answers as `/api/community/<path>` would.
 */
export function handleWorkPost(
  action: WorkAction,
  form: FormData,
  claims: readonly JourneyClaim[],
  send: (write: WorkWrite) => Promise<Response>,
): Promise<WorkPostResult> {
  return action === "work" ? saveWork(form, claims, send) : changeWork(action, form, claims, send);
}

/** Moves the caller's own contribution between posted and draft, or deletes it. */
async function changeWork(
  action: Exclude<WorkAction, "work">,
  form: FormData,
  claims: readonly JourneyClaim[],
  send: (write: WorkWrite) => Promise<Response>,
): Promise<WorkPostResult> {
  const claim = ownContribution(form, claims);
  if (!claim) return { kind: "failed", status: 409, failure: changed };
  const path = `journey/${encodeURIComponent(claim.id)}`;
  if (action === "work-delete") {
    const sent = await answer(() => send({ path, method: "DELETE" }));
    return sent.ok ? { kind: "saved", saved: "deleted" } : { kind: "failed", status: sent.status, failure: sent.failure };
  }
  const status = form.get("status");
  if (status !== "posted" && status !== "draft") return { kind: "refuse", status: 400 };
  const sent = await answer(() => send({ path, method: "PATCH", body: { status } }));
  return sent.ok ? { kind: "saved", saved: status === "posted" ? "posted" : "drafted" } : { kind: "failed", status: sent.status, failure: sent.failure };
}

/** Posts a new piece of work, or the next revision of the caller's own contribution. */
async function saveWork(form: FormData, claims: readonly JourneyClaim[], send: (write: WorkWrite) => Promise<Response>): Promise<WorkPostResult> {
  const values: WorkValues = {
    title: text(form, "title", TITLE_MAX),
    description: text(form, "description", DESCRIPTION_MAX),
    date: text(form, "date", 10),
    link: text(form, "link", LINK_MAX),
    status: form.get("status") === "draft" ? "draft" : "posted",
  };
  const id = form.get("id");
  const claimId = typeof id === "string" && id ? id : null;
  const errors = validateWork(values);
  const rendered = (status: number, failure: WorkFailure | null): WorkPostResult => ({ kind: "render", status, claimId, values, errors, failure });
  if (Object.keys(errors).length > 0) return rendered(400, null);
  const body = {
    title: values.title.trim(),
    description: values.description.trim(),
    evidenceUrl: values.link.trim() || null,
    occurredAt: values.date,
    status: values.status,
  };
  let write: WorkWrite = { path: "journey", method: "POST", body };
  if (claimId) {
    const revision = Number(form.get("revision"));
    const claim = claims.find((item) => item.id === claimId && isContribution(item));
    if (!claim || !Number.isSafeInteger(revision) || revision < 1) return rendered(409, changed);
    write = { path: `journey/${encodeURIComponent(claimId)}`, method: "PUT", body: { ...body, expectedRevision: revision } };
  }
  const sent = await answer(() => send(write));
  if (!sent.ok) return rendered(sent.status, sent.failure);
  return { kind: "saved", saved: claimId ? "updated" : values.status === "draft" ? "addedDraft" : "added" };
}

/** Reads a post to the editor: its `_action` and form, or why it can't be read. */
export async function readEditorPost(request: Request): Promise<{ action: string; form: FormData } | { refuse: 403 | 413 | 400 }> {
  if (!isSameOriginRequest(request)) return { refuse: 403 };
  const form = await boundedForm(request);
  if (!form) return { refuse: 413 };
  const action = form.get("_action");
  return typeof action === "string" ? { action, form } : { refuse: 400 };
}
