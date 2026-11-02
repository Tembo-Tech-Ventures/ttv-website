import {
  MAX_MONTHLY_CAPACITY, MentorRequestFormat, ROUTES, UpdateMentorAvailability,
  type MentorAvailability,
} from "../contracts";
import { ApiError, createApiClient, type ApiClient } from "./apiClient";
import { createStore, type Store } from "./store";

/**
 * A mentor's availability editor (S-4.1): the headline and bio members read,
 * the areas they help with, the formats they offer, how many requests they
 * take a month and a pause. Edits stay local until saved; the saved state is
 * always the server's answer, never the draft.
 *
 * Rules mirror UpdateMentorAvailability, so the form explains a problem
 * before the server has to refuse it: a headline of up to 120 characters,
 * up to 20 areas of up to 40 characters each (each once, ignoring case), at
 * least one format, and 0 to 20 requests a month.
 */
export const MAX_HEADLINE = 120;
export const MAX_AREA = 40;
export const MAX_AREAS = 20;
export const MAX_BIO = 2000;

export type AvailabilityField = "headline" | "areas" | "formats" | "monthlyCapacity" | "bio";
export type AvailabilityStatus = "editing" | "saving" | "saved" | "error";

export type AvailabilityDraft = UpdateMentorAvailability;
export interface AvailabilityState {
  saved: MentorAvailability;
  draft: AvailabilityDraft;
  /** The area being typed, before it is added. */
  areaInput: string;
  errors: Partial<Record<AvailabilityField, string>>;
  status: AvailabilityStatus;
  error: ApiError | null;
  /** Polite aria-live text. */
  announcement: string;
}

export interface AvailabilityOptions {
  initial: MentorAvailability;
  api?: ApiClient;
  /** Explicit fixture client for the DEV harness. */
  mock?: ApiClient;
}

/** The editable part of a saved availability. */
export function draftOf(saved: MentorAvailability): AvailabilityDraft {
  return {
    headline: saved.headline, monthlyCapacity: saved.monthlyCapacity, areas: [...saved.areas],
    formats: [...saved.formats], bio: saved.bio, paused: saved.paused,
  };
}

/** Whether the draft differs from what is saved. Areas keep their order; formats are a set. */
export function isDirty(state: Pick<AvailabilityState, "saved" | "draft">): boolean {
  const { saved, draft } = state;
  return draft.headline !== saved.headline || draft.bio !== saved.bio || draft.paused !== saved.paused
    || draft.monthlyCapacity !== saved.monthlyCapacity
    || draft.areas.length !== saved.areas.length || draft.areas.some((area, i) => area !== saved.areas[i])
    || draft.formats.length !== saved.formats.length || draft.formats.some(format => !saved.formats.includes(format));
}

const FIELD_MESSAGES: Record<AvailabilityField, string> = {
  headline: `Write a headline of up to ${MAX_HEADLINE} characters.`,
  areas: `List up to ${MAX_AREAS} areas, each once and up to ${MAX_AREA} characters.`,
  formats: "Offer at least one way to help.",
  monthlyCapacity: `Choose a number from 0 to ${MAX_MONTHLY_CAPACITY}.`,
  bio: `Keep the bio to ${MAX_BIO} characters.`,
};

/** The body to save, or a message per field to fix. */
export function validateAvailability(draft: AvailabilityDraft):
  { ok: true; body: UpdateMentorAvailability } | { ok: false; errors: Partial<Record<AvailabilityField, string>> } {
  const body = { ...draft, headline: draft.headline.trim(), bio: draft.bio.trim(), areas: draft.areas.map(area => area.trim()) };
  const result = UpdateMentorAvailability.safeParse(body);
  if (result.success) return { ok: true, body: result.data };
  const errors: Partial<Record<AvailabilityField, string>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && field in FIELD_MESSAGES) errors[field as AvailabilityField] ??= FIELD_MESSAGES[field as AvailabilityField];
  }
  return { ok: false, errors };
}

/** Why an area cannot be added, or null when it can. */
export function areaProblem(areas: readonly string[], input: string): string | null {
  const area = input.trim();
  if (area === "") return "Type an area first.";
  if (area.length > MAX_AREA) return `Keep each area to ${MAX_AREA} characters.`;
  if (areas.some(existing => existing.trim().toLowerCase() === area.toLowerCase())) return `"${area}" is already listed.`;
  if (areas.length >= MAX_AREAS) return `You can list up to ${MAX_AREAS} areas.`;
  return null;
}

const asApiError = (error: unknown) => error instanceof ApiError ? error
  : new ApiError("client_error", 0, "Availability could not be saved", undefined, { cause: error });

