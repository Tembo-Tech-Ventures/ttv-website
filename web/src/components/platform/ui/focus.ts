import type { KeyboardEvent } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** What Tab can reach inside `container`, in order: enabled, in the tab order and drawn. */
export function tabbable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.tabIndex >= 0 && !element.closest("[inert]") && element.getClientRects().length > 0,
  );
}

/**
 * Keep Tab and Shift Tab inside a modal: from the last control Tab goes to the
 * first, and from the first (or from the modal itself) Shift Tab goes to the
 * last. A native modal `<dialog>` already makes the page behind inert; this
 * closes the gap where the browser would hand focus to its own toolbar.
 */
export function cycleTab(event: KeyboardEvent<HTMLElement>, container: HTMLElement) {
  if (event.key !== "Tab") return;
  const items = tabbable(container);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
