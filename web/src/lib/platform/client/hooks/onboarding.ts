import { useEffect } from "react";
import type { OnboardingClientState, OnboardingStore } from "../onboarding";
import { useStore } from "../store";

/**
 * Subscribes to an onboarding store and owns its lifecycle (load, drafts, abort on unmount).
 * The store's options choose live, injected or fixture-backed mock mode; actions are store methods.
 */
export function useOnboarding<T = OnboardingClientState>(
  store: OnboardingStore,
  selector: (state: OnboardingClientState) => T = (state => state as T),
  isEqual?: (a: T, b: T) => boolean,
): T {
  useEffect(() => store.retain(), [store]);
  return useStore(store, selector, isEqual);
}
