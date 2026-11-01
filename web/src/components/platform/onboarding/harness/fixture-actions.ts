import {
  AccessRequestSummary, IntentSet, OnboardingState, type CreateAccessRequest,
} from "@/lib/platform/contracts";
import { FIXTURE_NOW, onboardingByPersona } from "@/lib/platform/fixtures";
import type { WelcomeActions } from "../welcome-flow";

/**
 * Onboarding state for the DEV harness, in memory, per fixture persona. It
 * answers like the onboarding routes do (B-O.1): each write returns the whole
 * state, parsed by the contract, and a request is Pending only once "sent".
 * Nothing here grants a role. `fail` makes the next writes fail the way a
 * real network does, for the failure states. `run` keeps parallel browser
 * tests apart: each sees its own copy of the persona.
 */
export const ONBOARDING_PERSONAS = ["wairimu", "mercyAkinyi", "josephOchieng", "peter"] as const;
export type OnboardingPersona = (typeof ONBOARDING_PERSONAS)[number];
export type HarnessFailure = "rate" | "save" | "conflict";

export function isOnboardingPersona(value: unknown): value is OnboardingPersona {
  return typeof value === "string" && (ONBOARDING_PERSONAS as readonly string[]).includes(value);
}

export function isHarnessFailure(value: unknown): value is HarnessFailure {
  return value === "rate" || value === "save" || value === "conflict";
}

const store = new Map<string, OnboardingState>();
let sequence = 0;
const keyOf = (persona: OnboardingPersona, run: string) => `${run}\u0000${persona}`;

/** Forgets one persona's state in one run, or everything. */
export function resetHarnessState(persona?: OnboardingPersona, run = ""): void {
  if (persona) store.delete(keyOf(persona, run));
  else store.clear();
}

const failure = (status: number) => Object.assign(new Error(`Harness failure ${status}`), { status });

export function fixtureActions(persona: OnboardingPersona, fail: HarnessFailure | null = null, run = ""): WelcomeActions {
  const key = keyOf(persona, run);
  const current = () => store.get(key) ?? OnboardingState.parse(onboardingByPersona[persona]);
  const commit = (next: OnboardingState) => {
    const parsed = OnboardingState.parse(next);
    store.set(key, parsed);
    return parsed;
  };
  return {
    async load() {
      return current();
    },
    async saveIntents(intents) {
      if (fail === "save") throw failure(503);
      return commit({ ...current(), stage: "DONE", intents: IntentSet.parse(intents) });
    },
    async requestAccess(input: CreateAccessRequest) {
      if (fail === "rate") throw failure(429);
      const state = current();
      const next = commit({ ...state, requests: [...state.requests.filter((r) => r.role !== input.role), pending(input)] });
      // "conflict": another tab sent this one a moment ago, so it is Pending and this write answers 409.
      if (fail === "conflict") throw failure(409);
      return next;
    },
  };
}

function pending(input: CreateAccessRequest): AccessRequestSummary {
  sequence += 1;
  const at = FIXTURE_NOW + sequence;
  return AccessRequestSummary.parse({
    id: `harnessaccessrequest${String(sequence).padStart(4, "0")}`,
    role: input.role,
    status: "PENDING",
    note: input.note,
    organisation: input.role === "INSTITUTION" ? input.organisation : null,
    organisationRole: input.role === "INSTITUTION" ? input.organisationRole : null,
    link: input.link,
    decisionMessage: null,
    createdAt: at,
    updatedAt: at,
    decidedAt: null,
    seenAt: null,
  });
}
