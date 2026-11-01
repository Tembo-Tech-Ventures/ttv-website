import { AccessRole, type Intent, type IntentSet, type OnboardingState } from "@/lib/platform/contracts";
import { SPACE_PATHS, WELCOME_PATH } from "@/lib/platform/server/space-routes";
import { CHOICES, type ChoiceIntent } from "./copy";
import { heldChoices } from "./framing";
import { requestableRoles } from "./welcome-flow";

/**
 * The onboarding forms outside the welcome step: the one-time card (S4), the
 * status cards' Dismiss (S3) and Account → "How you take part" (S5). They are
 * plain forms that post to the Account page, so every one works without
 * JavaScript, and each answers with a redirect back to the page it came from
 * (post, redirect, get), so a reload never sends anything twice.
 *
 * Nothing here grants access. Asking for mentor or organisation access goes
 * on to the request step, and the request is what an administrator decides.
 */

/** The field that marks a post as one of these forms, and names what it does. */
export const ACTION_FIELD = "onboarding";
/** Where to return afterwards: one of RETURN_PATHS, never an arbitrary URL. */
export const RETURN_FIELD = "return";
/** Added to the return path when a write failed, so the page can say so. */
export const UNSAVED_PARAM = "onboarding";
export const UNSAVED_VALUE = "unsaved";
/** The same parameter after the one-time card was saved or hidden, so the page says so instead of just losing it. */
export const PROMPT_SAVED_VALUE = "saved";
export const PROMPT_HIDDEN_VALUE = "hidden";

export const ACCOUNT_PATH = "/dashboard/account";
export const TAKING_PART_ID = "taking-part";

/** One access's row in Account → "How you take part", where "View request" leads. */
export function requestRowId(access: AccessRole): string {
  return `${TAKING_PART_ID}-request-${access.toLowerCase()}`;
}

/** The pages these forms sit on: the landing pages of the spaces, and Account. */
export const RETURN_PATHS: readonly string[] = [
  SPACE_PATHS.cohort, SPACE_PATHS.community, SPACE_PATHS.mentoring, SPACE_PATHS.discover, ACCOUNT_PATH,
];

export const ACCOUNT_ACTIONS = ["save-prompt", "dismiss-prompt", "member", "request", "withdraw", "remove", "dismiss"] as const;
export type AccountAction = (typeof ACCOUNT_ACTIONS)[number];

/** The person's onboarding services, as the routes would call them. Writes return nothing; the page reads state again. */
export interface AccountActions {
  load(): Promise<OnboardingState>;
  saveIntents(intents: IntentSet): Promise<void>;
  dismissPrompt(): Promise<void>;
  withdraw(id: string): Promise<void>;
  /** Marks an approved or declined request seen: its card stops. */
  dismissRequest(id: string): Promise<void>;
}

export type AccountResult = { kind: "redirect"; location: string } | { kind: "refuse"; status: 400 };

/** Where the form came from, if it is one of these pages. Account returns to its own section. */
export function returnPath(value: FormDataEntryValue | null): string {
  const path = typeof value === "string" && RETURN_PATHS.includes(value) ? value : ACCOUNT_PATH;
  return path === ACCOUNT_PATH ? `${ACCOUNT_PATH}#${TAKING_PART_ID}` : path;
}

/** The return path with what happened to the person's form, for the page to say. */
function noted(location: string, value: string): string {
  const [path, fragment] = location.split("#", 2);
  return `${path}?${UNSAVED_PARAM}=${value}${fragment ? `#${fragment}` : ""}`;
}

function isAction(value: FormDataEntryValue | null): value is AccountAction {
  return typeof value === "string" && (ACCOUNT_ACTIONS as readonly string[]).includes(value);
}

function role(form: FormData): AccessRole | null {
  const parsed = AccessRole.safeParse(form.get("role"));
  return parsed.success ? parsed.data : null;
}

function id(form: FormData): string | null {
  const value = form.get("id");
  return typeof value === "string" && value.length > 0 && value.length <= 255 ? value : null;
}

/** The choices a person holds with one added or removed. EXPLORING goes as soon as anything is chosen. */
function withChoice(state: OnboardingState, intent: Exclude<Intent, "EXPLORING">, on: boolean): Intent[] {
  const held = heldChoices(state).filter((choice) => choice !== intent);
  return on ? [...held, intent] : held;
}

/** Records the choice, then goes on to the request step if the person can now ask for that access. */
async function choose(actions: AccountActions, intents: Intent[], back: string, only: AccessRole | null = null): Promise<string> {
  await actions.saveIntents(intents);
  if (requestableRoles(await actions.load(), only).length === 0) return back;
  return `${WELCOME_PATH}?step=request${only ? `&role=${only.toLowerCase()}` : ""}`;
}

async function perform(action: AccountAction, form: FormData, actions: AccountActions, back: string): Promise<string | null> {
  switch (action) {
    case "save-prompt": {
      const ticked = new Set(form.getAll("intent"));
      const chosen: ChoiceIntent[] = CHOICES.map((choice) => choice.intent).filter((intent) => ticked.has(intent));
      // Nothing ticked: the welcome step asks properly, with "I'm just looking around" beside the cards.
      if (chosen.length === 0) return WELCOME_PATH;
      const next = await choose(actions, chosen, back);
      return next === back ? noted(back, PROMPT_SAVED_VALUE) : next;
    }
    case "dismiss-prompt":
      await actions.dismissPrompt();
      return noted(back, PROMPT_HIDDEN_VALUE);
    case "member": {
      const on = form.get("value") === "on";
      if (!on && form.get("value") !== "off") return null;
      await actions.saveIntents(withChoice(await actions.load(), "MEMBER", on));
      return back;
    }
    case "request": {
      const target = role(form);
      if (!target) return null;
      return choose(actions, withChoice(await actions.load(), target, true), back, target);
    }
    case "remove": {
      // Only a choice with no request waiting: a pending request is withdrawn, which removes its choice too.
      const target = role(form);
      if (!target) return null;
      const state = await actions.load();
      if (state.requests.some((request) => request.role === target && request.status === "PENDING")) return back;
      await actions.saveIntents(withChoice(state, target, false));
      return back;
    }
    case "withdraw":
    case "dismiss": {
      const target = id(form);
      if (!target) return null;
      await (action === "withdraw" ? actions.withdraw(target) : actions.dismissRequest(target));
      return back;
    }
  }
}

/** A refusal the page shows by reading state again: the request was decided, withdrawn or never theirs. */
function isStale(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "status" in error ? (error as { status: unknown }).status : undefined;
  return status === 404 || status === 409;
}

/**
 * Runs one of these forms. A refusal because the request moved on (decided,
 * withdrawn, not theirs) returns to the page, which shows what is true now;
 * any other failure returns with a note that nothing was saved.
 */
export async function handleAccountAction(form: FormData, actions: AccountActions): Promise<AccountResult> {
  const action = form.get(ACTION_FIELD);
  if (!isAction(action)) return { kind: "refuse", status: 400 };
  const back = returnPath(form.get(RETURN_FIELD));
  try {
    const location = await perform(action, form, actions, back);
    return location === null ? { kind: "refuse", status: 400 } : { kind: "redirect", location };
  } catch (error) {
    return { kind: "redirect", location: isStale(error) ? back : noted(back, UNSAVED_VALUE) };
  }
}
