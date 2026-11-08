import { useEffect } from "react";
import type { RequestFormState, RequestFormStore } from "../mentor-request-form";
import type { MentorRequestsState, MentorRequestsStore } from "../mentor-requests";
import { useStore } from "../store";

/**
 * Hooks over the mentor connection stores (S-4.1). Each subscribes with
 * `useSyncExternalStore` and holds the store while mounted, so the last
 * component to unmount stops its requests in flight. Actions are store methods.
 */
const whole = <S,>(state: S) => state;

export function useMentorRequests<T = MentorRequestsState>(
  store: MentorRequestsStore,
  selector: (state: MentorRequestsState) => T = whole as (state: MentorRequestsState) => T,
  isEqual?: (a: T, b: T) => boolean,
): T {
  useEffect(() => store.retain(), [store]);
  return useStore(store, selector, isEqual);
}

/** Also restores the tab's kept draft once mounted, so the server render and hydration match. */
export function useRequestForm<T = RequestFormState>(
  store: RequestFormStore,
  selector: (state: RequestFormState) => T = whole as (state: RequestFormState) => T,
  isEqual?: (a: T, b: T) => boolean,
): T {
  useEffect(() => { store.restore(); }, [store]);
  return useStore(store, selector, isEqual);
}
