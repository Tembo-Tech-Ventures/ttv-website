import React, { useEffect, type ReactNode } from "react";
import { useModalDialog } from "@/components/platform/overlays/useModalDialog";

interface ConversationSheetProps {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}

/**
 * The mobile conversation switcher: a modal `<dialog>` through the spaces
 * overlays' `useModalDialog`, so it behaves as their overlays do. The page
 * behind goes inert, Tab stays inside, Escape and a tap outside close it, and
 * focus goes back to whatever opened it.
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
  const { show, hide, props } = useModalDialog(onClose);

  // ChatApp owns whether it is open; the hook only opens and closes the dialog.
  useEffect(() => {
    if (open) show(null);
    else hide();
  }, [open, show, hide]);

  return (
    <dialog
      {...props}
      aria-label={label}
      className="fixed inset-0 m-0 h-full max-h-full w-full max-w-full border-0 bg-transparent p-0 backdrop:bg-ground/60 lg:hidden"
    >
      {/*
        Tap-outside-to-close as a real button rather than only the backdrop:
        `method="dialog"` closes it without a handler, and it lands in the tab
        order so keyboard and screen-reader users get the same way out.
      */}
      <form method="dialog" className="absolute inset-0">
        <button type="submit" aria-label="Close conversations" className="h-full w-full cursor-default" />
      </form>

      <div className="absolute inset-x-0 bottom-0 flex max-h-[75dvh] flex-col rounded-t-3xl border-t border-hairline bg-sheet-community pb-[env(safe-area-inset-bottom)] text-ink-primary shadow-overlay">
        <span aria-hidden="true" className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-ink-muted" />
        {children}
      </div>
    </dialog>
  );
}
