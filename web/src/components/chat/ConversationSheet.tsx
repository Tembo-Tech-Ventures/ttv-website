import React, { useEffect, useRef, type ReactNode } from "react";

interface ConversationSheetProps {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}

/**
 * The mobile conversation switcher, built on the native `<dialog>` so the modal
 * behaviours come from the platform rather than hand-rolled listeners:
 * `showModal()` gives a focus trap, an inert background, Escape-to-dismiss, and
 * focus restored to whatever opened it.
 *
 * It rises from the bottom rather than sliding in from the left edge. Switching
 * conversation is the control a phone user reaches for most, and a sheet puts
 * the list itself in the thumb zone even though its trigger sits in the header.
 */
export default function ConversationSheet({
  open,
  onClose,
  label,
  children,
}: ConversationSheetProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      onClose={onClose}
      className="fixed inset-0 m-0 h-full max-h-full w-full max-w-full border-0 bg-transparent p-0 backdrop:bg-dark/70 backdrop:backdrop-blur-sm lg:hidden"
    >
      {/*
        Tap-outside-to-close as a real button rather than a click handler on the
        dialog: `method="dialog"` closes it without any JS, and it lands in the
        tab order so keyboard and screen-reader users get the same escape hatch.
      */}
      <form method="dialog" className="absolute inset-0">
        <button type="submit" aria-label="Close conversations" className="h-full w-full cursor-default" />
      </form>

      <div className="absolute inset-x-0 bottom-0 flex max-h-[75dvh] flex-col rounded-t-3xl border-t border-rule bg-bg-raised pb-[env(safe-area-inset-bottom)] shadow-2xl">
        <span className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-ink-muted" />
        {children}
      </div>
    </dialog>
  );
}
