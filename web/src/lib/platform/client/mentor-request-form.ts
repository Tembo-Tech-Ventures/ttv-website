import { z } from "zod";
import {
  MentorRequestFormat, ProjectEmbedRef, ROUTES,
  type Id as IdType, type MentorDirectoryItem, type MentorRequest, type ProjectEmbed,
} from "../contracts";
import { ApiError, createApiClient, type ApiClient } from "./apiClient";
import { sessionDraftStorage, type DraftStorage } from "./onboarding-drafts";
import { createStore, type Store } from "./store";

/**
 * The "Ask for time" form (S-4.1): what the person wants help with, the work
 * they attach (one of their own published projects, at its current revision)
 * and how (one of the formats the mentor offers).
 *
 * - The draft is kept for the tab, in sessionStorage only, one per signed-in
 *   person and mentor, so closing the drawer, reloading or going to agree to
 *   how we talk to each other loses nothing. It is cleared once the request is
 *   sent, and on sign-out (`clearMentorRequestDrafts`).
 * - Nothing is optimistic: a request exists only once the server says so.
 * - `conduct`: the server answered conduct_required. The note becomes the
 *   first message of a private conversation, so the person agrees to the
 *   habits first and then sends the same draft.
 * - A send is never retried automatically: creating a request is not idempotent.
 */
export const MENTOR_REQUEST_DRAFT_PREFIX = "ttv-mentor-request-draft:";
export const MAX_NOTE = 2000;
const MAX_STORED = 16_384;

export type RequestFormStatus = "editing" | "sending" | "sent" | "conduct" | "error";
export type RequestFormField = "note" | "format";
/** Why the last send failed, in words the drawer can choose from. `limit`: too many requests waiting or made today. */
export type RequestFailure = "conflict" | "notFound" | "limit" | "signedOut" | "notMember" | "other";

export interface RequestDraft {
  note: string;
  project: ProjectEmbedRef | null;
  format: MentorRequestFormat | null;
}
export interface RequestFormState extends RequestDraft {
  status: RequestFormStatus;
  errors: Partial<Record<RequestFormField, string>>;
  failure: RequestFailure | null;
  error: ApiError | null;
  /** The request the server created, once sent. */
  sent: MentorRequest | null;
  /** Polite aria-live text. */
  announcement: string;
}

export interface RequestFormOptions {
  userId: IdType;
  mentor: Pick<MentorDirectoryItem, "person" | "formats">;
  /** The person's own published projects, at their current revisions. Only these can be attached. */
  projects: readonly Pick<ProjectEmbed, "journeyId" | "version">[];
  api?: ApiClient;
  /** Explicit fixture client for the DEV harness. */
  mock?: ApiClient;
  /** Defaults to the tab's sessionStorage, when there is one. */
  storage?: DraftStorage;
  /**
   * What the server rendered after a send without JavaScript did not go through: the posted draft
   * and why. It wins over a draft kept in the tab, since it is what the person last sent.
   */
  initial?: ServerRequestForm | null;
}

/** A request form as the server renders it after a post (request-post.ts). */
export interface ServerRequestForm extends RequestDraft {
  status: Extract<RequestFormStatus, "editing" | "conduct" | "error">;
  errors: Partial<Record<RequestFormField, string>>;
  failure: RequestFailure | null;
}

const StoredDraft = z.object({
  note: z.string().max(MAX_NOTE * 2),
  project: ProjectEmbedRef.nullable(),
  format: MentorRequestFormat.nullable(),
});

/** One key per person and mentor, so a second account in the same tab never sees the first one's text. */
export function mentorRequestDraftKey(userId: IdType, mentorId: IdType): string {
  return `${MENTOR_REQUEST_DRAFT_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(mentorId)}`;
}

export function readRequestDraft(storage: DraftStorage | undefined, key: string): RequestDraft | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed = raw.length <= MAX_STORED ? StoredDraft.safeParse(JSON.parse(raw)) : undefined;
    if (parsed?.success) return parsed.data;
  } catch { /* Corrupt or unavailable: dropped below. */ }
  try { storage?.removeItem(key); } catch { /* Storage is optional. */ }
  return null;
}

export function writeRequestDraft(storage: DraftStorage | undefined, key: string, draft: RequestDraft): void {
  if (!storage) return;
  try {
    if (draft.note.trim() === "" && draft.project === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ note: draft.note.slice(0, MAX_NOTE * 2), project: draft.project, format: draft.format }));
  } catch { /* Quota or privacy mode: the form still works, without a kept draft. */ }
}

/** Forgets every mentor request draft in this tab. Called on sign-out. */
export function clearMentorRequestDrafts(storage: DraftStorage | undefined = sessionDraftStorage()): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(MENTOR_REQUEST_DRAFT_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch { /* Storage is optional. */ }
}

const sameRef = (a: Pick<ProjectEmbed, "journeyId" | "version">, b: Pick<ProjectEmbed, "journeyId" | "version">) =>
  a.journeyId === b.journeyId && a.version === b.version;

/**
 * Keeps only what can still be sent: a project the person can still attach
 * at that revision, a format this mentor still offers. A mentor offering one
 * format has it chosen already; with several, the first is the starting choice.
 */
function settle(draft: RequestDraft | null, options: RequestFormOptions): RequestDraft {
  const { formats } = options.mentor;
  const project = draft?.project && options.projects.some(p => sameRef(p, draft.project!)) ? draft.project : null;
  const format = draft?.format && formats.includes(draft.format) ? draft.format : formats[0] ?? null;
  return { note: draft?.note ?? "", project, format };
}

