import {
  ROUTES,
  type Id, type MentorRequest, type MentorRequestList, type MentorRequestNote, type MentorRequestStatus,
} from "../contracts";
import { ApiError, createApiClient, type ApiClient } from "./apiClient";
import { createStore, type Store } from "./store";

/**
 * Mentor requests from one side (S-4.1): the requests a mentor received (`as:
 * "mentor"`, the Requests page) or the ones a person sent (`as: "requester"`,
 * "Your requests" on the Mentors page).
 *
 * - Accept, redirect and decline (the mentor's) and withdraw (the person
 *   asking's) show at once and roll back if the server refuses. A request
 *   moves only from PENDING, and only one change per request is in flight.
 * - The optimistic status lives beside the server's request, never in it: an
 *   accepted request's conversation id only exists once the server answers.
 * - When the server refuses because the request already moved (409, or 404
 *   for one that is gone), the store reads the request again, so the page
 *   shows what really happened (the person withdrew while the mentor was
 *   reading) rather than a bare error.
 * - Nothing here retries a change: none of these routes is idempotent.
 */
export type MentorRequestAction = "accept" | "redirect" | "decline" | "withdraw";
export type MentorRequestSide = "requester" | "mentor";

const TARGET: Record<MentorRequestAction, MentorRequestStatus> = {
  accept: "ACCEPTED", redirect: "REDIRECTED", decline: "DECLINED", withdraw: "WITHDRAWN",
};
const ACTIONS_FOR: Record<MentorRequestSide, readonly MentorRequestAction[]> = {
  mentor: ["accept", "redirect", "decline"],
  requester: ["withdraw"],
};

export interface PendingChange {
  action: MentorRequestAction;
  /** What the request shows while the server decides. */
  status: MentorRequestStatus;
}
export interface FailedChange {
  action: MentorRequestAction;
  error: ApiError;
  /** The request had already moved on; the item now shows the server's state. */
  stale: boolean;
}
export interface MentorRequestsState {
  items: readonly MentorRequest[];
  nextCursor: string | null;
  pending: Readonly<Record<Id, PendingChange>>;
  failed: Readonly<Record<Id, FailedChange>>;
  loadingMore: boolean;
  loadError: ApiError | null;
  /** Polite aria-live text. */
  announcement: string;
}

export interface MentorRequestsOptions {
  as: MentorRequestSide;
  /** The page's server-rendered first page. */
  initial: MentorRequestList;
  /** Only requests in this status, as the first page was read. */
  status?: MentorRequestStatus;
  api?: ApiClient;
  /** Explicit fixture client for the DEV harness. */
  mock?: ApiClient;
}

export interface RedirectChoice {
  mentorId: Id;
  /** Shown to the person asking, with the suggestion. */
  mentorName: string;
  note?: MentorRequestNote;
}

interface ActDetails {
  redirect?: RedirectChoice;
  note?: string;
}

/** The status a request shows now: the change in flight, else the server's. */
export function shownStatus(state: Pick<MentorRequestsState, "pending">, request: Pick<MentorRequest, "id" | "status">): MentorRequestStatus {
  return state.pending[request.id]?.status ?? request.status;
}

/** Whether `side` may make `action` on a request in this status. */
export function canAct(side: MentorRequestSide, action: MentorRequestAction, status: MentorRequestStatus): boolean {
  return status === "PENDING" && ACTIONS_FOR[side].includes(action);
}

const asApiError = (error: unknown) => error instanceof ApiError ? error
  : new ApiError("client_error", 0, "The change could not be saved", undefined, { cause: error });
const moved = (error: ApiError) => error.status === 409 || error.status === 404 || error.code === "conflict" || error.code === "not_found";

function counterpart(side: MentorRequestSide, request: MentorRequest): string {
  return side === "mentor" ? request.requester.name : request.mentor.name;
}

/** What each change says once the server has it, and when it is refused. */
function done(side: MentorRequestSide, action: MentorRequestAction, request: MentorRequest, details: ActDetails): string {
  const name = counterpart(side, request);
  switch (action) {
    case "accept": return `Accepted. Your conversation with ${name} is open.`;
    case "redirect": return `Suggested ${details.redirect?.mentorName ?? request.redirectedTo?.name ?? "another mentor"} to ${name}.`;
    case "decline": return `Marked not this month. ${name} can ask again later.`;
    case "withdraw": return `Request to ${name} withdrawn.`;
  }
}
const VERB: Record<MentorRequestAction, string> = {
  accept: "accept", redirect: "send the suggestion", decline: "save that", withdraw: "withdraw",
};
const STATUS_WORDS: Record<MentorRequestStatus, string> = {
  PENDING: "still waiting", ACCEPTED: "already accepted", REDIRECTED: "already redirected",
  DECLINED: "already answered", WITHDRAWN: "withdrawn",
};

