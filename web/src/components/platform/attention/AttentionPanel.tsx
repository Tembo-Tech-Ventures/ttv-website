import { useCallback, useEffect, useId, useRef } from "react";
import { PiX } from "react-icons/pi";
import type { Me } from "@/lib/platform/contracts";
import { IconButton } from "@/components/platform/ui";
import { onShellOverlay } from "@/components/platform/shell/overlays";
import { useModalDialog } from "@/components/platform/overlays/useModalDialog";
import { loadAndAnnounce, type AttentionOwner } from "./attention-client";
import { ATTENTION_PAGE_HREF } from "./attention-display";
import AttentionInbox, { MarkAll, useNow } from "./AttentionInbox";
import "./attention.css";

/** The panel needs the wide layout's room; below it the bell leads to the attention page. */
const WIDE = "(min-width: 64rem)";
const GAP_PX = 10;

/**
 * The desktop attention panel: a sheet that drops from the bell, over the
 * page, with everything that needs the person. On phones the bell opens the
 * attention page instead, where the same inbox has the whole screen.
 */
export default function AttentionPanel({ owner, me }: { owner: AttentionOwner; me: Me }) {
  const headingId = useId();
  const firstFilter = useRef<HTMLButtonElement>(null);
  const dialog = useModalDialog();
  const { open, show, hide } = dialog;
  const dialogRef = dialog.props.ref;
  const now = useNow(null);
  /** The bell the sheet hangs from, while it is open. */
  const anchor = useRef<HTMLElement | null>(null);

  /** Hang the sheet from the bell: its top just under it, its right edge in line. */
  const place = useCallback(() => {
    const rect = anchor.current?.getBoundingClientRect();
    const node = dialogRef.current;
    if (!node || !rect) return;
    node.style.top = `${Math.round(rect.bottom + GAP_PX)}px`;
    node.style.right = `${Math.max(16, Math.round(window.innerWidth - rect.right))}px`;
  }, [dialogRef]);

  useEffect(
    () =>
      onShellOverlay("attention", ({ trigger }) => {
        if (!window.matchMedia(WIDE).matches) {
          window.location.assign(ATTENTION_PAGE_HREF);
          return;
        }
        anchor.current = trigger;
        place();
        show(trigger);
        firstFilter.current?.focus();
        void loadAndAnnounce(owner, () => owner.store.refresh());
        owner.store.refreshCounts().catch(() => undefined);
      }),
    [owner, show, place],
  );

  /*
   * While open, the sheet follows the bell as the window resizes. Below the
   * wide layout there is no room for a panel (the bell leads to the attention
   * page there), so it closes rather than hanging from stale coordinates.
   */
  useEffect(() => {
    if (!open) return;
    const follow = () => (window.matchMedia(WIDE).matches ? place() : hide());
    window.addEventListener("resize", follow);
    return () => window.removeEventListener("resize", follow);
  }, [open, hide, place]);

  /* Ctrl K reaches the window even from inside this dialog: search takes over, one overlay at a time. */
  useEffect(() => onShellOverlay("search", hide), [hide]);

  return (
    <dialog {...dialog.props} aria-labelledby={headingId} className="attention-panel" data-attention-panel>
      <div className="attention-panel__sheet">
        <header className="attention-panel__header">
          <h2 id={headingId} className="font-body text-xl font-bold tracking-subhead text-ink-primary">
            Needs your attention
          </h2>
          <span className="flex shrink-0 items-center gap-1">
            <MarkAll owner={owner} me={me} />
            <IconButton label="Close" icon={<PiX size={18} />} variant="ghost" size="sm" onClick={dialog.hide} />
          </span>
        </header>
        <AttentionInbox owner={owner} me={me} headingId={headingId} now={now} initialFocusRef={firstFilter} />
      </div>
    </dialog>
  );
}
