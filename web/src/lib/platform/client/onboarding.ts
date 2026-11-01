import { OnboardingState, ROUTES, type AccessRequestSummary, type AccessRole, type Intent } from "../contracts";
import { ApiError, createApiClient, type ApiClient } from "./apiClient";
import {
  clearOnboardingDrafts, patchDraft, readDrafts, sessionDraftStorage, toCreateAccessRequest, writeDrafts,
  type AccessRequestDrafts, type DraftFieldErrors, type DraftFor, type DraftStorage,
} from "./onboarding-drafts";
import { initialSelection, intentSelectionReducer, type IntentSelection, type IntentSelectionAction } from "./onboarding-intents";
import { createStore } from "./store";

/** A write against the onboarding API. At most one runs at a time. */
export type OnboardingAction =
  | { type: "save"; intents: readonly Intent[] }
  | { type: "dismissPrompt" }
  | { type: "submit"; role: AccessRole }
  | { type: "withdraw"; role: AccessRole; id: string }
  | { type: "dismiss"; role: AccessRole; id: string };

export type OnboardingFailureKind = "conflict" | "rate_limited" | "offline" | "invalid" | "failed";
export interface OnboardingFailure {
  action: OnboardingAction;
  kind: OnboardingFailureKind;
  error: ApiError;
  /** From a 429: the server's cooldown, to tell the person when to try again. */
  retryAfterMs: number | null;
}

export interface OnboardingClientState {
  enabled: boolean;
  /** Server truth. Pending, Approved and Declined come only from here, never from a local guess. */
  server: OnboardingState | null;
  selection: IntentSelection;
  drafts: AccessRequestDrafts;
  fieldErrors: Partial<Record<AccessRole, DraftFieldErrors>>;
  /** False when the browser refused to keep drafts; typing still works for this page. */
  draftsPersisted: boolean;
  loading: boolean;
  loadError: ApiError | null;
  pending: OnboardingAction | null;
  failure: OnboardingFailure | null;
  /** The session ended (401) or onboarding is unavailable (403/404). No further requests are made. */
  closed: "signed_out" | "unavailable" | null;
  announcement: string;
}

export interface OnboardingOptions {
  /** The effective onboarding flag. Defaults to false: no requests and no storage access while disabled. */
  enabled?: boolean;
  api?: ApiClient;
  /** Explicit fixture client from `onboarding.mock.ts`, for development harnesses. */
  mock?: ApiClient;
  /** Server-rendered state for hydration. Without it, start() loads it. */
  initialState?: OnboardingState;
  /** `?intent=` from the URL; preselects a card and never submits. */
  hint?: unknown;
  /** From `onboardingDraftKey(userId)`. Without a key, drafts are kept in memory only. */
  draftKey?: string;
  storage?: () => DraftStorage | undefined;
}

/** What each access role shows, from server truth. A held role always wins over request state. */
export type AccessStatus = "NOT_REQUESTED" | "PENDING" | "APPROVED" | "ACTIVE" | "DECLINED";

export function requestFor(state: OnboardingState | null, role: AccessRole): AccessRequestSummary | null {
  return state?.requests.find(request => request.role === role) ?? null;
}

/**
 * APPROVED is an approval the person hasn't seen yet (the card); ACTIVE is a held role. An approval whose
 * role was since removed, and a withdrawn request, both read as NOT_REQUESTED.
 */
export function accessStatus(state: OnboardingState | null, role: AccessRole): AccessStatus {
  const request = requestFor(state, role);
  if (state?.roles.includes(role)) return request?.status === "APPROVED" && request.seenAt === null ? "APPROVED" : "ACTIVE";
  if (request?.status === "PENDING" || request?.status === "DECLINED") return request.status;
  return "NOT_REQUESTED";
}

const MAX_PRELOAD = 32;
const ROLE_NAMES: Record<AccessRole, string> = { MENTOR: "mentor", INSTITUTION: "organisation" };
const FAILURE_MESSAGES: Record<OnboardingFailureKind, string> = {
  conflict: "This changed since the page loaded. It now shows the latest.",
  rate_limited: "Too many requests for today. Try again later.",
  offline: "Couldn't reach TTV. Check your connection and try again.",
  invalid: "Check the highlighted fields.",
  failed: "That didn't go through. Try again.",
};

