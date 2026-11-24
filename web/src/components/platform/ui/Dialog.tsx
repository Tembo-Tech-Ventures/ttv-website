import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject, type SyntheticEvent } from "react";
import Button from "./Button";
import { cx } from "./cx";
import { cycleTab, tabbable } from "./focus";
import { DialogAnnouncements } from "./LiveAnnouncer";
import { filled } from "./slot";

type DialogProps = {
  /** Required: it names the title and description, and a `dialogOpener(id)` button opens it. */
  id: string;
  /** The question, naming the thing: "End for everyone?", "Stop recording?". */
  title: ReactNode;
  /** What happens, and whether it can be undone. Read with the title when the dialog opens. */
  children?: ReactNode;
  /**
   * The action the dialog asks about: a `danger` or `primary` Button, in its
   * own `<form method="post">` on a page without script. The dialog adds the
   * way out itself, before it. From `.astro`, `<Fragment slot="actions">`.
   */
  actions?: ReactNode;
  /** The words on the way out. */
  cancelLabel?: string;
  /**
   * In a React island: whether it is open. Islands always control it this
   * way: a dialog opened by the browser (`dialogOpener`) has no React state to
   * follow, so it cannot carry a `LiveAnnouncer`'s regions. Leave it out on a
   * static page, where `dialogOpener` opens it.
   */
  open?: boolean;
  /** Called once whenever it closes by itself: Escape, the way out, or a press on the backdrop. Set `open` to false. Not called when `open` closed it. */
  onClose?: () => void;
  /** Where focus starts. The first control by default, which is the way out when there is nothing to fill in. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Where focus goes when it closes. The control that opened it by default; pass this when that control will be gone. */
  returnFocus?: RefObject<HTMLElement | null>;
  className?: string;
};

/**
 * Props for a button that opens a `Dialog` on a page without script: the
 * browser's own invoker command (`commandfor`, `command="show-modal"`), so the
 * dialog is modal, Escape closes it, and focus goes back to the button, with
 * no JavaScript. `<Button {...dialogOpener("stop-recording")}>`.
 */
export function dialogOpener(id: string) {
  return { commandfor: id, command: "show-modal" } as const;
}

/**
 * A modal dialog: a question that has to be answered before anything else on
 * the page, asked without leaving it. A native `<dialog>` opened as a modal,
 * so the page behind is inert and dimmed.
 *
 * In a React island it is controlled by `open`: focus moves to the first
 * control (or `initialFocus`), Tab and Shift Tab stay inside, Escape, the way
 * out and a press on the backdrop close it through `onClose`, and focus goes
 * back to the control that opened it. On a static page the browser does the
 * same for a `dialogOpener` button, and the way out is a `method="dialog"`
 * form, so it closes without script.
 *
 * It is drawn in the tone of the sheet it sits in (`--space-tone`), or the
 * community sheet's outside one.
 *
 * While it is open (through `open`) inside a `LiveAnnouncer`, it carries the
 * announcer's live regions too, so what the page says is still heard past the
 * modal.
 */
export default function Dialog({
  id,
  title,
  children,
  actions,
  cancelLabel = "Cancel",
  open,
  onClose,
  initialFocus,
  returnFocus,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  /** The control that had focus when it opened, while it is open. */
  const opener = useRef<HTMLElement | null>(null);
  /** Why the close under way is happening: the caller set `open` to false, or not (Escape, the way out, the backdrop, the browser). */
  const closedByCaller = useRef(false);
  const restore = useRef(() => {});
  restore.current = () => {
    const back = returnFocus?.current ?? opener.current;
    opener.current = null;
    if (back?.isConnected) back.focus();
  };
  const controlled = open !== undefined;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !controlled) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      closedByCaller.current = false;
      dialog.showModal();
      (initialFocus?.current ?? tabbable(dialog)[0] ?? dialog).focus();
    } else if (!open && dialog.open) {
      closedByCaller.current = true;
      dialog.close();
    }
  }, [open, controlled, initialFocus]);

  useEffect(() => {
    const dialog = ref.current;
    return () => {
      // Taken away while open (its island re-rendered without it): focus still goes back. React runs
      // this after the element has left the page; StrictMode's rehearsal leaves it in place, so nothing moves.
      if (opener.current && !dialog?.isConnected) restore.current();
    };
  }, []);

  function close() {
    closedByCaller.current = false;
    ref.current?.close();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    // A part inside that handles Escape itself (an open Menu) prevents it, and the dialog stays. Escape
    // that ends an input method's composition is the composition's.
    if (event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing) {
      event.preventDefault();
      close();
      return;
    }
    cycleTab(event, event.currentTarget);
  }

  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    // The dialog's own box is all frame; a press that lands on the dialog itself is on the backdrop.
    if (event.target === event.currentTarget) close();
  }

  function handleClose(event: SyntheticEvent<HTMLDialogElement>) {
    const byCaller = closedByCaller.current;
    closedByCaller.current = false;
    // A browser fires close after the fact. Opened again since (closed and reopened in quick succession),
    // the event is stale: the dialog is open, and nobody asked to close it now.
    if (event.currentTarget.open) return;
    restore.current();
    if (!byCaller) onClose?.();
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape, the Tab cycle and the backdrop press belong to the dialog itself.
    <dialog
      ref={ref}
      id={id}
      aria-labelledby={`${id}-title`}
      aria-describedby={filled(children) ? `${id}-description` : undefined}
      data-dialog
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      onClose={handleClose}
      className={cx(
        "m-auto max-h-none w-[calc(100%-2rem)] max-w-md overflow-visible bg-transparent p-0 text-ink-primary backdrop:bg-ground/60",
        className,
      )}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col gap-4 overflow-y-auto overscroll-contain rounded-2xl border border-hairline bg-[color:var(--space-tone,var(--color-sheet-community))] p-5 shadow-overlay sm:p-6">
        <h2 id={`${id}-title`} className="m-0 font-body text-lg leading-snug text-ink-primary">
          {title}
        </h2>
        {filled(children) && (
          <div id={`${id}-description`} className="min-w-0 text-sm leading-relaxed break-words text-ink-secondary">
            {children}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* The way out comes first, so focus lands on it rather than on the action. */}
          <form method="dialog" className="contents">
            <Button
              variant="ghost"
              type="submit"
              onClick={(event) => {
                event.preventDefault();
                close();
              }}
            >
              {cancelLabel}
            </Button>
          </form>
          {filled(actions) && actions}
        </div>
        {open && <DialogAnnouncements />}
      </div>
    </dialog>
  );
}
