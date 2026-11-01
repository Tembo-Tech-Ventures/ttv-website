import {
  AccessRole, CreateAccessRequest, ExternalLink, type EffectiveFlags, type IntentSet, type OnboardingState,
} from "@/lib/platform/contracts";
import { CHOICES, FAILURES, FIELD_ERRORS, WELCOME, type ChoiceIntent } from "./copy";

/**
 * The welcome step (S1) and the request step (S2) as one server-side flow, so
 * the page and its DEV harness differ only in where state lives. Plain form
 * posts drive it, with or without JavaScript: every POST either redirects
 * (post, redirect, get) or re-renders the step with what was typed.
 *
 * Choosing an intent never grants anything. Saving intents only records how a
 * person means to take part; mentor and organisation access stay requests
 * that an administrator decides, and the page says so before anything is sent.
 */

/** Where the flow lives. The page passes its own paths; the harness keeps its persona in them. */
export interface WelcomeRoutes {
  /** S1, the choices. */
  choose: string;
  /** S2, the request details. */
  request: string;
  /** Where a finished person goes: /dashboard picks their space. */
  landing: string;
}

/**
 * The server functions the flow calls. Each write returns the whole state,
 * as the onboarding routes do (B-O.1), so the next step is decided from
 * what the server now holds, never from what the form asked for.
 */
export interface WelcomeActions {
  load(): Promise<OnboardingState>;
  saveIntents(intents: IntentSet): Promise<OnboardingState>;
  requestAccess(input: CreateAccessRequest): Promise<OnboardingState>;
}

export type ChoiceStatus = "active" | "pending";

export const REQUEST_FIELDS = [
  "mentorNote", "mentorLink", "organisation", "organisationRole", "institutionNote", "institutionLink", "scope",
] as const;
export type RequestField = (typeof REQUEST_FIELDS)[number];
export type RequestDraft = Record<Exclude<RequestField, "scope">, string> & { scope: boolean };
export type RequestErrors = Partial<Record<RequestField, string>>;

export const EMPTY_DRAFT: RequestDraft = {
  mentorNote: "", mentorLink: "", organisation: "", organisationRole: "", institutionNote: "", institutionLink: "", scope: false,
};

export type WelcomeView =
  | {
    step: "choose";
    selected: ChoiceIntent[];
    /** Where a person already stands on the cards that need approval, when revisiting. */
    statuses: Partial<Record<ChoiceIntent, ChoiceStatus>>;
    error: string | null;
  }
  | { step: "request"; roles: AccessRole[]; draft: RequestDraft; errors: RequestErrors; failure: string | null };

export type WelcomeResult =
  | { kind: "redirect"; location: string }
  | { kind: "view"; status: 200 | 422 | 429 | 503; view: WelcomeView };

const NOTE_MIN = 20;
const NOTE_MAX = 600;
const ORGANISATION_MAX = 200;
const CHOICE_ORDER: readonly ChoiceIntent[] = CHOICES.map((choice) => choice.intent);

/**
 * Whether this person may see onboarding at all: it needs the `spaces` shell
 * and its own `onboarding` flag (SPEC §6). B-O.2 adds the `onboarding` key;
 * until it exists the page is closed for everyone, overrides included.
 */
export function onboardingOpen(flags: EffectiveFlags): boolean {
  return flags.spaces === true && (flags as Partial<Record<string, boolean>>).onboarding === true;
}

function isChoiceIntent(value: unknown): value is ChoiceIntent {
  return typeof value === "string" && (CHOICE_ORDER as readonly string[]).includes(value);
}

function inChoiceOrder(intents: Iterable<string>): ChoiceIntent[] {
  const chosen = new Set(Array.from(intents).filter(isChoiceIntent));
  return CHOICE_ORDER.filter((intent) => chosen.has(intent));
}

/** `?intent=` from the partner pages only preselects a card. It never submits anything. */
export function parseHint(params: URLSearchParams): ChoiceIntent | null {
  const hint = params.get("intent")?.toUpperCase();
  return isChoiceIntent(hint) ? hint : null;
}

