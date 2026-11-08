import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { cx } from "./cx";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./recipes";
import Spinner from "./Spinner";

export { BUTTON_VARIANTS, FOCUS_RING, type ButtonSize, type ButtonVariant } from "./recipes";

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
      className={buttonClass({ variant, size, disabled, className: cx(loading && "cursor-progress", className) })}
    >
      {loading ? <Spinner /> : icon && <span aria-hidden="true" className="inline-flex shrink-0">{icon}</span>}
      {children}
      {loading && <span className="sr-only">, working</span>}
    </button>
  );
}
