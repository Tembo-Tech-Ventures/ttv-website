import type { ButtonHTMLAttributes, ReactNode } from "react";
import { FOCUS_RING } from "./Button";
import CountBadge from "./CountBadge";
import { cx } from "./cx";

export type IconButtonVariant = "quiet" | "ghost" | "primary";

type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "children" | "aria-label"
> & {
  /** The button's whole accessible name. An icon has no words of its own. */
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: "sm" | "md";
  /** For toggles: on or off. Leave undefined for a plain action. */
  pressed?: boolean;
  /**
   * Something waiting behind this control, such as unread attention: a number,
   * or "dot" for news without one. It joins the accessible name ("Attention,
   * 4 new"), because a badge inside an `aria-label`led button is never read.
   */
  badge?: number | "dot";
  /** What the badge counts, read after the number. */
  badgeLabel?: string;
  /** Something else behind the control that the badge does not count, read after it. */
  detail?: string;
  className?: string;
};

/** The most a badge spells out; above it, "99+". */
const BADGE_MAX = 99;

const VARIANTS: Record<IconButtonVariant, string> = {
  quiet: "border border-hairline bg-ink-primary/6 text-ink-secondary hover:bg-ink-primary/10 hover:text-ink-primary",
  ghost: "text-ink-secondary hover:bg-ink-primary/7 hover:text-ink-primary",
  primary: "bg-primary text-dark hover:bg-peach-ink",
};

const SIZES = {
  sm: "size-8 rounded-lg",
  md: "size-10 rounded-xl",
};

export default function IconButton({
  label,
  icon,
  variant = "quiet",
  size = "md",
  pressed,
  badge,
  badgeLabel = "new",
  detail,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  if (!label.trim()) {
    throw new Error("IconButton needs a label: it is the button's only accessible name.");
  }

  const count = typeof badge === "number" ? Math.floor(badge) : 0;
  const dot = badge === "dot";
  // The name reads the number the badge shows, "99+" past 99, so it always holds the visible label (WCAG 2.5.3).
  const shown = count > BADGE_MAX ? `${BADGE_MAX}+` : String(count);
  const name = [label, count > 0 ? `${shown} ${badgeLabel}` : dot ? badgeLabel : null, detail].filter(Boolean).join(", ");

  return (
    <button
      {...rest}
      type={type}
      aria-label={name}
      aria-pressed={pressed}
      data-variant={variant}
      className={cx(
        "relative inline-grid shrink-0 place-items-center transition-colors duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:bg-transparent disabled:text-ink-muted",
        "pointer-coarse:size-11",
        SIZES[size],
        pressed ? "bg-ink-primary text-dark hover:bg-ink-primary hover:text-dark" : VARIANTS[variant],
        FOCUS_RING,
        className,
      )}
    >
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
      {(count > 0 || dot) && (
        <span aria-hidden="true" className="absolute -top-1 -right-1 flex">
          {count > 0 ? (
            <CountBadge count={count} max={BADGE_MAX} label={badgeLabel} />
          ) : (
            <CountBadge dot label={badgeLabel} className="mt-1 mr-1" />
          )}
        </span>
      )}
    </button>
  );
}
