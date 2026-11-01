import { useEffect, useId, useRef, useState } from "react";
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

/** Hang the sheet from the bell: its top just under it, its right edge in line. */
function hangFrom(node: HTMLElement, trigger: HTMLElement) {
  const rect = trigger.getBoundingClientRect();
  node.style.top = `${Math.round(rect.bottom + GAP_PX)}px`;
  node.style.right = `${Math.max(16, Math.round(window.innerWidth - rect.right))}px`;
}

/**
 * The desktop attention panel: a sheet that drops from the bell, over the
 * page, with everything that needs the person. On phones the bell opens the
 * attention page instead, where the same inbox has the whole screen.
 */
export default function AttentionPanel({ owner, me }: { owner: AttentionOwner; me: Me }) {
  const headingId = useId();
  const firstFilter = useRef<HTMLButtonElement>(null);
  const dialog = useModalDialog();
  const { show, hide, open } = dialog;
  const now = useNow(null);
  /** The bell the sheet hangs from, so a resize can hang it again. */
  const bell = useRef<HTMLElement | null>(null);
  /** Listening for the bell: `data-ready` tells tests a click will land. */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stop = onShellOverlay("attention", ({ trigger }) => {
      if (!window.matchMedia(WIDE).matches) {
        window.location.assign(ATTENTION_PAGE_HREF);
        return;
      }
      bell.current = trigger;
      const node = dialog.props.ref.current;
      if (node && trigger) hangFrom(node, trigger);
      show(trigger);
      firstFilter.current?.focus();
      void loadAndAnnounce(owner, () => owner.store.refresh());
      owner.store.refreshCounts().catch(() => undefined);
    });
    setReady(true);
    return stop;
  }, [owner, show, dialog.props.ref]);

  /*
   * While it is open, the sheet follows the bell as the window changes size.
   * Below the wide layout there is no room for it (the bell leads to the
   * attention page there), so it closes, and focus goes back to the bell.
   */
  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      const node = dialog.props.ref.current;
      if (!window.matchMedia(WIDE).matches) hide();
      else if (node && bell.current?.isConnected) hangFrom(node, bell.current);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, hide, dialog.props.ref]);

  /* Ctrl K reaches the window even from inside this dialog: search takes over, one overlay at a time. */
  useEffect(() => onShellOverlay("search", hide), [hide]);

  return (
    <dialog {...dialog.props} aria-labelledby={headingId} className="attention-panel" data-attention-panel data-ready={ready || undefined}>
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