/**
 * The cards ticked when the step opens: what the person saved if they are
 * revisiting, otherwise what their roles and cohort history suggest, plus
 * any hint from the page that sent them.
 */
export function initialSelection(state: OnboardingState, hint: ChoiceIntent | null): ChoiceIntent[] {
  const base: readonly string[] = state.stage === "DONE" ? state.intents : state.inferred;
  return inChoiceOrder(hint ? [...base, hint] : base);
}

/** The roles and requests decide a card's status, never the intent alone. */
export function choiceStatuses(state: OnboardingState): Partial<Record<ChoiceIntent, ChoiceStatus>> {
  const statuses: Partial<Record<ChoiceIntent, ChoiceStatus>> = {};
  for (const role of AccessRole.options) {
    if (state.roles.includes(role)) statuses[role] = "active";
    else if (state.requests.some((request) => request.role === role && request.status === "PENDING")) statuses[role] = "pending";
  }
  return statuses;
}

/**
 * The access this person chose and can still ask for: not held already, and
 * not waiting on a request. A declined or withdrawn request can be sent again.
 */
export function requestableRoles(state: OnboardingState): AccessRole[] {
  const status = choiceStatuses(state);
  return AccessRole.options.filter((role) => state.intents.includes(role) && status[role] === undefined);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function readDraft(form: FormData): RequestDraft {
  return {
    mentorNote: text(form, "mentorNote"),
    mentorLink: text(form, "mentorLink"),
    organisation: text(form, "organisation"),
    organisationRole: text(form, "organisationRole"),
    institutionNote: text(form, "institutionNote"),
    institutionLink: text(form, "institutionLink"),
    scope: form.get("scope") === "yes",
  };
}

/** People type `mto.example` far more often than a full URL. A bare host is read as https. */
export function normaliseLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function linkError(link: string | null): string | null {
  if (link === null || ExternalLink.safeParse(link).success) return null;
  try {
    const url = new URL(link);
    if (url.username || url.password) return FIELD_ERRORS.linkCredentials;
  } catch {
    // Not a URL at all: the general message fits.
  }
  return FIELD_ERRORS.link;
}

function noteError(note: string, short: string): string | null {
  if (note.length < NOTE_MIN) return short;
  return note.length > NOTE_MAX ? FIELD_ERRORS.tooLong(NOTE_MAX) : null;
}

/**
 * The requests a draft makes, or why it cannot be sent yet. Messages are the
 * page's own; the contract parse that follows is the authority on the shape.
 */
export function validateRequests(draft: RequestDraft, roles: readonly AccessRole[]): {
  requests: CreateAccessRequest[];
  errors: RequestErrors;
} {
  const errors: RequestErrors = {};
  const set = (field: RequestField, message: string | null) => {
    if (message) errors[field] = message;
  };
  const candidates: unknown[] = [];

  if (roles.includes("MENTOR")) {
    const note = draft.mentorNote.trim();
    const link = normaliseLink(draft.mentorLink);
    set("mentorNote", noteError(note, FIELD_ERRORS.mentorNote));
    set("mentorLink", linkError(link));
    candidates.push({ role: "MENTOR", note, link });
  }
  if (roles.includes("INSTITUTION")) {
    const organisation = draft.organisation.trim();
    const organisationRole = draft.organisationRole.trim();
    const note = draft.institutionNote.trim();
    const link = normaliseLink(draft.institutionLink);
    set("organisation", !organisation ? FIELD_ERRORS.organisation
      : organisation.length > ORGANISATION_MAX ? FIELD_ERRORS.tooLong(ORGANISATION_MAX) : null);
    set("organisationRole", organisationRole.length > ORGANISATION_MAX ? FIELD_ERRORS.tooLong(ORGANISATION_MAX) : null);
    set("institutionNote", noteError(note, FIELD_ERRORS.institutionNote));
    set("institutionLink", linkError(link));
    set("scope", draft.scope ? null : FIELD_ERRORS.scope);
    candidates.push({
      role: "INSTITUTION", note, organisation, organisationRole: organisationRole || null, link, scopeAcknowledged: draft.scope,
    });
  }

  if (Object.keys(errors).length > 0) return { requests: [], errors };
  return { requests: candidates.map((candidate) => CreateAccessRequest.parse(candidate)), errors };
}

function statusOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "status" in error ? (error as { status: unknown }).status : undefined;
}

