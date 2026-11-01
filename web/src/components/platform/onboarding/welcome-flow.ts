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
  /**
   * Where a person lands after sending a request: a page that shows its status card, never one the
   * last-space cookie picks (QAO-02). The flow adds which roles were sent (`sent=`), so that page can
   * say so and take focus.
   */
  sent: string;
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

/** The roles a request was just sent for (`?sent=mentor,institution`), on the page the person lands on. */
export const SENT_PARAM = "sent";

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
  | { kind: "view"; status: 200 | 409 | 422 | 429 | 503; view: WelcomeView }
  /** Not a form either step sends (too large): the caller answers with this status and nothing else. */
  | { kind: "refuse"; status: 413 };

const NOTE_MIN = 20;
/**
 * The largest form either step can send, generously: every field at its
 * maximum, each character percent-encoded as several bytes (about 18 KB).
 */
export const MAX_FORM_BYTES = 32 * 1024;
const NOTE_MAX = 600;
const ORGANISATION_MAX = 200;
const CHOICE_ORDER: readonly ChoiceIntent[] = CHOICES.map((choice) => choice.intent);

/**
 * Whether this person may see onboarding at all: its own `onboarding` flag,
 * which builds on the `spaces` shell (SPEC §6). flags.ts already makes
 * onboarding effective only while spaces is; this says so again, so the page
 * never opens without the shell it lands in.
 */
export function onboardingOpen(flags: EffectiveFlags): boolean {
  return flags.spaces && flags.onboarding;
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
 * `only` narrows it to the one role a page asked about (Account's "Request
 * access" for organisation access never also reopens an old mentor request).
 */
export function requestableRoles(state: OnboardingState, only: AccessRole | null = null): AccessRole[] {
  const status = choiceStatuses(state);
  return AccessRole.options.filter((role) => state.intents.includes(role) && status[role] === undefined && (only === null || role === only));
}

/** `?role=mentor|institution` on the request step: ask about that access only. */
export function parseRoleFilter(params: URLSearchParams): AccessRole | null {
  const parsed = AccessRole.safeParse(params.get("role")?.toUpperCase());
  return parsed.success ? parsed.data : null;
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

/**
 * People type `mto.example` far more often than a full URL. A bare host is
 * read as https, including `mto.example:8080` and `localhost:3000`: a real
 * scheme has no dot and is not followed by a port number.
 */
export function normaliseLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(trimmed);
  const hasScheme = scheme !== null && !scheme[1]!.includes(".") && !/^\d/.test(scheme[2]!);
  return hasScheme ? trimmed : `https://${trimmed}`;
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

async function submitRequests(form: FormData, routes: WelcomeRoutes, actions: WelcomeActions, only: AccessRole | null): Promise<WelcomeResult> {
  let state = await actions.load();
  const roles = requestableRoles(state, only);
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
      // A conflict may mean another tab sent it or the role was granted, or that
      // nothing was sent at all: read what is true now and decide below.
      if (statusOf(error) === 409) {
        state = await actions.load();
        continue;
      }
      const failure = failureOf(error);
      if (!failure) throw error;
      const remaining = requestableRoles(state, only);
      if (remaining.length === 0) return afterRequests(state, routes);
      return { kind: "view", status: failure.status, view: { step: "request", roles: remaining, draft, errors: {}, failure: failure.message } };
    }
  }
  // Land only when every request is now Pending or its role is held. One that
  // is still askable was not sent, and saying nothing would leave the person
  // believing it was.
  const unsent = requestableRoles(state, only).filter((role) => requests.some((request) => request.role === role));
  if (unsent.length > 0) {
    return { kind: "view", status: 409, view: { step: "request", roles: unsent, draft, errors: {}, failure: FAILURES.unavailable } };
  }
  // Say only what is true now: a role granted meanwhile (another tab, a quick administrator) has no request to confirm.
  const waiting = requests.map((request) => request.role)
    .filter((role) => state.requests.some((candidate) => candidate.role === role && candidate.status === "PENDING"));
  return redirect(waiting.length > 0 ? sentLocation(routes.sent, waiting) : routes.landing);
}

/** The landing after a request, with the roles just sent: `?sent=mentor,institution`. */
export function sentLocation(base: string, roles: readonly AccessRole[]): string {
  const url = new URL(base, "http://landing.invalid");
  url.searchParams.set(SENT_PARAM, roles.map((role) => role.toLowerCase()).join(","));
  return `${url.pathname}${url.search}`;
}

/** The roles `?sent=` names, in role order; anything else in it is ignored. */
export function parseSent(params: URLSearchParams): AccessRole[] {
  const named = new Set((params.get(SENT_PARAM) ?? "").toUpperCase().split(","));
  return AccessRole.options.filter((role) => named.has(role));
}

/**
 * The posted form, or null when its body is larger than any step could send.
 * A declared length is checked first; the body is then read only up to the
 * limit, since HTTP/2 does not require a length to be declared at all.
 */
export async function boundedForm(request: Request): Promise<FormData | null> {
  if (Number(request.headers.get("content-length")) > MAX_FORM_BYTES) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  for (let part = await reader?.read(); part && !part.done; part = await reader!.read()) {
    size += part.value.byteLength;
    if (size > MAX_FORM_BYTES) {
      await reader!.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
}

/** Runs one request through the flow. Thrown Responses and unexpected 4xx errors are the caller's to return. */
export async function handleWelcome(request: Request, routes: WelcomeRoutes, actions: WelcomeActions): Promise<WelcomeResult> {
  const url = new URL(request.url);
  const step = url.searchParams.get("step") === "request" ? "request" : "choose";
  const only = parseRoleFilter(url.searchParams);

  if (request.method === "POST") {
    const form = await boundedForm(request);
    if (!form) return { kind: "refuse", status: 413 };
    return step === "request" ? submitRequests(form, routes, actions, only) : submitChoices(form, routes, actions);
  }

  const state = await actions.load();
  if (step === "choose") return chooseView(state, initialSelection(state, parseHint(url.searchParams)), null);
  const roles = requestableRoles(state, only);
  if (roles.length === 0) return afterRequests(state, routes);
  return { kind: "view", status: 200, view: { step: "request", roles, draft: EMPTY_DRAFT, errors: {}, failure: null } };
}
