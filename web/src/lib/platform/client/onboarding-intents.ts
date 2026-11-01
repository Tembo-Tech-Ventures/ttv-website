import { Intent, type OnboardingState } from "../contracts";

/**
 * The "How will you take part?" selection (SPEC S1, S4, S5). It stays local until saved: the server's
 * intents are the truth, and choosing an intent never grants anything.
 */
export interface IntentSelection {
  /** Always in `Intent.options` order. EXPLORING is never combined with another intent. */
  intents: readonly Intent[];
  /** Continue was pressed with nothing chosen ("Choose at least one, or pick 'I'm just looking around'."). */
  empty: boolean;
  /** Changed since the last server sync. */
  dirty: boolean;
}

export type IntentSelectionAction =
  | { type: "toggle"; intent: Intent }
  /** Choose or unchoose one intent, whatever it was before (how a toggle is replayed onto loaded state). */
  | { type: "set"; intent: Intent; chosen: boolean }
  /** "I'm just looking around": EXPLORING alone. */
  | { type: "explore" }
  /** `?intent=` from the partner pages preselects a card. It never submits. */
  | { type: "hint"; intent: unknown }
  | { type: "continue" }
  /** Apply a new server truth. `from` is the previous server intents, or null on first load. */
  | { type: "sync"; from: readonly Intent[] | null; to: readonly Intent[] };

const HINTS: Readonly<Record<string, Intent>> = { member: "MEMBER", mentor: "MENTOR", institution: "INSTITUTION" };

function ordered(intents: Iterable<Intent>): Intent[] {
  const chosen = new Set(intents);
  return Intent.options.filter(intent => chosen.has(intent));
}

function same(a: readonly Intent[], b: readonly Intent[]): boolean {
  return a.length === b.length && a.every(intent => b.includes(intent));
}

/** Adding EXPLORING replaces everything; adding anything else drops EXPLORING. */
function add(intents: readonly Intent[], intent: Intent): Intent[] {
  if (intent === "EXPLORING") return ["EXPLORING"];
  return ordered([...intents.filter(current => current !== "EXPLORING"), intent]);
}

/** The partner pages send `?intent=mentor|institution|member`. Anything else is ignored. */
export function parseIntentHint(value: unknown): Intent | null {
  return typeof value === "string" && Object.hasOwn(HINTS, value.toLowerCase()) ? HINTS[value.toLowerCase()] : null;
}

/** Saved intents, or the inferred ones as a prefill when nothing is saved (S4), plus an optional hint. */
export function initialSelection(state: OnboardingState | null, hint?: unknown): IntentSelection {
  const saved = state?.intents ?? [];
  const base: IntentSelection = { intents: ordered(saved.length > 0 ? saved : state?.inferred ?? []), empty: false, dirty: false };
  return hint === undefined ? base : intentSelectionReducer(base, { type: "hint", intent: hint });
}

/** The intents an action decides. Explore decides all of them: EXPLORING on, everything else off. */
export function intentsDecidedBy(action: IntentSelectionAction): readonly Intent[] {
  switch (action.type) {
    case "toggle": case "set": return [action.intent];
    case "explore": return Intent.options;
    case "hint": {
      const intent = parseIntentHint(action.intent);
      return intent ? [intent] : [];
    }
    case "continue": case "sync": return [];
  }
}

/** The intents a step changed or decided: what the person's net choices must record. */
export function intentsTouched(action: IntentSelectionAction, before: IntentSelection, after: IntentSelection): Intent[] {
  const decided = new Set(intentsDecidedBy(action));
  return Intent.options.filter(intent => decided.has(intent) || before.intents.includes(intent) !== after.intents.includes(intent));
}

/**
 * Applies a person's net choices (one per intent, at most four) onto a fresh selection. Recorded with
 * `intentsTouched`, they always agree with the person's own selection, so they never conflict over
 * EXPLORING and their order doesn't matter.
 */
export function replayChoices(base: IntentSelection, choices: ReadonlyMap<Intent, boolean>): IntentSelection {
  return [...choices].reduce((state, [intent, chosen]) => intentSelectionReducer(state, { type: "set", intent, chosen }), base);
}

export function intentSelectionReducer(state: IntentSelection, action: IntentSelectionAction): IntentSelection {
  switch (action.type) {
    case "toggle":
      return {
        intents: state.intents.includes(action.intent)
          ? state.intents.filter(intent => intent !== action.intent)
          : add(state.intents, action.intent),
        empty: false, dirty: true,
      };
    case "set":
      return state.intents.includes(action.intent) === action.chosen
        ? { ...state, empty: false, dirty: true }
        : intentSelectionReducer(state, { type: "toggle", intent: action.intent });
    case "explore":
      return { intents: ["EXPLORING"], empty: false, dirty: true };
    case "hint": {
      const intent = parseIntentHint(action.intent);
      if (!intent || state.intents.includes(intent)) return state;
      return { intents: add(state.intents, intent), empty: false, dirty: true };
    }
    case "continue":
      return state.intents.length === 0 && !state.empty ? { ...state, empty: true } : state;
    case "sync": {
      const to = ordered(action.to);
      if (!state.dirty) return { intents: to, empty: false, dirty: false };
      // No earlier server view to diff against: the person's unsaved choice stands as it is.
      if (action.from === null) return { ...state, dirty: !same(state.intents, to) };
      // Keep local edits, but carry over what the server changed (a withdraw removes its intent).
      const from = new Set(action.from);
      const now = new Set(to);
      const added = to.filter(intent => !from.has(intent));
      const kept = state.intents.filter(intent => now.has(intent) || !from.has(intent));
      const intents = added.reduce(add, kept);
      return { intents, empty: state.empty && intents.length === 0, dirty: !same(intents, to) };
    }
  }
}
