import {
  AccessRole, type AccessRequestSummary, type Intent, type Me, type OnboardingState, type SpaceId,
} from "@/lib/platform/contracts";
import { CHOICES, type ChoiceIntent } from "./copy";
import { choiceStatuses, type ChoiceStatus } from "./welcome-flow";

/**
 * How the landing pages read a person's onboarding state (SPEC §2 S3–S5, §3):
 * which Community framing they get, which status cards sit at the top of the
 * page, whether the one-time card for older accounts shows, and what the
 * Community sidebar lists under "Your requests".
 *
 * Intents choose words and order only. Every card that says something about
 * access is driven by the request and the role held, never by the intent
 * alone, so nothing here can suggest access the person does not have.
 */

/**
 * - member: "Your journey", the cohort invitation and the way to apply.
 * - exploring: a welcome card where the first contribution prompt was; the invitation stays.
 * - partner: chose to mentor or find people, not to build and learn: no cohort prompts.
 */
export type CommunityFraming = "member" | "exploring" | "partner";

/** The space each access role opens. */
export const ROLE_SPACES = { MENTOR: "mentoring", INSTITUTION: "discover" } as const satisfies Record<AccessRole, SpaceId>;

export type StatusCard =
  | { kind: "pending"; role: AccessRole; id: string; sentAt: number }
  | { kind: "approved"; role: AccessRole; id: string }
  /** The administrator's message, verbatim and untrusted: rendered as text only. */
  | { kind: "declined"; role: AccessRole; id: string; message: string | null };

export interface OnboardingView {
  state: OnboardingState;
  framing: CommunityFraming;
  /** Status cards, in role order: Mentor, then Organisation. */
  cards: StatusCard[];
  /** The one-time card for accounts from before onboarding (S4), or null. */
  prompt: { selected: ChoiceIntent[]; statuses: Partial<Record<ChoiceIntent, ChoiceStatus>> } | null;
  /** Roles granted and opened as spaces, for the "Your spaces" line in Community. */
  spaces: AccessRole[];
  /** Requests waiting for a decision, for the Community sidebar's "Your requests". */
  pending: AccessRole[];
}

const CHOICE_ORDER = CHOICES.map((choice) => choice.intent);

/**
 * The intents that apply: what the person saved, or, while nothing is saved,
 * what their roles and cohort history suggest. Inferred intents are never
 * written. EXPLORING stays as saved: it stands alone.
 */
export function effectiveIntents(state: OnboardingState): Intent[] {
  return state.intents.length > 0 ? state.intents : state.inferred;
}

/** The choices a person holds now, as the cards and switches show them: EXPLORING holds none. */
export function heldChoices(state: OnboardingState): ChoiceIntent[] {
  const held = new Set<Intent>(effectiveIntents(state));
  return CHOICE_ORDER.filter((intent) => held.has(intent));
}

export function communityFraming(state: OnboardingState): CommunityFraming {
  const intents = effectiveIntents(state);
  if (intents.includes("MEMBER")) return "member";
  // A completed onboarding with nothing left reads as exploring too (the service stores EXPLORING then).
  if (intents.includes("EXPLORING") || (state.stage === "DONE" && intents.length === 0)) return "exploring";
  if (intents.includes("MENTOR") || intents.includes("INSTITUTION")) return "partner";
  // Neither saved nor inferred: an account from before onboarding keeps the framing it always had.
  return "member";
}

function card(request: AccessRequestSummary, held: boolean): StatusCard | null {
  switch (request.status) {
    case "PENDING":
      return { kind: "pending", role: request.role, id: request.id, sentAt: request.createdAt };
    // Role state always wins: an approval whose role was removed since shows nothing.
    case "APPROVED":
      return held && request.seenAt === null ? { kind: "approved", role: request.role, id: request.id } : null;
    // A role granted since a decline is Active, not declined.
    case "DECLINED":
      return !held && request.seenAt === null
        ? { kind: "declined", role: request.role, id: request.id, message: request.decisionMessage }
        : null;
    case "WITHDRAWN":
      return null;
  }
}

/**
 * The view of a person's onboarding the landing pages render. `me` says which
 * spaces they can open; a granted role is listed under "Your spaces" only when
 * its space is actually open to them.
 */
export function onboardingView(state: OnboardingState, me: Pick<Me, "spaces">): OnboardingView {
  const cards = AccessRole.options.flatMap((role) => {
    const request = state.requests.find((candidate) => candidate.role === role);
    const status = request && card(request, state.roles.includes(role));
    return status ? [status] : [];
  });
  return {
    state,
    framing: communityFraming(state),
    cards,
    prompt: state.stage === "PROMPT" ? { selected: heldChoices(state), statuses: choiceStatuses(state) } : null,
    spaces: AccessRole.options.filter((role) => state.roles.includes(role) && me.spaces.includes(ROLE_SPACES[role])),
    pending: cards.filter((status) => status.kind === "pending").map((status) => status.role),
  };
}

/**
 * The cards for one space's landing page. An approval is announced everywhere
 * but in the space it opened: being there says it already, and opening that
 * space is what marks the approval seen.
 */
export function cardsFor(view: OnboardingView, space: SpaceId): StatusCard[] {
  return view.cards.filter((status) => status.kind !== "approved" || ROLE_SPACES[status.role] !== space);
}

/** "Your spaces" in Community: granted roles not already announced by their own Approved card. */
export function yourSpaces(view: OnboardingView): AccessRole[] {
  return view.spaces.filter((role) => !view.cards.some((status) => status.kind === "approved" && status.role === role));
}

/** Whether Community offers the cohort invitation and "Apply to a cohort": not to mentors and organisations only. */
export function offersCohort(framing: CommunityFraming | undefined): boolean {
  return framing !== "partner";
}
