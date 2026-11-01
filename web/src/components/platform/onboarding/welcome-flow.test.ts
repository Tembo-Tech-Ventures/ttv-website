import { describe, expect, it, vi } from "vitest";
import {
  AccessRequestSummary, OnboardingState, type CreateAccessRequest, type EffectiveFlags, type IntentSet,
} from "@/lib/platform/contracts";
import { onboardingByPersona } from "@/lib/platform/fixtures";
import { FAILURES, FIELD_ERRORS, WELCOME } from "./copy";
import {
  EMPTY_DRAFT, MAX_FORM_BYTES, choiceStatuses, handleWelcome, initialSelection, normaliseLink, onboardingOpen, parseHint,
  parseRoleFilter, readDraft, requestableRoles, validateRequests, type RequestDraft, type WelcomeActions, type WelcomeResult,
} from "./welcome-flow";

const ROUTES = { choose: "/dashboard/welcome", request: "/dashboard/welcome?step=request", landing: "/dashboard" };
const NOTE = "Backend and data work: SQL, APIs and tests.";
const LONG = "x".repeat(601);

const fresh = (): OnboardingState => OnboardingState.parse(onboardingByPersona.wairimu);
const state = (overrides: Partial<OnboardingState>): OnboardingState => OnboardingState.parse({ ...fresh(), ...overrides });

/** An onboarding server in miniature: it records every write and can fail on cue. */
function server(initial: OnboardingState, failures: { save?: unknown; request?: unknown[] } = {}) {
  let current = initial;
  let sent = 0;
  const requestFailures = [...(failures.request ?? [])];
  const actions = {
    load: vi.fn(async () => current),
    saveIntents: vi.fn(async (intents: IntentSet) => {
      if (failures.save) throw failures.save;
      current = OnboardingState.parse({ ...current, stage: "DONE", intents });
      return current;
    }),
    requestAccess: vi.fn(async (input: CreateAccessRequest) => {
      const failure = requestFailures.shift();
      // `sentAnyway`: the write landed (another tab, a lost response) before the server answered with the error.
      if (failure && !(failure as { sentAnyway?: boolean }).sentAnyway) throw failure;
      sent += 1;
      const request = AccessRequestSummary.parse({
        id: `request${sent}`, role: input.role, status: "PENDING", note: input.note,
        organisation: input.role === "INSTITUTION" ? input.organisation : null,
        organisationRole: input.role === "INSTITUTION" ? input.organisationRole : null,
        link: input.link, decisionMessage: null, createdAt: sent, updatedAt: sent, decidedAt: null, seenAt: null,
      });
      current = OnboardingState.parse({ ...current, requests: [...current.requests.filter((r) => r.role !== input.role), request] });
      if (failure) throw failure;
      return current;
    }),
  } satisfies WelcomeActions;
  return { actions, now: () => current };
}

function get(path = ROUTES.choose) {
  return new Request(`https://ttv.example${path}`);
}

