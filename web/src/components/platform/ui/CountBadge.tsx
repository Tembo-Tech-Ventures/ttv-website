import { cx } from "./tokens";

export const COUNT_BADGE_MAX = 99;

/** What a count reads as: whole, non-negative, and capped at "99+". */
export function formatCount(count: number, max = COUNT_BADGE_MAX): string {
  const whole = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return whole > max ? `${max}+` : String(whole);
}

export interface CountBadgeProps {
  /** Ignored for the dot variant. Zero or less renders nothing. */
  count?: number;
  /** "dot" marks something unread without saying how much. */
  variant?: "count" | "dot";
  /** "quiet" is plain muted text, for counts that aren't asking for anything. */
  tone?: "peach" | "quiet";
  /**
   * What a screen reader hears instead of the bare number, e.g. "2 unread".
   * Defaults to "<n> new" (or "Unread" for a dot).
   */
  label?: string;
  /**
   * Applied to the visible glyph only, so it can be moved or hidden without
   * silencing the spoken label. The wrapper is `display: contents`, so the
   * glyph lays out as if it were the badge itself.
   */
  className?: string;
}

/**
 * A small count or unread dot. The visible glyph is hidden from assistive
 * technology and replaced by a sentence, so "Cohort 2" is read as
 * "Cohort, 2 new" rather than as a bare number.
 */
export default function CountBadge({
  count = 0,
  variant = "count",
  tone = "peach",
  label,
  className,
}: CountBadgeProps) {
  if (variant === "dot") {
    return (
      <span data-count-badge="dot" className="contents">
        <span aria-hidden="true" className={cx("block size-[7px] rounded-full bg-primary", className)} />
        <span className="sr-only">{label ?? "Unread"}</span>
      </span>
    );
  }

  const text = formatCount(count);
  if (text === "0") return null;

  return (
    <span data-count-badge="count" className="contents">
      <span
        aria-hidden="true"
        className={cx(
          "inline-grid h-[18px] min-w-[18px] place-items-center rounded-full px-[5px] text-[11px] leading-none font-bold tabular-nums",
          tone === "peach" ? "bg-primary text-dark" : "text-sheet-ink-muted",
          className
        )}
      >
        {text}
      </span>
      <span className="sr-only">{label ?? `${text} new`}</span>
    </span>
  );
}
