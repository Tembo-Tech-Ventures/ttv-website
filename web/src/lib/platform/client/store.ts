import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

export interface Store<S> {
  getState(): S;
  /** The immutable initial value, also used during SSR and hydration. */
  getServerSnapshot(): S;
  setState(update: S | ((previous: S) => S)): void;
  subscribe(listener: () => void): () => void;
}

/** Treat state as immutable. Create one store per SSR request, never per module. */
export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    getServerSnapshot: () => initial,
    setState(update) {
      const next = typeof update === "function"
        ? (update as (previous: S) => S)(state)
        : update;
      if (Object.is(state, next)) return;
      state = next;
      const snapshot = Array.from(listeners);
      for (const listener of snapshot) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export function useStore<S, T>(
  store: Store<S>,
  selector: (state: S) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const committed = useRef<{ value: T } | undefined>(undefined);
  const [getSnapshot, getServerSnapshot] = useMemo(() => {
    // Each selector has its own cache: getSnapshot must return a stable reference.
    function memoize(read: () => S) {
      let cache: { state: S; value: T } | undefined;
      return () => {
        const state = read();
        if (cache && Object.is(cache.state, state)) return cache.value;
        const selected = selector(state);
        const previous = cache ?? committed.current;
        const value = previous && isEqual(previous.value, selected) ? previous.value : selected;
        cache = { state, value };
        return value;
      };
    }
    return [memoize(store.getState), memoize(store.getServerSnapshot)];
  }, [store, selector, isEqual]);
  const value = useSyncExternalStore(store.subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => { committed.current = { value }; }, [value]);
  return value;
}
