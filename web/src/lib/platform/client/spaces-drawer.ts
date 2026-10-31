/** Focus intents only. The UI owns DOM focus, dialog semantics and focusable elements. */
export interface SpacesDrawerState {
  open: boolean;
  focusIndex: number | null;
  focusTarget: "drawer" | "trigger" | null;
}

export const CLOSED_DRAWER: SpacesDrawerState = { open: false, focusIndex: null, focusTarget: null };

export type SpacesDrawerAction =
  | { type: "open"; itemCount: number }
  | { type: "close" }
  | { type: "focus"; index: number; itemCount: number }
  | { type: "key"; key: string; shiftKey?: boolean; itemCount: number };

function count(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** Tab wraps within the drawer, Escape requests trigger focus; other keys use native behavior. */
export function spacesDrawerReducer(state: SpacesDrawerState, action: SpacesDrawerAction): SpacesDrawerState {
  if (action.type === "close") {
    return state.open ? { open: false, focusIndex: null, focusTarget: "trigger" } : state;
  }
  if (action.type === "open") {
    return { open: true, focusIndex: count(action.itemCount) ? 0 : null, focusTarget: "drawer" };
  }
  if (!state.open) return state;
  if (action.type === "focus") {
    return Number.isSafeInteger(action.index) && action.index >= 0 && action.index < count(action.itemCount)
      ? { ...state, focusIndex: action.index, focusTarget: null } : state;
  }
  if (action.key === "Escape") return spacesDrawerReducer(state, { type: "close" });
  if (action.key !== "Tab") return state;
  const size = count(action.itemCount);
  if (!size) return { open: true, focusIndex: null, focusTarget: "drawer" };
  const current = state.focusIndex !== null && state.focusIndex < size ? state.focusIndex : null;
  const next = current === null ? (action.shiftKey ? size - 1 : 0) : (current + (action.shiftKey ? -1 : 1) + size) % size;
  return { open: true, focusIndex: next, focusTarget: "drawer" };
}
