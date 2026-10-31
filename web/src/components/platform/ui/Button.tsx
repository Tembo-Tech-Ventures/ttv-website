import type { ButtonHTMLAttributes } from "react";
import Icon, { type IconSource } from "./Icon";
import { cx, DANGER_BG, DANGER_HOVER_BG, FOCUS_RING } from "./tokens";

export type ButtonVariant = "primary" | "quiet" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap border font-bold " +
  "transition-colors duration-150 motion-reduce:transition-none " +
  "disabled:cursor-not-allowed disabled:not-aria-busy:opacity-55 aria-busy:cursor-progress " +
  // Fingers need 44px; a mouse is happy with the drawn size.
  "pointer-coarse:min-h-11";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-primary text-dark " +
    "enabled:hover:bg-[color-mix(in_srgb,var(--color-primary)_86%,var(--color-ink-primary))]",
  quiet:
    "border-ink-primary/9 bg-ink-primary/7 text-ink-primary enabled:hover:bg-ink-primary/11",
  ghost:
    "border-transparent bg-transparent text-sheet-ink-secondary enabled:hover:bg-ink-primary/7 enabled:hover:text-ink-primary",
  danger: `border-danger-ink/35 ${DANGER_BG} ${DANGER_HOVER_BG} text-danger-ink`,
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 rounded-[10px] px-3 text-[13px] [&_svg]:size-[15px]",
  md: "h-[38px] rounded-xl px-4 text-sm [&_svg]:size-4",
};

/** The classes of a button, for an `<a>` that should look like one. */
export function buttonClasses(variant: ButtonVariant = "quiet", size: ButtonSize = "md"): string {
  return cx(BASE, FOCUS_RING, VARIANTS[variant], SIZES[size]);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon, as an element or a component. Decorative: the label carries the meaning. */
  icon?: IconSource;
  /** Shows a spinner in place of the icon and blocks further presses. */
  loading?: boolean;
}

/**
 * The one button. Primary is the peach call to action (one per view, as on
 * the homepage); quiet is the everyday action; ghost sits in toolbars; danger
 * is for removing and hiding.
 */
export default function Button({
  variant = "quiet",
  size = "md",
  icon,
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant}
      className={cx(buttonClasses(variant, size), className)}
    >
      {loading ? <Spinner /> : <Icon icon={icon} />}
      {children}
    </button>
  );
}

/** A ring that turns; under reduced motion it holds still and the label stays. */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      data-spinner=""
      className="inline-block size-4 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin"
    />
  );
}
