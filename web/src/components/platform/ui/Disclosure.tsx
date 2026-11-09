import type { ReactNode } from "react";
import { PiCaretDown } from "react-icons/pi";
import { cx } from "./cx";
import { FOCUS_RING } from "./recipes";

type DisclosureProps = {
  /** What opening it shows, said as the reader's question or the content's name: "Where to get this credential". */
  summary: ReactNode;
  children: ReactNode;
  /** Open on arrival, such as instructions before anything has been set up. */
  open?: boolean;
  className?: string;
};

/**
 * Help or detail that most readers can skip: a native `<details>`, so it opens
 * and closes without JavaScript and every browser announces its state. The
 * summary is a full-width row, 44px on a touch screen, with the kit's focus
 * ring; the caret turns when it opens. Not for navigation, and not for the one
 * thing a page is for: that belongs on the page itself.
 */
export default function Disclosure({ summary, children, open, className }: DisclosureProps) {
  return (
    <details data-disclosure open={open || undefined} className={cx("group rounded-xl border border-hairline", className)}>
      <summary
        className={cx(
          "flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-ink-primary pointer-coarse:min-h-11",
          "[&::-webkit-details-marker]:hidden",
          FOCUS_RING,
        )}
      >
        <span className="min-w-0 flex-1">{summary}</span>
        <PiCaretDown
          aria-hidden="true"
          className="size-4 shrink-0 text-ink-muted transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="border-t border-hairline px-4 py-3 text-sm text-ink-secondary">{children}</div>
    </details>
  );
}
