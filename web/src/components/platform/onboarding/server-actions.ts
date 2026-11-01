import {
  OnboardingError, createAccessRequest, dismissPrompt, getOnboardingState, markAccessRequestSeen, saveIntents,
  withdrawAccessRequest, type OnboardingErrorCode,
} from "@/lib/onboarding/service";
import type { AccountActions } from "./account-actions";
import type { WelcomeActions } from "./welcome-flow";

/** The HTTP meaning of each refusal, as the onboarding routes answer it, so the flow treats both alike. */
const STATUS: Record<OnboardingErrorCode, number> = { conflict: 409, rate_limited: 429, not_found: 404 };

/** An onboarding refusal carrying its HTTP status, which is all `handleWelcome` reads. */
export class OnboardingActionError extends Error {
  constructor(readonly status: number, readonly code: OnboardingErrorCode, message: string) {
    super(message);
    this.name = "OnboardingActionError";
  }
}

function refusal(error: unknown): unknown {
  return error instanceof OnboardingError ? new OnboardingActionError(STATUS[error.code], error.code, error.message) : error;
}

/**
 * The welcome page's server functions: B-O.2's onboarding service for one
 * signed-in person. The service's writes return nothing, so each write reads
 * the state back, the way the routes reply. The caller has already checked
 * the browser session and the flag.
 */
export function onboardingActions(db: D1Database, userId: string): WelcomeActions {
  const load = () => getOnboardingState(db, userId);
  return {
    load,
    async saveIntents(intents) {
      try {
        await saveIntents(db, userId, intents);
      } catch (error) {
        throw refusal(error);
      }
      return load();
    },
    async requestAccess(input) {
      try {
        await createAccessRequest(db, userId, input);
      } catch (error) {
        throw refusal(error);
      }
      return load();
    },
  };
}

/** Runs a write, translating the service's refusals into the statuses the forms read. */
async function attempt(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    throw refusal(error);
  }
}

/**
 * The server functions behind the onboarding forms on the landing pages and
 * Account (account-actions.ts), for one signed-in person. As above, the caller
 * has already checked the browser session and the flag.
 */
export function accountActions(db: D1Database, userId: string): AccountActions {
  return {
    load: () => getOnboardingState(db, userId),
    saveIntents: (intents) => attempt(() => saveIntents(db, userId, intents)),
    dismissPrompt: () => attempt(() => dismissPrompt(db, userId)),
    withdraw: (id) => attempt(() => withdrawAccessRequest(db, userId, id)),
    dismissRequest: (id) => attempt(() => markAccessRequestSeen(db, userId, { id })),
  };
}