/** A failure the person can act on, or null when the error should surface as one. */
function failureOf(error: unknown): { status: 429 | 503; message: string } | null {
  const status = statusOf(error);
  if (status === 429) return { status: 429, message: FAILURES.rateLimited };
  // Authentication, access and flag answers are not ours to soften: the page returns them.
  if (typeof status === "number" && status >= 400 && status < 500) return null;
  return { status: 503, message: FAILURES.unavailable };
}

const redirect = (location: string): WelcomeResult => ({ kind: "redirect", location });

function chooseView(state: OnboardingState, selected: ChoiceIntent[], error: string | null, status: 200 | 422 | 429 | 503 = 200): WelcomeResult {
  return { kind: "view", status, view: { step: "choose", selected, statuses: choiceStatuses(state), error } };
}

/** Nothing left to ask for: a finished person lands, an unfinished one chooses first. */
function afterRequests(state: OnboardingState, routes: WelcomeRoutes): WelcomeResult {
  return redirect(state.stage === "DONE" ? routes.landing : routes.choose);
}

async function submitChoices(form: FormData, routes: WelcomeRoutes, actions: WelcomeActions): Promise<WelcomeResult> {
  const exploring = form.get("action") === "explore";
  const chosen = inChoiceOrder(form.getAll("intent").filter((value): value is string => typeof value === "string"));
  if (!exploring && chosen.length === 0) return chooseView(await actions.load(), [], WELCOME.required, 422);

  let state: OnboardingState;
  try {
    state = await actions.saveIntents(exploring ? ["EXPLORING"] : chosen);
  } catch (error) {
    const failure = failureOf(error);
    if (!failure) throw error;
    return chooseView(await actions.load(), chosen, failure.message, failure.status);
  }
  return redirect(requestableRoles(state).length > 0 ? routes.request : routes.landing);
}

async function submitRequests(form: FormData, routes: WelcomeRoutes, actions: WelcomeActions): Promise<WelcomeResult> {
  let state = await actions.load();
  const roles = requestableRoles(state);
  if (roles.length === 0) return afterRequests(state, routes);

  const draft = readDraft(form);
  const { requests, errors } = validateRequests(draft, roles);
  if (requests.length === 0) return { kind: "view", status: 422, view: { step: "request", roles, draft, errors, failure: null } };

  // One at a time, in role order: if the second fails, the first is already
  // Pending and drops out of the step, so a retry never sends it twice.
  for (const request of requests) {
    try {
      state = await actions.requestAccess(request);
    } catch (error) {
      // Another tab already sent it, or an administrator granted the role meanwhile: read what is true now.
      if (statusOf(error) === 409) {
        state = await actions.load();
        continue;
      }
      const failure = failureOf(error);
      if (!failure) throw error;
      const remaining = requestableRoles(state);
      if (remaining.length === 0) return afterRequests(state, routes);
      return { kind: "view", status: failure.status, view: { step: "request", roles: remaining, draft, errors: {}, failure: failure.message } };
    }
  }
  return redirect(routes.landing);
}

/** Runs one request through the flow. Thrown Responses and unexpected 4xx errors are the caller's to return. */
export async function handleWelcome(request: Request, routes: WelcomeRoutes, actions: WelcomeActions): Promise<WelcomeResult> {
  const url = new URL(request.url);
  const step = url.searchParams.get("step") === "request" ? "request" : "choose";

  if (request.method === "POST") {
    const form = await request.formData();
    return step === "request" ? submitRequests(form, routes, actions) : submitChoices(form, routes, actions);
  }

  const state = await actions.load();
  if (step === "choose") return chooseView(state, initialSelection(state, parseHint(url.searchParams)), null);
  const roles = requestableRoles(state);
  if (roles.length === 0) return afterRequests(state, routes);
  return { kind: "view", status: 200, view: { step: "request", roles, draft: EMPTY_DRAFT, errors: {}, failure: null } };
}
