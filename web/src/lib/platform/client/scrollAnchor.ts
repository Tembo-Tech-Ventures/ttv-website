/**
 * Scroll anchoring for a message list (S-2.3): keep the reader's place when
 * messages are added or removed above them, and stay at the newest end when
 * they are there. Framework-free DOM math; `hooks/scroll` wires it to React.
 *
 * Each rendered item carries its id in an attribute (default
 * `data-message-row`). Positions are measured with getBoundingClientRect
 * relative to the scroll container, so they do not depend on offsetParent.
 */

export const DEFAULT_ITEM_ATTRIBUTE = "data-message-row";
/** Within this many pixels of the end counts as reading the newest messages (docs/chat-full-page-layout.md). */
export const DEFAULT_BOTTOM_THRESHOLD_PX = 100;
/** Visible items remembered, so a restore still works when the first of them is removed. */
const ANCHOR_CANDIDATES = 3;
/** A sliver this thin (sub-pixel rounding, a hairline) is not where the reader is. */
const VISIBLE_SLIVER_PX = 1;

export interface ScrollAnchorPoint {
  id: string;
  /** The item's top edge relative to the top of the scrolling area (inside the border), in pixels. */
  offset: number;
}
/** Where the reader is: the first visible items and their offsets, or the newest end. */
export interface ScrollSnapshot {
  anchors: readonly ScrollAnchorPoint[];
  atBottom: boolean;
}
export interface ScrollAnchorOptions {
  attribute?: string;
  bottomThresholdPx?: number;
}

export function distanceFromBottom(element: HTMLElement): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight;
}

export function isAtBottom(element: HTMLElement, thresholdPx = DEFAULT_BOTTOM_THRESHOLD_PX): boolean {
  return distanceFromBottom(element) <= thresholdPx;
}

/** The top of the scrolling area: inside the container's border, where content is visible. */
function viewportTop(element: HTMLElement): number {
  return element.getBoundingClientRect().top + element.clientTop;
}

function items(element: HTMLElement, attribute: string): HTMLElement[] {
  return Array.from(element.querySelectorAll<HTMLElement>(`[${attribute}]`));
}

/** The rendered item with this id, matched by attribute value (no selector escaping needed). */
export function findItem(element: HTMLElement, id: string, attribute = DEFAULT_ITEM_ATTRIBUTE): HTMLElement | null {
  return items(element, attribute).find(item => item.getAttribute(attribute) === id) ?? null;
}

export function captureScroll(element: HTMLElement, { attribute = DEFAULT_ITEM_ATTRIBUTE, bottomThresholdPx }: ScrollAnchorOptions = {}): ScrollSnapshot {
  const top = viewportTop(element);
  const anchors: ScrollAnchorPoint[] = [];
  for (const item of items(element, attribute)) {
    const rect = item.getBoundingClientRect();
    const id = item.getAttribute(attribute);
    // Items above the viewport are not where the reader is.
    if (rect.bottom <= top + VISIBLE_SLIVER_PX || !id) continue;
    anchors.push({ id, offset: rect.top - top });
    if (anchors.length === ANCHOR_CANDIDATES) break;
  }
  return { anchors, atBottom: isAtBottom(element, bottomThresholdPx) };
}

/** Jump to the newest end at once, so following stays exact while messages keep arriving. */
export function scrollToBottom(element: HTMLElement): void {
  element.scrollTop = element.scrollHeight;
}

/**
 * Put the reader back where the snapshot was taken: at the newest end if they
 * were there, otherwise with the first anchor still rendered at the same offset.
 * Returns false when no anchor is left, leaving the position alone.
 */
export function restoreScroll(element: HTMLElement, snapshot: ScrollSnapshot, attribute = DEFAULT_ITEM_ATTRIBUTE): boolean {
  if (snapshot.atBottom) {
    scrollToBottom(element);
    return true;
  }
  const top = viewportTop(element);
  for (const anchor of snapshot.anchors) {
    const item = findItem(element, anchor.id, attribute);
    if (!item) continue;
    const shift = item.getBoundingClientRect().top - top - anchor.offset;
    if (shift !== 0) element.scrollTop += shift;
    return true;
  }
  return false;
}

/**
 * Scroll only this container (never the page) so the item's top, or its middle,
 * sits in view. Returns false when the item is not rendered.
 */
export function scrollToItem(element: HTMLElement, id: string, { attribute = DEFAULT_ITEM_ATTRIBUTE, block = "start" }: { attribute?: string; block?: "start" | "center" } = {}): boolean {
  const item = findItem(element, id, attribute);
  if (!item) return false;
  const rect = item.getBoundingClientRect();
  const offset = rect.top - viewportTop(element);
  element.scrollTop += block === "center" ? offset - (element.clientHeight - rect.height) / 2 : offset;
  return true;
}

/** Items after the previous last one: appended at the newest end. */
export function appendedSince<T extends { id: string }>(previous: readonly T[], next: readonly T[]): readonly T[] {
  const last = previous.at(-1);
  if (!last) return [];
  const index = next.findIndex(item => item.id === last.id);
  return index < 0 ? [] : next.slice(index + 1);
}