export function createAvailabilityStore(options: AvailabilityOptions) {
  const api = options.api ?? options.mock ?? createApiClient();
  const store: Store<AvailabilityState> = createStore<AvailabilityState>({
    saved: options.initial, draft: draftOf(options.initial), areaInput: "", errors: {},
    status: "editing", error: null, announcement: "",
  });
  let controller: AbortController | null = null;
  let retains = 0;

  function edit(change: Partial<AvailabilityDraft>, cleared: AvailabilityField[]) {
    store.setState(state => {
      if (state.status === "saving") return state;
      const errors = { ...state.errors };
      for (const field of cleared) delete errors[field];
      return { ...state, draft: { ...state.draft, ...change }, errors, status: "editing", announcement: "" };
    });
  }

  return {
    ...store,
    setHeadline(headline: string) { edit({ headline }, ["headline"]); },
    setBio(bio: string) { edit({ bio }, ["bio"]); },
    setPaused(paused: boolean) { edit({ paused }, []); },
    /** Whole requests a month, held within 0 and the maximum. */
    setMonthlyCapacity(value: number) {
      if (!Number.isFinite(value)) return;
      edit({ monthlyCapacity: Math.min(MAX_MONTHLY_CAPACITY, Math.max(0, Math.round(value))) }, ["monthlyCapacity"]);
    },
    setAreaInput(areaInput: string) {
      store.setState(state => {
        const { areas: _cleared, ...errors } = state.errors;
        return { ...state, areaInput, errors };
      });
    },
    /** Adds the typed area. Returns false, with the reason under the field, when it cannot be added. */
    addArea(): boolean {
      const state = store.getState();
      if (state.status === "saving") return false;
      const problem = areaProblem(state.draft.areas, state.areaInput);
      if (problem) {
        store.setState({ ...state, errors: { ...state.errors, areas: problem }, announcement: problem });
        return false;
      }
      const area = state.areaInput.trim();
      const { areas: _fixed, ...errors } = state.errors;
      store.setState({
        ...state, draft: { ...state.draft, areas: [...state.draft.areas, area] }, areaInput: "",
        errors, status: "editing", announcement: `Added ${area}.`,
      });
      return true;
    },
    removeArea(area: string) {
      const state = store.getState();
      if (state.status === "saving" || !state.draft.areas.includes(area)) return;
      edit({ areas: state.draft.areas.filter(existing => existing !== area) }, ["areas"]);
      store.setState(current => ({ ...current, announcement: `Removed ${area}.` }));
    },
    /** Offers or stops offering a format. The last one stays: a mentor offers at least one. */
    toggleFormat(format: MentorRequestFormat) {
      const state = store.getState();
      if (state.status === "saving") return;
      const offered = state.draft.formats.includes(format);
      if (offered && state.draft.formats.length === 1) {
        store.setState({ ...state, errors: { ...state.errors, formats: FIELD_MESSAGES.formats }, announcement: FIELD_MESSAGES.formats });
        return;
      }
      // Kept in the contract's order, so saving the same set reads as unchanged.
      const formats = MentorRequestFormat.options.filter(option => option === format ? !offered : state.draft.formats.includes(option));
      edit({ formats }, ["formats"]);
    },
    /** Back to what is saved. */
    reset() {
      store.setState(state => state.status === "saving" ? state : {
        ...state, draft: draftOf(state.saved), areaInput: "", errors: {}, status: "editing", error: null, announcement: "",
      });
    },
    async save(): Promise<MentorAvailability | null> {
      const state = store.getState();
      if (state.status === "saving") return null;
      const checked = validateAvailability(state.draft);
      if (!checked.ok) {
        store.setState({ ...state, errors: checked.errors, status: "editing", announcement: "Check the highlighted fields." });
        return null;
      }
      controller = new AbortController();
      store.setState({ ...state, status: "saving", errors: {}, error: null, announcement: "" });
      try {
        const saved = await api.call(ROUTES.updateMentorAvailability, { body: checked.body, signal: controller.signal });
        store.setState(current => ({
          ...current, saved, draft: draftOf(saved), status: "saved", error: null,
          announcement: saved.listed ? "Saved. Members can find you in the directory." : "Saved. You're not listed in the directory right now.",
        }));
        return saved;
      } catch (caught) {
        const error = asApiError(caught);
        store.setState(current => ({
          ...current, status: error.code === "aborted" ? "editing" : "error", error: error.code === "aborted" ? null : error,
          announcement: error.code === "aborted" ? "" : "Couldn't save. Your changes are still here.",
        }));
        return null;
      } finally {
        controller = null;
      }
    },
    /** Reference-counted by the islands that use this form; the last release stops a save in flight. */
    retain(): () => void {
      retains += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        retains -= 1;
        if (retains === 0) controller?.abort();
      };
    },
  };
}

export type AvailabilityStore = ReturnType<typeof createAvailabilityStore>;
