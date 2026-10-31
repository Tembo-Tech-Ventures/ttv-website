import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { cx } from "./cx";
import Spinner from "./Spinner";

export type ButtonVariant = "primary" | "quiet" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** A leading icon. It is hidden from assistive tech: the text is the name. */
  icon?: ReactNode;
  /**
   * The action is in flight. The button keeps focus (it is `aria-disabled`,
   * not `disabled`) and ignores further presses until it settles.
   */
  loading?: boolean;
  className?: string;
};

export const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-dark hover:bg-peach-ink",
  quiet: "border border-hairline bg-ink-primary/6 text-ink-primary hover:bg-ink-primary/10",
  ghost: "text-ink-secondary hover:bg-ink-primary/7 hover:text-ink-primary",
  danger: "border border-danger-ink/50 text-danger-ink hover:bg-danger-ink/8",
};

/*
 * Every variant goes quiet the same way when it cannot be used, rather than
 * fading its own colour: half-opacity peach on teal reads as brown, not "off".
 */
const DISABLED = "cursor-not-allowed border border-hairline bg-transparent text-ink-muted";

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-[0.8125rem]",
  md: "h-10 gap-2 rounded-xl px-4 text-sm",
};

/** Shared by every focusable primitive, so focus looks the same everywhere. */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-peach-ink";

export default function Button({
  variant = "quiet",
  size = "md",
  icon,
  loading = false,
  disabled,
  className,
  children,
  onClick,
  type = "button",
  ...rest
}: ButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-size={size}
      onClick={handleClick}
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none",
        "pointer-coarse:min-h-11",
        SIZES[size],
        disabled ? DISABLED : BUTTON_VARIANTS[variant],
        loading && "cursor-progress",
        FOCUS_RING,
        className,
      )}
    >
      {loading ? <Spinner /> : icon && <span aria-hidden="true" className="inline-flex shrink-0">{icon}</span>}
      {children}
      {loading && <span className="sr-only">, working</span>}
    </button>
  );
}
