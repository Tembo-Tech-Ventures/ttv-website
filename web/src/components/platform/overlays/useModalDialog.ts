import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function tabbable(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.tabIndex >= 0 && element.getClientRects().length > 0,
  );
}

/**
 * A modal `<dialog>` for a shell overlay: the page behind goes inert, Tab and
 * Shift Tab cycle inside it, Escape and a click on the backdrop close it, and
 * focus goes back to the control that opened it (if it is still there).
 */
export function useModalDialog(onClosed?: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);

  const show = useCallback((from: HTMLElement | null) => {
    const dialog = ref.current;
    if (!dialog) return;
    // Asked again while open (Ctrl K twice): keep the original trigger to return to.
    if (!dialog.open) {
      trigger.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      dialog.showModal();
    }
    setOpen(true);
  }, []);

  const hide = useCallback(() => ref.current?.close(), []);

  const props = {
    ref,
    onClose() {
      setOpen(false);
      onClosed?.();
      const back = trigger.current;
      trigger.current = null;
      if (back?.isConnected) back.focus();
    },
    onClick(event: MouseEvent<HTMLDialogElement>) {
      // The dialog's own box is all content; a click that lands on the dialog itself is on the backdrop.
      if (event.target === event.currentTarget) event.currentTarget.close();
    },
    onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
      if (event.key !== "Tab") return;
      const items = tabbable(event.currentTarget);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
  };

  return { open, show, hide, props };
}
