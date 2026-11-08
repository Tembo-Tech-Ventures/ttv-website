import type { ButtonHTMLAttributes, ReactNode } from "react";
import CountBadge from "./CountBadge";
import { cx } from "./cx";
import { buttonClass, type ButtonVariant } from "./recipes";

type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "children" | "aria-label"
> & {
  /** The button's whole accessible name. An icon has no words of its own. */
  label: string;
  icon: ReactNode;
  /** As a Button's; pressed draws it ink, whatever its variant. */
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
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
      className={buttonClass({ variant, size, disabled: rest.disabled, iconOnly: true, pressed, className: cx("relative", className) })}
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