/** The request body for a draft, or what to fix. Validation mirrors CreateMentorRequest. */
export function validateRequestDraft(
  draft: RequestDraft, mentor: Pick<MentorDirectoryItem, "formats">,
): { ok: true; note: string; format: MentorRequestFormat } | { ok: false; errors: Partial<Record<RequestFormField, string>> } {
  const errors: Partial<Record<RequestFormField, string>> = {};
  const note = draft.note.trim();
  if (note === "") errors.note = "Say what you'd like help with.";
  else if (note.length > MAX_NOTE) errors.note = `Keep it to ${MAX_NOTE} characters; this is ${note.length}.`;
  if (!draft.format || !mentor.formats.includes(draft.format)) errors.format = "Choose how you'd like their help.";
  return errors.note || errors.format ? { ok: false, errors } : { ok: true, note, format: draft.format! };
}

/** Why a send was refused, from its status and error code; shared with the no-JavaScript post. */
/**
 * B-4.1's refusal for an account with neither a community profile nor a cohort place (#304), word for word. Other
 * 403 `forbidden` answers (a cross-origin post, a token) say something else, so only this one reads as "notMember".
 */
export const NEEDS_MEMBER_MESSAGE = "Asking a mentor for time needs a member profile or a cohort place.";

export function requestFailure(error: { status: number; code: string; message?: string }): RequestFailure {
  if (error.status === 409 || error.code === "conflict") return "conflict";
  if (error.status === 429 || error.code === "rate_limited") return "limit";
  if (error.status === 404) return "notFound";
  if (error.status === 401) return "signedOut";
  // B-4.1 (#304): asking needs a member account. conduct_required is a 403 too, and has its own step.
  if (error.status === 403 && error.code === "forbidden" && error.message === NEEDS_MEMBER_MESSAGE) return "notMember";
  return "other";
}

const asApiError = (error: unknown) => error instanceof ApiError ? error
  : new ApiError("client_error", 0, "The request could not be sent", undefined, { cause: error });

export function createRequestFormStore(options: RequestFormOptions) {
  const api = options.api ?? options.mock ?? createApiClient();
  const storage = options.storage ?? sessionDraftStorage();
  const mentorId = options.mentor.person.id;
  const key = mentorRequestDraftKey(options.userId, mentorId);
  const seeded = options.initial ?? null;
  const store: Store<RequestFormState> = createStore<RequestFormState>(seeded
    ? { ...settle(seeded, options), status: seeded.status, errors: seeded.errors, failure: seeded.failure, error: null, sent: null, announcement: "" }
    : { ...settle(null, options), status: "editing", errors: {}, failure: null, error: null, sent: null, announcement: "" });

  function edit(change: Partial<RequestDraft>) {
    const state = store.getState();
    if (state.status === "sending" || state.status === "sent") return;
    const next = { note: state.note, project: state.project, format: state.format, ...change };
    // Fixing a field clears its message; the others stay until the next send.
    const errors = { ...state.errors };
    if ("note" in change) delete errors.note;
    if ("format" in change) delete errors.format;
    store.setState({ ...state, ...next, errors, status: state.status === "error" ? "editing" : state.status, announcement: "" });
    writeRequestDraft(storage, key, next);
  }

  return {
    ...store,
    mentorId,
    /** Reads the tab's kept draft. Call once the island is in the browser, so SSR and hydration match. */
    restore() {
      if (seeded) return;
      const kept = readRequestDraft(storage, key);
      if (!kept) return;
      store.setState(state => state.status === "editing" ? { ...state, ...settle(kept, options) } : state);
    },
    setNote(note: string) { edit({ note }); },
    setFormat(format: MentorRequestFormat) {
      if (options.mentor.formats.includes(format)) edit({ format });
    },
    /** Attach one of the person's own projects, or null to attach nothing. */
    setProject(project: Pick<ProjectEmbed, "journeyId" | "version"> | null) {
      if (project === null) edit({ project: null });
      else if (options.projects.some(p => sameRef(p, project))) edit({ project: { type: "project", journeyId: project.journeyId, version: project.version } });
    },
    /** The person agreed to how we talk to each other: back to the form, draft intact. */
    agreed() {
      store.setState(state => state.status === "conduct" ? { ...state, status: "editing", announcement: "" } : state);
    },
    /**
     * Sends the request. Resolves with the created request, or null when there is something to fix or it failed.
     * A send is never stopped once started, not even by closing the drawer: creating is not idempotent and the
     * server may already have the request (counted against the mentor's spots), so it always settles and lands
     * under Your requests.
     */
    async submit(): Promise<MentorRequest | null> {
      const state = store.getState();
      if (state.status === "sending" || state.status === "sent") return state.sent;
      const checked = validateRequestDraft(state, options.mentor);
      if (!checked.ok) {
        store.setState({ ...state, errors: checked.errors, announcement: "Check the highlighted fields." });
        return null;
      }
      store.setState({ ...state, status: "sending", errors: {}, failure: null, error: null, announcement: "" });
      try {
        const sent = await api.call(ROUTES.createMentorRequest, {
          body: { mentorId, note: checked.note, project: state.project, format: checked.format },
        });
        try { storage?.removeItem(key); } catch { /* Storage is optional. */ }
        store.setState(current => ({
          ...current, status: "sent", sent, note: "", project: null,
          announcement: `Request sent to ${options.mentor.person.name}.`,
        }));
        return sent;
      } catch (caught) {
        const error = asApiError(caught);
        if (error.code === "conduct_required") {
          store.setState(current => ({
            ...current, status: "conduct", error, failure: null,
            announcement: "Agree to how we talk to each other, then send your request.",
          }));
          return null;
        }
        const failure = requestFailure(error);
        store.setState(current => ({
          ...current, status: "error", error, failure,
          announcement: "Your request wasn't sent. Your note is kept.",
        }));
        return null;
      }
    },
  };
}

export type RequestFormStore = ReturnType<typeof createRequestFormStore>;