export function createMentorRequestsStore(options: MentorRequestsOptions) {
  const api = options.api ?? options.mock ?? createApiClient();
  const side = options.as;
  const store: Store<MentorRequestsState> = createStore<MentorRequestsState>({
    items: options.initial.items, nextCursor: options.initial.nextCursor,
    pending: {}, failed: {}, loadingMore: false, loadError: null, announcement: "",
  });
  const controllers = new Set<AbortController>();
  let retains = 0;

  const find = (id: Id) => store.getState().items.find(item => item.id === id);
  const replace = (next: MentorRequest) => store.setState(state => ({
    ...state, items: state.items.map(item => item.id === next.id ? next : item),
  }));

  function settle(id: Id, update: (state: MentorRequestsState) => Partial<MentorRequestsState>) {
    store.setState(state => {
      const { [id]: _pending, ...pending } = state.pending;
      return { ...state, pending, ...update({ ...state, pending }) };
    });
  }

  async function call<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      return await run(controller.signal);
    } finally {
      controllers.delete(controller);
    }
  }

  function send(id: Id, action: MentorRequestAction, signal: AbortSignal, details: ActDetails) {
    const params = { id };
    const note = details.redirect?.note?.trim() || details.note?.trim();
    const withNote = note ? { note } : {};
    switch (action) {
      case "accept": return api.call(ROUTES.acceptMentorRequest, { params, body: {}, signal });
      case "redirect": return api.call(ROUTES.redirectMentorRequest, { params, body: { mentorId: details.redirect!.mentorId, ...withNote }, signal });
      case "decline": return api.call(ROUTES.declineMentorRequest, { params, body: withNote, signal });
      case "withdraw": return api.call(ROUTES.withdrawMentorRequest, { params, body: {}, signal });
    }
  }

  /** Reads one request again after a refusal; null when it can no longer be read. */
  async function reread(id: Id): Promise<MentorRequest | null> {
    try {
      return await call(signal => api.call(ROUTES.getMentorRequest, { params: { id }, signal }));
    } catch {
      return null;
    }
  }

  async function act(id: Id, action: MentorRequestAction, details: ActDetails = {}): Promise<MentorRequest | null> {
    const state = store.getState();
    const request = find(id);
    if (!request || state.pending[id]) return null;
    if (!canAct(side, action, request.status)) return null;
    const target = details.redirect?.mentorId;
    if (action === "redirect" && (!target || target === request.mentor.id || target === request.requester.id)) return null;
    const { [id]: _failed, ...failed } = state.failed;
    store.setState({ ...state, failed, pending: { ...state.pending, [id]: { action, status: TARGET[action] } }, announcement: "" });
    try {
      const next = await call(signal => send(id, action, signal, details));
      settle(id, current => ({
        items: current.items.map(item => item.id === id ? next : item),
        announcement: done(side, action, next, details),
      }));
      return next;
    } catch (caught) {
      const error = asApiError(caught);
      if (error.code === "aborted") {
        settle(id, () => ({}));
        return null;
      }
      const truth = moved(error) ? await reread(id) : null;
      const name = counterpart(side, request);
      settle(id, current => ({
        items: truth ? current.items.map(item => item.id === id ? truth : item) : current.items,
        failed: { ...current.failed, [id]: { action, error, stale: truth !== null && truth.status !== "PENDING" } },
        announcement: truth && truth.status !== "PENDING"
          ? `This request from ${name} was ${STATUS_WORDS[truth.status]}, so nothing changed.`
          : `Couldn't ${VERB[action]}. Nothing changed.`,
      }));
      return null;
    }
  }

  return {
    ...store,
    side,
    accept: (id: Id) => act(id, "accept"),
    /** Suggest another mentor; the person asking decides whether to ask them. */
    redirect: (id: Id, choice: RedirectChoice) => act(id, "redirect", { redirect: choice }),
    /** "Not this month": one tap, no note needed, and it counts against nobody. */
    decline: (id: Id, note?: MentorRequestNote) => act(id, "decline", { note }),
    withdraw: (id: Id) => act(id, "withdraw"),
    /** Adds a request this page did not have yet (one just sent from the drawer), newest first. */
    prepend(request: MentorRequest) {
      if (find(request.id)) replace(request);
      else store.setState(state => ({ ...state, items: [request, ...state.items] }));
    },
    /** The next page of older requests. */
    async loadMore(): Promise<void> {
      const { nextCursor, loadingMore } = store.getState();
      if (loadingMore || nextCursor === null) return;
      store.setState(state => ({ ...state, loadingMore: true, loadError: null }));
      try {
        const page = await call(signal => api.call(ROUTES.listMentorRequests, {
          query: { as: side, cursor: nextCursor, ...(options.status ? { status: options.status } : {}) }, signal,
        }));
        store.setState(state => {
          const known = new Set(state.items.map(item => item.id));
          return {
            ...state, loadingMore: false, nextCursor: page.nextCursor,
            items: [...state.items, ...page.items.filter(item => !known.has(item.id))],
          };
        });
      } catch (caught) {
        const error = asApiError(caught);
        store.setState(state => ({
          ...state, loadingMore: false, loadError: error.code === "aborted" ? null : error,
          announcement: error.code === "aborted" ? state.announcement : "Couldn't load earlier requests.",
        }));
      }
    },
    /** Clears one request's failure note once it has been read. */
    dismissFailure(id: Id) {
      store.setState(state => {
        if (!state.failed[id]) return state;
        const { [id]: _gone, ...failed } = state.failed;
        return { ...state, failed };
      });
    },
    /** Reference-counted by the islands that show this list; the last release stops every request in flight. */
    retain(): () => void {
      retains += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        retains -= 1;
        if (retains === 0) for (const controller of controllers) controller.abort();
      };
    },
  };
}

export type MentorRequestsStore = ReturnType<typeof createMentorRequestsStore>;