function post(path: string, fields: [string, string][]) {
  const body = new URLSearchParams(fields);
  return new Request(`https://ttv.example${path}`, {
    method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

function view<S extends "choose" | "request">(result: WelcomeResult, step: S) {
  if (result.kind !== "view" || result.view.step !== step) throw new Error(`Expected the ${step} step, got ${JSON.stringify(result)}`);
  return result as Extract<WelcomeResult, { kind: "view" }> & { view: Extract<Extract<WelcomeResult, { kind: "view" }>["view"], { step: S }> };
}

const mentorDraft = (overrides: Partial<RequestDraft> = {}): RequestDraft => ({ ...EMPTY_DRAFT, mentorNote: NOTE, ...overrides });
const institutionDraft = (overrides: Partial<RequestDraft> = {}): RequestDraft => ({
  ...EMPTY_DRAFT, organisation: "Mto Labs", institutionNote: "Junior engineers who have built mobile features.", scope: true, ...overrides,
});
const requestFields = (draft: RequestDraft): [string, string][] => [
  ...Object.entries(draft).filter(([key]) => key !== "scope") as [string, string][],
  ...(draft.scope ? [["scope", "yes"] as [string, string]] : []),
];

describe("onboardingOpen", () => {
  const flags = (extra: Partial<EffectiveFlags>): EffectiveFlags =>
    ({ spaces: true, channels: false, tembo_channels: false, mentor_requests: false, onboarding: false, ...extra });

  it("stays closed while the onboarding flag is off", () => {
    expect(onboardingOpen(flags({}))).toBe(false);
  });

  it("needs the spaces shell as well as its own flag", () => {
    expect(onboardingOpen(flags({ spaces: false, onboarding: true }))).toBe(false);
    expect(onboardingOpen(flags({ onboarding: true }))).toBe(true);
  });
});

describe("parseHint", () => {
  it.each([
    ["?intent=member", "MEMBER"], ["?intent=mentor", "MENTOR"], ["?intent=Institution", "INSTITUTION"],
    ["?intent=exploring", null], ["?intent=admin", null], ["", null],
  ])("reads %s as %s", (search, expected) => {
    expect(parseHint(new URLSearchParams(search))).toBe(expected);
  });
});

describe("initialSelection", () => {
  it("opens a new account with nothing ticked but the hint", () => {
    expect(initialSelection(fresh(), null)).toEqual([]);
    expect(initialSelection(fresh(), "MENTOR")).toEqual(["MENTOR"]);
  });

  it("reopens a finished account with what it saved, in card order, adding the hint", () => {
    const mercy = OnboardingState.parse(onboardingByPersona.mercyAkinyi);
    expect(initialSelection(mercy, null)).toEqual(["MEMBER", "MENTOR"]);
    expect(initialSelection(mercy, "INSTITUTION")).toEqual(["MEMBER", "MENTOR", "INSTITUTION"]);
    expect(initialSelection(mercy, "MENTOR")).toEqual(["MEMBER", "MENTOR"]);
  });

  it("never ticks a card for an explorer", () => {
    expect(initialSelection(state({ stage: "DONE", intents: ["EXPLORING"] }), null)).toEqual([]);
  });

  it("suggests what an existing account's history implies, without saving it", () => {
    expect(initialSelection(state({ stage: "PROMPT", inferred: ["MENTOR", "MEMBER"] }), null)).toEqual(["MEMBER", "MENTOR"]);
  });
});

describe("statuses and requestable roles", () => {
  it("leaves a pending request out of the step and marks its card", () => {
    const mercy = OnboardingState.parse(onboardingByPersona.mercyAkinyi);
    expect(choiceStatuses(mercy)).toEqual({ MENTOR: "pending" });
    expect(requestableRoles(mercy)).toEqual([]);
  });

  it("lets a declined request be sent again", () => {
    const peter = OnboardingState.parse(onboardingByPersona.peter);
    expect(choiceStatuses(peter)).toEqual({});
    expect(requestableRoles(peter)).toEqual(["MENTOR"]);
  });

  it("never asks for a role the person already holds", () => {
    const held = state({ stage: "DONE", intents: ["MENTOR", "INSTITUTION"], roles: ["MENTOR"] });
    expect(choiceStatuses(held)).toEqual({ MENTOR: "active" });
    expect(requestableRoles(held)).toEqual(["INSTITUTION"]);
  });

  it("asks only for roles the person chose", () => {
    expect(requestableRoles(state({ stage: "DONE", intents: ["MEMBER"] }))).toEqual([]);
    expect(requestableRoles(state({ stage: "DONE", intents: ["INSTITUTION", "MENTOR"] }))).toEqual(["MENTOR", "INSTITUTION"]);
  });

  it("narrows to the one access a page asked about", () => {
    const both = state({ stage: "DONE", intents: ["INSTITUTION", "MENTOR"] });
    expect(requestableRoles(both, "INSTITUTION")).toEqual(["INSTITUTION"]);
    expect(requestableRoles(both, "MENTOR")).toEqual(["MENTOR"]);
    expect(requestableRoles(state({ stage: "DONE", intents: ["MENTOR"] }), "INSTITUTION")).toEqual([]);
  });
});

describe("parseRoleFilter", () => {
  it("reads ?role=mentor|institution and nothing else", () => {
    expect(parseRoleFilter(new URLSearchParams("role=mentor"))).toBe("MENTOR");
    expect(parseRoleFilter(new URLSearchParams("role=INSTITUTION"))).toBe("INSTITUTION");
    for (const query of ["", "role=admin", "role=member", "role="]) expect(parseRoleFilter(new URLSearchParams(query))).toBeNull();
  });
});

describe("the request step for one access (Account's Request access)", () => {
  // Peter's mentor request was declined, so it could be sent again; he asked about organisation access alone.
  const peter = () => state({ stage: "DONE", intents: ["MENTOR", "INSTITUTION"] });
  const ONLY = `${ROUTES.request}&role=institution`;
  const routes = { ...ROUTES, request: ONLY };

  it("shows only that section", async () => {
    const { actions } = server(peter());
    expect(view(await handleWelcome(get(ONLY), routes, actions), "request").view.roles).toEqual(["INSTITUTION"]);
  });

  it("sends only that request, without asking for the other's note, then lands", async () => {
    const { actions, now } = server(peter());
    const result = await handleWelcome(post(ONLY, requestFields(institutionDraft())), routes, actions);
    expect(result).toEqual({ kind: "redirect", location: ROUTES.landing });
    expect(actions.requestAccess).toHaveBeenCalledTimes(1);
    expect(now().requests.map((request) => request.role)).toEqual(["INSTITUTION"]);
  });

  it("lands when that access is already pending or held", async () => {
    const { actions } = server(state({ stage: "DONE", intents: ["MENTOR"], roles: [] }));
    expect(await handleWelcome(get(ONLY), routes, actions)).toEqual({ kind: "redirect", location: ROUTES.landing });
  });
});

describe("normaliseLink", () => {
  it.each([
    ["", null], ["   ", null], ["mto.example", "https://mto.example"], [" https://mto.example/team ", "https://mto.example/team"],
    ["http://mto.example", "http://mto.example"], ["ftp://mto.example", "ftp://mto.example"],
    ["mto.example:8080/work", "https://mto.example:8080/work"], ["localhost:3000", "https://localhost:3000"],
    ["mailto:me@mto.example", "mailto:me@mto.example"],
  ])("reads %j as %j", (value, expected) => {
    expect(normaliseLink(value)).toBe(expected);
  });
});

describe("readDraft", () => {
  it("reads every field as text and the acknowledgement as a tick", () => {
    const form = new FormData();
    form.set("mentorNote", NOTE);
    form.set("scope", "yes");
    expect(readDraft(form)).toEqual({ ...EMPTY_DRAFT, mentorNote: NOTE, scope: true });
    expect(readDraft(new FormData()).scope).toBe(false);
  });
});

describe("validateRequests", () => {
  it("builds a mentor request, mapping an empty link to null (never \"\")", () => {
    expect(validateRequests(mentorDraft({ mentorNote: `  ${NOTE}  ` }), ["MENTOR"])).toEqual({
      requests: [{ role: "MENTOR", note: NOTE, link: null }], errors: {},
    });
  });

  it("builds an organisation request with its acknowledgement", () => {
    const { requests, errors } = validateRequests(institutionDraft({ institutionLink: "mto.example", organisationRole: " " }), ["INSTITUTION"]);
    expect(errors).toEqual({});
    expect(requests).toEqual([{
      role: "INSTITUTION", note: "Junior engineers who have built mobile features.", organisation: "Mto Labs",
      organisationRole: null, link: "https://mto.example", scopeAcknowledged: true,
    }]);
  });

  it("asks for each missing or overlong answer by name, and sends nothing", () => {
    const draft: RequestDraft = {
      mentorNote: "Too short", mentorLink: "not a url at all", organisation: " ", organisationRole: "r".repeat(201),
      institutionNote: LONG, institutionLink: "https://user:secret@mto.example", scope: false,
    };
    expect(validateRequests(draft, ["MENTOR", "INSTITUTION"])).toEqual({
      requests: [],
      errors: {
        mentorNote: FIELD_ERRORS.mentorNote, mentorLink: FIELD_ERRORS.link, organisation: FIELD_ERRORS.organisation,
        organisationRole: FIELD_ERRORS.tooLong(200), institutionNote: FIELD_ERRORS.tooLong(600),
        institutionLink: FIELD_ERRORS.linkCredentials, scope: FIELD_ERRORS.scope,
      },
    });
  });

  it("counts a note's length without its surrounding spaces", () => {
    expect(validateRequests(mentorDraft({ mentorNote: `   ${"a".repeat(19)}   ` }), ["MENTOR"]).errors)
      .toEqual({ mentorNote: FIELD_ERRORS.mentorNote });
    expect(validateRequests(mentorDraft({ mentorNote: "a".repeat(20) }), ["MENTOR"]).errors).toEqual({});
  });

  it("ignores the fields of a role that is not being requested", () => {
    expect(validateRequests({ ...EMPTY_DRAFT, mentorNote: NOTE, organisation: "" }, ["MENTOR"]).errors).toEqual({});
  });

  it("refuses links that are not web pages", () => {
    // oxlint-disable-next-line no-script-url -- the point: a script link is refused
    expect(validateRequests(mentorDraft({ mentorLink: "javascript:alert(1)" }), ["MENTOR"]).errors).toEqual({ mentorLink: FIELD_ERRORS.link });
    expect(validateRequests(mentorDraft({ mentorLink: "ftp://mto.example" }), ["MENTOR"]).errors).toEqual({ mentorLink: FIELD_ERRORS.link });
  });
});

describe("handleWelcome: the choices (S1)", () => {
  it("opens with the hint ticked and nothing saved", async () => {
    const { actions } = server(fresh());
    const result = view(await handleWelcome(get("/dashboard/welcome?intent=institution"), ROUTES, actions), "choose");
    expect(result.status).toBe(200);
    expect(result.view).toEqual({ step: "choose", selected: ["INSTITUTION"], statuses: {}, error: null });
    expect(actions.saveIntents).not.toHaveBeenCalled();
  });

  it("asks for a choice when Continue is pressed with none, and saves nothing", async () => {
    const { actions } = server(fresh());
    const result = view(await handleWelcome(post(ROUTES.choose, [["action", "continue"]]), ROUTES, actions), "choose");
    expect(result.status).toBe(422);
    expect(result.view.error).toBe(WELCOME.required);
    expect(actions.saveIntents).not.toHaveBeenCalled();
  });

  it("saves just looking around on its own, whatever was ticked, and lands", async () => {
    const { actions, now } = server(fresh());
    const result = await handleWelcome(post(ROUTES.choose, [["intent", "MENTOR"], ["action", "explore"]]), ROUTES, actions);
    expect(result).toEqual({ kind: "redirect", location: ROUTES.landing });
    expect(now().intents).toEqual(["EXPLORING"]);
  });

  it("lands a builder straight away: building and learning needs no request", async () => {
    const { actions, now } = server(fresh());
    const result = await handleWelcome(post(ROUTES.choose, [["intent", "MEMBER"], ["action", "continue"]]), ROUTES, actions);
    expect(result).toEqual({ kind: "redirect", location: ROUTES.landing });
    expect(now()).toMatchObject({ stage: "DONE", intents: ["MEMBER"], requests: [], roles: [] });
  });

  it("sends a mentor to the request step, saving the choice but granting nothing", async () => {
    const { actions, now } = server(fresh());
    const result = await handleWelcome(post(ROUTES.choose, [["intent", "MENTOR"], ["intent", "MEMBER"], ["intent", "EXPLORING"], ["intent", "ADMIN"]]), ROUTES, actions);
    expect(result).toEqual({ kind: "redirect", location: ROUTES.request });
    expect(actions.saveIntents).toHaveBeenCalledWith(["MEMBER", "MENTOR"]);
    expect(now().roles).toEqual([]);
    expect(actions.requestAccess).not.toHaveBeenCalled();
  });

  it("skips the request step when the chosen access is already pending", async () => {
    const { actions } = server(OnboardingState.parse(onboardingByPersona.mercyAkinyi));
    const result = await handleWelcome(post(ROUTES.choose, [["intent", "MEMBER"], ["intent", "MENTOR"]]), ROUTES, actions);
    expect(result).toEqual({ kind: "redirect", location: ROUTES.landing });
  });

  it("keeps the choices on screen when saving fails", async () => {
    const { actions } = server(fresh(), { save: new Error("D1 is unavailable") });
    const result = view(await handleWelcome(post(ROUTES.choose, [["intent", "MENTOR"]]), ROUTES, actions), "choose");
    expect(result.status).toBe(503);
    expect(result.view).toMatchObject({ selected: ["MENTOR"], error: FAILURES.unavailable });
  });

  it("returns access answers instead of softening them", async () => {
    const denied = Object.assign(new Error("Forbidden"), { status: 403 });
    const { actions } = server(fresh(), { save: denied });
    await expect(handleWelcome(post(ROUTES.choose, [["intent", "MEMBER"]]), ROUTES, actions)).rejects.toBe(denied);
  });
});

describe("handleWelcome: the request step (S2)", () => {
  const chosen = (intents: IntentSet) => state({ stage: "DONE", intents });

  it("opens empty for the roles still to ask for", async () => {
    const { actions } = server(chosen(["MEMBER", "MENTOR", "INSTITUTION"]));
    const result = view(await handleWelcome(get(ROUTES.request), ROUTES, actions), "request");
    expect(result.view).toEqual({ step: "request", roles: ["MENTOR", "INSTITUTION"], draft: EMPTY_DRAFT, errors: {}, failure: null });
  });

  it("sends a finished person with nothing to ask for to their landing, and a new one to the choices", async () => {
    expect(await handleWelcome(get(ROUTES.request), ROUTES, server(chosen(["MEMBER"])).actions))
      .toEqual({ kind: "redirect", location: ROUTES.landing });
    expect(await handleWelcome(get(ROUTES.request), ROUTES, server(fresh()).actions))
      .toEqual({ kind: "redirect", location: ROUTES.choose });
  });

  it("keeps every answer and names each problem when the form is incomplete", async () => {
    const { actions } = server(chosen(["INSTITUTION"]));
    const draft = institutionDraft({ scope: false, institutionNote: "Short" });
    const result = view(await handleWelcome(post(ROUTES.request, requestFields(draft)), ROUTES, actions), "request");
    expect(result.status).toBe(422);
    expect(result.view.draft).toEqual(draft);
    expect(result.view.errors).toEqual({ institutionNote: FIELD_ERRORS.institutionNote, scope: FIELD_ERRORS.scope });
    expect(actions.requestAccess).not.toHaveBeenCalled();
  });

  it("sends one request per role and lands, with both Pending and no role granted", async () => {
    const { actions, now } = server(chosen(["MENTOR", "INSTITUTION"]));
    const draft = { ...institutionDraft(), mentorNote: NOTE };
    const result = await handleWelcome(post(ROUTES.request, requestFields(draft)), ROUTES, actions);
    expect(result).toEqual({ kind: "redirect", location: ROUTES.landing });
    expect(actions.requestAccess.mock.calls.map(([input]) => input.role)).toEqual(["MENTOR", "INSTITUTION"]);
    expect(now().requests.map((r) => [r.role, r.status])).toEqual([["MENTOR", "PENDING"], ["INSTITUTION", "PENDING"]]);
    expect(now().roles).toEqual([]);
  });

  it("keeps the unsent request on screen when the second one is refused, never resending the first", async () => {
    const limited = Object.assign(new Error("Too many"), { status: 429 });
    const { actions, now } = server(chosen(["MENTOR", "INSTITUTION"]), { request: [undefined, limited] });
    const draft = { ...institutionDraft(), mentorNote: NOTE };
    const result = view(await handleWelcome(post(ROUTES.request, requestFields(draft)), ROUTES, actions), "request");
    expect(result.status).toBe(429);
    expect(result.view).toMatchObject({ roles: ["INSTITUTION"], draft, failure: FAILURES.rateLimited });
    expect(now().requests.map((r) => r.role)).toEqual(["MENTOR"]);
  });

  it("reads the server again after a conflict, so a request sent from another tab is not sent twice", async () => {
    const conflict = Object.assign(new Error("Already pending"), { status: 409, sentAnyway: true });
    const { actions, now } = server(chosen(["MENTOR"]), { request: [conflict] });
    const result = await handleWelcome(post(ROUTES.request, requestFields(mentorDraft())), ROUTES, actions);
    expect(result).toEqual({ kind: "redirect", location: ROUTES.landing });
    expect(actions.load).toHaveBeenCalledTimes(2);
    expect(now().requests.map((r) => r.status)).toEqual(["PENDING"]);
  });

  it("says so when a conflict means nothing was sent, instead of landing as if it had been", async () => {
    // The service's "Your access changed while sending" 409: refused, and the role is still askable.
    const conflict = Object.assign(new Error("Your access changed while sending."), { status: 409 });
    const { actions, now } = server(chosen(["MENTOR"]), { request: [conflict] });
    const draft = mentorDraft();
    const result = view(await handleWelcome(post(ROUTES.request, requestFields(draft)), ROUTES, actions), "request");
    expect(result.status).toBe(409);
    expect(result.view).toEqual({ step: "request", roles: ["MENTOR"], draft, errors: {}, failure: FAILURES.unavailable });
    expect(now().requests).toEqual([]);
  });

  it("refuses a body larger than any step sends, declared or streamed, without reading it all", async () => {
    const { actions } = server(chosen(["MENTOR"]));
    const huge = "mentorNote=" + "x".repeat(MAX_FORM_BYTES);
    const declared = new Request(`https://ttv.example${ROUTES.request}`, {
      method: "POST", body: huge, headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(huge.length) },
    });
    expect(await handleWelcome(declared, ROUTES, actions)).toEqual({ kind: "refuse", status: 413 });
    const streamed = new Request(`https://ttv.example${ROUTES.request}`, {
      method: "POST", body: huge, headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(await handleWelcome(streamed, ROUTES, actions)).toEqual({ kind: "refuse", status: 413 });
    expect(actions.requestAccess).not.toHaveBeenCalled();
  });

  it("reads a full-size form, every field at its limit", async () => {
    const { actions } = server(chosen(["MENTOR", "INSTITUTION"]));
    const full: RequestDraft = {
      mentorNote: "é".repeat(600), mentorLink: `https://mto.example/${"p".repeat(2000)}`, organisation: "ü".repeat(200),
      organisationRole: "ö".repeat(200), institutionNote: "ñ".repeat(600), institutionLink: `https://mto.example/${"q".repeat(2000)}`, scope: true,
    };
    const result = await handleWelcome(post(ROUTES.request, requestFields(full)), ROUTES, actions);
    expect(result).toEqual({ kind: "redirect", location: ROUTES.landing });
  });

  it("lands without writing when everything was already sent", async () => {
    const { actions } = server(OnboardingState.parse(onboardingByPersona.mercyAkinyi));
    const result = await handleWelcome(post(ROUTES.request, requestFields(mentorDraft())), ROUTES, actions);
    expect(result).toEqual({ kind: "redirect", location: ROUTES.landing });
    expect(actions.requestAccess).not.toHaveBeenCalled();
  });
});
