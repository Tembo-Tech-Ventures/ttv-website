import { useEffect, useRef } from "react";
import type { SpaceId } from "../../contracts";
import {
  CHANNEL_MAX_POLL_INTERVAL_MS, CHANNEL_POLL_INTERVAL_MS, selectPollable, type ChannelState, type ChannelStore,
} from "../channel";
import {
  selectChannelUnread, selectSpaceChannels, selectSpaceChannelUnread, type ChannelListState, type ChannelListStore,
} from "../channelList";
import { useStore } from "../store";
import { useVisibilityPolling } from "./useVisibilityPolling";

const sameItems = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((item, i) => item === b[i]);

/** Read channel state. Keeps the store alive while mounted; does not poll. */
export function useChannel<T = ChannelState>(
  store: ChannelStore,
  selector: (state: ChannelState) => T = (state => state as T),
  isEqual?: (a: T, b: T) => boolean,
): T {
  useEffect(() => store.retain(), [store]);
  return useStore(store, selector, isEqual);
}

/**
 * Mount once per channel view. Loads the latest page, then polls `since` every
 * 5 s while the tab is visible, backing off to 30 s when nothing changes and
 * pausing while hidden. Returns a function that polls immediately.
 */
export function useChannelFeed(store: ChannelStore, { enabled = true }: { enabled?: boolean } = {}): () => void {
  useEffect(() => store.retain(), [store]);
  const refresh = useVisibilityPolling({
    enabled: enabled && store.enabled,
    intervalMs: CHANNEL_POLL_INTERVAL_MS,
    maxIntervalMs: CHANNEL_MAX_POLL_INTERVAL_MS,
    run: store.poll,
    isActive: store.isPollActive,
  });
  // The poller goes quiet while there is nothing to poll; wake it when that changes.
  const pollable = useStore(store, selectPollable);
  const previous = useRef(pollable);
  useEffect(() => {
    if (pollable && !previous.current) refresh();
    previous.current = pollable;
  }, [pollable, refresh]);
  return refresh;
}

/** Read the channel list; keeps its 30 s unread polling alive while mounted. */
export function useChannelList<T = ChannelListState>(
  list: ChannelListStore,
  selector: (state: ChannelListState) => T = (state => state as T),
  isEqual?: (a: T, b: T) => boolean,
): T {
  useEffect(() => list.retain(), [list]);
  return useStore(list, selector, isEqual);
}

export function useChannelUnread(list: ChannelListStore, channelId: string): number {
  return useChannelList(list, selectChannelUnread(channelId));
}

/** Channel unread for a space badge. Attention counts stay separate (S-1.1). */
export function useSpaceChannelUnread(list: ChannelListStore, space: SpaceId): number {
  return useChannelList(list, selectSpaceChannelUnread(space));
}

export function useSpaceChannels(list: ChannelListStore, space: SpaceId) {
  return useChannelList(list, selectSpaceChannels(space), sameItems);
}
