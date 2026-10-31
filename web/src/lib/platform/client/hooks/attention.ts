import { useEffect } from "react";
import type { SpaceId } from "../../contracts";
import type { AttentionState, AttentionStore } from "../attention";
import { useStore } from "../store";

/** The store options supply live, injected or fixture-backed mock mode to every hook. */
export function useAttention<T = AttentionState>(
  store: AttentionStore,
  selector: (state: AttentionState) => T = (state => state as T),
  isEqual?: (a: T, b: T) => boolean,
): T {
  useEffect(() => store.retain(), [store]);
  return useStore(store, selector, isEqual);
}
export function useAttentionCount(store: AttentionStore): number {
  return useAttention(store, state => state.counts.count);
}
export function useAttentionBadge(store: AttentionStore, space: SpaceId): number {
  return useAttention(store, state => state.counts.unreadCounts[space]);
}
