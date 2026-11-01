import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  appendedSince, captureScroll, DEFAULT_BOTTOM_THRESHOLD_PX, DEFAULT_ITEM_ATTRIBUTE, findItem, restoreScroll,
  scrollToBottom as jumpToBottom, scrollToItem as revealItem, type ScrollSnapshot,
} from "../scrollAnchor";

/** Layout effects only exist in the browser; on the server React would warn about them. */
const useClientLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

export interface ScrollAnchoringOptions<T extends { id: string }> {
  /** The rendered items, oldest first (for example `state.messages`). A changed list re-anchors after it renders. */
  items: readonly T[];
  /** The attribute each rendered item carries its id in. Default `data-message-row`. */
  itemAttribute?: string;
  /** Within this many pixels of the end counts as at the bottom. Default 100. */
  bottomThresholdPx?: number;
  /** Where the reader starts once items exist: this item's top, or the newest end when null or not rendered. */
  initialItemId?: string | null;
  /** Follow appended items even when the reader is not at the bottom, for example their own new message. */
  shouldFollow?: (appended: readonly T[]) => boolean;
  /**
   * The first item in view, or null at the newest end, whenever it changes. Pass the
   * channel store's `setAnchor`, so memory eviction keeps the page being read.
   */
  onAnchor?: (id: string | null) => void;
}

export interface ScrollAnchoring {
  /** The reader is at the newest end: new items will be followed. False shows "Jump to latest". */
  atBottom: boolean;
  /** Go to the newest end now, and keep following what arrives next (for example after `jumpToLatest()`). */
  scrollToBottom(): void;
  /** Bring a rendered item into view inside the container only. Returns false when it is not rendered. */
  scrollToItem(id: string, block?: "start" | "center"): boolean;
}

/**
 * Scroll anchoring for the one scroll surface of a message list (U-2.1):
 *
 * - older items prepended (or newer ones evicted above the reader) keep the
 *   reader's place, measured from the first visible item, not from heights;
 * - at the bottom, appended items and growing content (images, embeds) keep the
 *   reader at the bottom; elsewhere they never move the reader;
 * - the first render with items opens at `initialItemId` or the newest end.
 *
 * The container gets `overflow-anchor: none`, so the browser's own anchoring
 * never adjusts twice. SSR-safe: everything runs in effects.
 */
export function useScrollAnchoring<T extends { id: string }>(
  ref: RefObject<HTMLElement | null>,
  options: ScrollAnchoringOptions<T>,
): ScrollAnchoring {
  const latest = useRef(options);
  const snapshot = useRef<ScrollSnapshot | null>(null);
  const positioned = useRef(false);
  const previous = useRef<readonly T[]>([]);
  const reported = useRef<string | null | undefined>(undefined);
  const observer = useRef<ResizeObserver | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  useClientLayoutEffect(() => { latest.current = options; });

  const attribute = () => latest.current.itemAttribute ?? DEFAULT_ITEM_ATTRIBUTE;

  /** Remember where the reader is now, and report the anchor when it changes. */
  const record = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const { bottomThresholdPx = DEFAULT_BOTTOM_THRESHOLD_PX } = latest.current;
    const next = captureScroll(element, { attribute: attribute(), bottomThresholdPx });
    snapshot.current = next;
    setAtBottom(next.atBottom);
    const anchor = next.atBottom ? null : next.anchors[0]?.id ?? null;
    if (anchor !== reported.current) {
      reported.current = anchor;
      latest.current.onAnchor?.(anchor);
    }
  }, [ref]);

  /** Growing or shrinking content re-applies the last position. Children are observed again after each render. */
  const observe = useCallback((element: HTMLElement) => {
    const current = observer.current;
    if (!current) return;
    current.disconnect();
    current.observe(element);
    for (const child of Array.from(element.children)) current.observe(child);
  }, []);

  useClientLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { items, initialItemId, shouldFollow } = latest.current;
    if (!positioned.current) {
      if (items.length === 0) return;
      positioned.current = true;
      if (!initialItemId || !revealItem(element, initialItemId, { attribute: attribute() })) jumpToBottom(element);
    } else if (snapshot.current) {
      const appended = appendedSince(previous.current, items);
      if (!snapshot.current.atBottom && appended.length > 0 && shouldFollow?.(appended)) jumpToBottom(element);
      else restoreScroll(element, snapshot.current, attribute());
    }
    previous.current = items;
    record();
    observe(element);
  }, [ref, options.items, record, observe]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.overflowAnchor = "none";
    element.addEventListener("scroll", record, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      observer.current = new ResizeObserver(() => {
        if (!positioned.current || !snapshot.current) return;
        restoreScroll(element, snapshot.current, attribute());
        record();
      });
      observe(element);
    }
    return () => {
      element.removeEventListener("scroll", record);
      observer.current?.disconnect();
      observer.current = null;
    };
  }, [ref, record, observe]);

  const scrollToBottom = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    jumpToBottom(element);
    // At the bottom now, so the next render (for example a jump to latest's new page) is followed too.
    record();
  }, [ref, record]);

  const scrollToItem = useCallback((id: string, block: "start" | "center" = "start") => {
    const element = ref.current;
    if (!element || !findItem(element, id, attribute())) return false;
    revealItem(element, id, { attribute: attribute(), block });
    record();
    return true;
  }, [ref, record]);

  return { atBottom, scrollToBottom, scrollToItem };
}
