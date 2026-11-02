/*
 * The page never scrolls in a channel view: the message list does (channels.css). A wheel turned over
 * the header, the posting note or the composer's edges would otherwise move nothing (QA2-17), so it
 * scrolls the list instead, unless something under the pointer can still scroll that way itself (a
 * long draft, say). The list's own wheel is the browser's, untouched, as is the scroll anchoring that
 * reads its scroll events.
 */

const LINE = 16;

/** Whether this element scrolls itself and has room left in the wheel's direction. */
function scrollsItself(element: Element, deltaY: number): boolean {
  if (!/auto|scroll/.test(getComputedStyle(element).overflowY)) return false;
  return deltaY < 0 ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight;
}

/** Turn a wheel over the channel's column, outside its list, into the list's scroll. */
export function wheelScrollsList(event: WheelEvent, column: HTMLElement): void {
  if (event.defaultPrevented || event.ctrlKey || event.deltaY === 0) return;
  const list = column.querySelector<HTMLElement>("[data-channel-scroller]");
  const target = event.target;
  // An icon's SVG is often what the pointer is over, so any element counts, not only HTML ones.
  if (!list || !(target instanceof Element) || list.contains(target) || !column.contains(target)) return;
  for (let element: Element | null = target; element && element !== column; element = element.parentElement) {
    if (scrollsItself(element, event.deltaY)) return;
  }
  const unit = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? list.clientHeight : 1;
  list.scrollTop += event.deltaY * unit;
}
