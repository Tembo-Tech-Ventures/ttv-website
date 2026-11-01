import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  appendedSince, captureScroll, DEFAULT_BOTTOM_THRESHOLD_PX, DEFAULT_ITEM_ATTRIBUTE, END_PX, findItem, isMeasurable, restoreScroll,
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
 * - the first render with items and a box opens at `initialItemId` or the newest end;
 * - a hidden container (no box) is never measured: its last position, `atBottom`
 *   and anchor stay as they were and are re-applied when it shows again;
 * - a different scroll element (re-mounted) starts over as a new surface.
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
  const attached = useRef<HTMLElement | null>(null);
  // Opened at an item (a "New" divider or a link): only the very end counts as the bottom until the
  // reader scrolls, so an item that opens just above the end is neither followed away nor read at once.
  const heldAtItem = useRef(false);
  const ownScrollTop = useRef<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  useClientLayoutEffect(() => { latest.current = options; });

  const attribute = () => latest.current.itemAttribute ?? DEFAULT_ITEM_ATTRIBUTE;

  /**
   * Remember where the reader is now, and report the anchor when it changes. A hidden
   * container is no observation: the last real position is kept until it shows again.
   */
  const record = useCallback(() => {
    const element = ref.current;
    if (!element || !isMeasurable(element)) return;
    const threshold = heldAtItem.current ? END_PX : latest.current.bottomThresholdPx ?? DEFAULT_BOTTOM_THRESHOLD_PX;
    const next = captureScroll(element, { attribute: attribute(), bottomThresholdPx: threshold });
    // Every path but a scroll event moves the list itself: remember where, to tell the reader's scrolls apart.
    ownScrollTop.current = element.scrollTop;
    snapshot.current = next;
    setAtBottom(next.atBottom);
    const anchor = next.atBottom ? null : next.anchors[0]?.id ?? null;
    if (anchor !== reported.current) {
      reported.current = anchor;
      latest.current.onAnchor?.(anchor);
    }
  }, [ref]);

  /** Open at `initialItemId` or the newest end, once the container has items and a box. */
  const position = useCallback((element: HTMLElement) => {
    if (positioned.current || latest.current.items.length === 0 || !isMeasurable(element)) return false;
    positioned.current = true;
    const { initialItemId } = latest.current;
    heldAtItem.current = initialItemId ? revealItem(element, initialItemId, { attribute: attribute() }) : false;
    if (!heldAtItem.current) jumpToBottom(element);
    return true;
  }, []);

  /** Re-apply the last position: after a render, or when content (or the container) changes size. */
  const settle = useCallback(() => {
    const element = ref.current;
    if (!element || !isMeasurable(element)) return;
    if (!position(element) && snapshot.current) restoreScroll(element, snapshot.current, attribute());
    record();
  }, [ref, position, record]);

  /** Growing or shrinking content re-applies the last position. Children are observed again after each render. */
  const observe = useCallback((element: HTMLElement) => {
    const current = observer.current;
    if (!current) return;
    current.disconnect();
    current.observe(element);
    for (const child of Array.from(element.children)) current.observe(child);
  }, []);

  /** The reader's own scroll (not one this hook made) ends holding at the opening item. */
  const onScroll = useCallback(() => {
    const element = ref.current;
    if (element && heldAtItem.current && element.scrollTop !== ownScrollTop.current) heldAtItem.current = false;
    record();
  }, [ref, record]);

  const detach = useCallback(() => {
    attached.current?.removeEventListener("scroll", onScroll);
    observer.current?.disconnect();
    observer.current = null;
    attached.current = null;
  }, [onScroll]);

  // Follow the scroll element itself: a different node (the list re-mounted) is a new surface.
  useClientLayoutEffect(() => {
    const element = ref.current;
    if (element === attached.current) return;
    detach();
    positioned.current = false;
    heldAtItem.current = false;
    snapshot.current = null;
    if (!element) return;
    attached.current = element;
    element.style.overflowAnchor = "none";
    element.addEventListener("scroll", onScroll, { passive: true });
    if (typeof ResizeObserver !== "undefined") observer.current = new ResizeObserver(settle);
  });
  useEffect(() => detach, [detach]);

  useClientLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { items, shouldFollow } = latest.current;
    // Nothing to read yet: no position, no anchor.
    if (!positioned.current && items.length === 0) return;
    if (isMeasurable(element) && !position(element) && snapshot.current) {
      const appended = appendedSince(previous.current, items);
      if (!snapshot.current.atBottom && appended.length > 0 && shouldFollow?.(appended)) jumpToBottom(element);
      else restoreScroll(element, snapshot.current, attribute());
    }
    previous.current = items;
    record();
    observe(element);
  }, [ref, options.items, position, record, observe]);

  const scrollToBottom = useCallback(() => {
    const element = ref.current;
    if (!element || !isMeasurable(element)) return;
    heldAtItem.current = false;
    jumpToBottom(element);
    // At the bottom now, so the next render (for example a jump to latest's new page) is followed too.
    record();
  }, [ref, record]);

  const scrollToItem = useCallback((id: string, block: "start" | "center" = "start") => {
    const element = ref.current;
    if (!element || !isMeasurable(element) || !findItem(element, id, attribute())) return false;
    revealItem(element, id, { attribute: attribute(), block });
    record();
    return true;
  }, [ref, record]);

  return { atBottom, scrollToBottom, scrollToItem };
}