const sameIntents = (a: readonly Intent[], b: readonly Intent[]) => a.length === b.length && a.every(intent => b.includes(intent));
const normalizeError = (error: unknown) => error instanceof ApiError ? error
  : new ApiError("client_error", 0, "Onboarding request failed", undefined, { cause: error });

/** requireFlag answers 404 `flag_off`; a write's other 404 is a stale or foreign request id. */
const staleId = (error: ApiError) => error.status === 404 && error.code !== "flag_off";

function classify(error: ApiError): OnboardingFailureKind {
  if (error.status === 409 || staleId(error)) return "conflict";
  if (error.status === 429) return "rate_limited";
  if (error.code === "network_error") return "offline";
  if (error.code === "validation_error" || error.status === 400 || error.status === 422) return "invalid";
  return "failed";
}

/** The write may or may not have landed, so the server must be asked before anything is shown. */
const uncertain = (error: ApiError) => error.status === 409 || staleId(error) || error.code === "network_error"
  || error.code === "invalid_response" || error.status >= 500;

/** Whether server truth already shows the action's outcome, e.g. after a lost response or a second tab. */
function satisfied(action: OnboardingAction, state: OnboardingState): boolean {
  const request = "role" in action ? requestFor(state, action.role) : null;
  switch (action.type) {
    case "save": return state.stage === "DONE" && sameIntents(state.intents, action.intents);
    case "dismissPrompt": return state.stage === "DONE";
    case "submit": return state.roles.includes(action.role) || request?.status === "PENDING";
    case "withdraw": return !state.roles.includes(action.role)
      && (request === null || (request.id === action.id && request.status === "WITHDRAWN"));
    case "dismiss": return request?.id !== action.id || request.seenAt !== null;
  }
}

/** `refused`: the server turned this write down (409), and its truth already shows the outcome. */
function successMessage(action: OnboardingAction, state: OnboardingState, refused: boolean): string {
  switch (action.type) {
    case "save": case "dismissPrompt": return "Saved.";
    case "submit": {
      // Settled by truth, the role may already be held: then there is no request to announce.
      if (accessStatus(state, action.role) !== "PENDING") return "";
      const role = ROLE_NAMES[action.role];
      return refused ? `A ${role} request is already with the team, so this one wasn't sent.` : `Your ${role} request is with the team.`;
    }
    case "withdraw": return "Request withdrawn.";
    case "dismiss": return "";
  }
}

/** One store per island and signed-in user. Construction has no side effects; start/retain own the work. */
export function createOnboardingStore(options: OnboardingOptions = {}) {
  const { enabled = false, draftKey } = options;
  const api = options.api ?? options.mock ?? createApiClient();
  const initial = options.initialState ? OnboardingState.parse(options.initialState) : null;
  const store = createStore<OnboardingClientState>({
    enabled, server: initial, selection: initialSelection(initial, options.hint), drafts: {}, fieldErrors: {},
    draftsPersisted: true, loading: false, loadError: null, pending: null, failure: null, closed: null, announcement: "",
  });
  let epoch = 0;
  let retains = 0;
  let stopped = false;
  let hydrated = false;
  let storage: DraftStorage | undefined;
  let readController: AbortController | undefined;
  let writeController: AbortController | undefined;
  /** Selection changes made before the first server state, replayed onto it (hint and inferred prefill kept). */
  let preload: IntentSelectionAction[] = [];
  const update = (patch: Partial<OnboardingClientState>) => store.setState(state => ({ ...state, ...patch }));
  const available = () => enabled && !stopped && store.getState().closed === null;
  const current = (generation: number, signal: AbortSignal) => available() && generation === epoch && !signal.aborted;

  function draftStorage(): DraftStorage | undefined {
    try { return (options.storage ?? sessionDraftStorage)(); } catch { return undefined; }
  }
  function hydrateDrafts() {
    if (hydrated || !enabled || !draftKey) return;
    hydrated = true;
    storage = draftStorage();
    update({ drafts: readDrafts(storage, draftKey) });
  }
  function saveDrafts(drafts: AccessRequestDrafts) {
    update({ drafts, draftsPersisted: draftKey ? writeDrafts(storage, draftKey, drafts) : false });
  }
  /** Server truth replaces the server state and carries its intent changes into the local selection. */
  function apply(next: OnboardingState, patch: Partial<OnboardingClientState> = {}) {
    const replay = preload;
    preload = [];
    store.setState(state => ({
      ...state, ...patch, server: next, loadError: null,
      selection: state.server === null
        ? replay.reduce(intentSelectionReducer, initialSelection(next, options.hint))
        : intentSelectionReducer(state.selection, { type: "sync", from: state.server.intents, to: next.intents }),
    }));
  }
  /** On a write, only a `flag_off` 404 closes; on a read, any 404 does. */
  function close(error: ApiError, read = false): boolean {
    if (error.status === 401) {
      signOut();
      return true;
    }
    if (error.status === 403 || (error.status === 404 && (read || !staleId(error)))) {
      stop();
      update({ closed: "unavailable" });
      return true;
    }
    return false;
  }

  async function refresh(): Promise<boolean> {
    if (!available() || store.getState().pending) return false;
    readController?.abort();
    const controller = new AbortController();
    readController = controller;
    const generation = epoch;
    update({ loading: true, loadError: null });
    try {
      const next = await api.call(ROUTES.getOnboarding, { signal: controller.signal });
      // A write that started meanwhile aborted this read: it may predate the write, so it is dropped.
      if (!current(generation, controller.signal)) return false;
      apply(next);
      return true;
    } catch (error) {
      const failure = normalizeError(error);
      if (current(generation, controller.signal) && !close(failure, true)) {
        update({ loadError: failure, announcement: "Couldn't load your onboarding choices." });
      }
      return false;
    } finally {
      if (readController === controller) {
        readController = undefined;
        update({ loading: false });
      }
    }
  }

  async function write(action: OnboardingAction, send: (signal: AbortSignal) => Promise<OnboardingState>): Promise<boolean> {
    if (!available() || store.getState().pending) return false;
    readController?.abort();
    const controller = new AbortController();
    writeController = controller;
    const generation = epoch;
    const succeed = (next: OnboardingState, refused = false) => {
      // A refused send never reached the team, so its text stays for the person to keep or discard.
      if (action.type === "submit" && !refused) {
        const { [action.role]: _sent, ...rest } = store.getState().drafts;
        saveDrafts(rest);
      }
      apply(next, { pending: null, failure: null, announcement: successMessage(action, next, refused) });
      return true;
    };
    update({ pending: action, failure: null });
    try {
      const next = await send(controller.signal);
      return current(generation, controller.signal) ? succeed(next) : false;
    } catch (error) {
      const failure = normalizeError(error);
      if (!current(generation, controller.signal) || close(failure)) return false;
      if (uncertain(failure)) {
        // Never show an outcome without a 2xx: ask the server what actually happened.
        const truth = await api.call(ROUTES.getOnboarding, { signal: controller.signal }).catch(() => null);
        if (!current(generation, controller.signal)) return false;
        if (truth && satisfied(action, truth)) return succeed(truth, failure.status === 409);
        if (truth) apply(truth);
      }
      const kind = classify(failure);
      update({
        pending: null, failure: { action, kind, error: failure, retryAfterMs: failure.retryAfterMs ?? null },
        announcement: FAILURE_MESSAGES[kind],
      });
      return false;
    } finally {
      if (writeController === controller) writeController = undefined;
    }
  }

  function saveIntents(): Promise<boolean> {
    if (!available()) return Promise.resolve(false);
    const selection = intentSelectionReducer(store.getState().selection, { type: "continue" });
    update({ selection });
    if (selection.empty) return Promise.resolve(false);
    const intents = selection.intents;
    preload = [];
    return write({ type: "save", intents }, signal => api.call(ROUTES.updateOnboarding, { body: { intents: [...intents] }, signal }));
  }

  function submitRequest(role: AccessRole): Promise<boolean> {
    if (!available() || store.getState().pending) return Promise.resolve(false);
    // The UI offers a request only when the server shows none pending and the role isn't held.
    const status = accessStatus(store.getState().server, role);
    if (status === "PENDING" || status === "ACTIVE" || status === "APPROVED") return Promise.resolve(false);
    hydrateDrafts();
    const validation = toCreateAccessRequest(role, store.getState().drafts);
    if (!validation.ok) {
      const error = new ApiError("validation_error", 0, "Invalid access request");
      update({
        fieldErrors: { ...store.getState().fieldErrors, [role]: validation.fieldErrors },
        failure: { action: { type: "submit", role }, kind: "invalid", error, retryAfterMs: null },
        announcement: FAILURE_MESSAGES.invalid,
      });
      return Promise.resolve(false);
    }
    const { [role]: _cleared, ...fieldErrors } = store.getState().fieldErrors;
    update({ fieldErrors });
    return write({ type: "submit", role }, signal => api.call(ROUTES.createAccessRequest, { body: validation.body, signal }));
  }

  function withdrawRequest(role: AccessRole): Promise<boolean> {
    const request = requestFor(store.getState().server, role);
    if (request?.status !== "PENDING") return Promise.resolve(false);
    const { id } = request;
    return write({ type: "withdraw", role, id }, signal => api.call(ROUTES.withdrawAccessRequest, { params: { id }, body: {}, signal }));
  }

  function dismissRequest(role: AccessRole): Promise<boolean> {
    const request = requestFor(store.getState().server, role);
    if (!request || (request.status !== "APPROVED" && request.status !== "DECLINED") || request.seenAt !== null) {
      return Promise.resolve(false);
    }
    const { id } = request;
    return write({ type: "dismiss", role, id }, signal => api.call(ROUTES.dismissAccessRequest, { params: { id }, body: {}, signal }));
  }

  function dismissPrompt(): Promise<boolean> {
    return write({ type: "dismissPrompt" }, signal => api.call(ROUTES.updateOnboarding, { body: { dismissPrompt: true }, signal }));
  }

  function stop() {
    stopped = true;
    epoch++;
    readController?.abort();
    writeController?.abort();
    readController = undefined;
    writeController = undefined;
    update({ pending: null, loading: false });
  }

  /** Ends this user's onboarding state in the tab: drafts are removed and no further requests are made. */
  function signOut() {
    stop();
    // Disabled stores never touch storage; the sign-out flow can call clearOnboardingDrafts() itself.
    if (enabled) clearOnboardingDrafts(storage ?? draftStorage());
    preload = [];
    update({ server: null, selection: initialSelection(null), drafts: {}, fieldErrors: {}, failure: null, closed: "signed_out" });
  }

  function start() {
    stopped = false;
    if (!available()) return;
    hydrateDrafts();
    if (!store.getState().server) void refresh();
  }

  return {
    ...store,
    start, stop, refresh, signOut,
    /** Reference-counted, so several components and StrictMode share one lifecycle. */
    retain() {
      if (++retains === 1) start();
      let released = false;
      return () => {
        if (!released) {
          released = true;
          if (--retains === 0) stop();
        }
      };
    },
    select(action: IntentSelectionAction) {
      const { server, selection } = store.getState();
      if (server === null) {
        // Record what was chosen, not the flip, so the replay onto loaded state keeps the person's intent.
        const replay = action.type === "toggle" ? { type: "set" as const, intent: action.intent, chosen: !selection.intents.includes(action.intent) } : action;
        preload = [...preload, replay].slice(-MAX_PRELOAD);
      }
      update({ selection: intentSelectionReducer(store.getState().selection, action) });
    },
    updateDraft<R extends AccessRole>(role: R, patch: Partial<DraftFor<R>>) {
      if (!available()) return;
      hydrateDrafts();
      const { drafts, fieldErrors } = store.getState();
      saveDrafts({ ...drafts, [role]: patchDraft(role, drafts[role] as DraftFor<R> | undefined, patch) });
      if (fieldErrors[role]) {
        const { [role]: _edited, ...rest } = fieldErrors;
        update({ fieldErrors: rest });
      }
    },
    discardDraft(role: AccessRole) {
      if (!available()) return;
      hydrateDrafts();
      const { [role]: _discarded, ...rest } = store.getState().drafts;
      saveDrafts(rest);
    },
    saveIntents,
    dismissPrompt, submitRequest, withdrawRequest, dismissRequest,
    /** Re-runs the failed action against current state (a re-sent request reads the current draft). */
    retry(): Promise<boolean> {
      const failed = store.getState().failure?.action;
      if (!failed || !available() || store.getState().pending) return Promise.resolve(false);
      update({ failure: null });
      switch (failed.type) {
        case "save": return saveIntents();
        case "dismissPrompt": return dismissPrompt();
        case "submit": return submitRequest(failed.role);
        case "withdraw": return withdrawRequest(failed.role);
        case "dismiss": return dismissRequest(failed.role);
      }
    },
    clearFailure() { update({ failure: null }); },
  };
}

export type OnboardingStore = ReturnType<typeof createOnboardingStore>;
export const selectAccessStatus = (role: AccessRole) => (state: OnboardingClientState) => accessStatus(state.server, role);
export { useOnboarding } from "./hooks/onboarding";
