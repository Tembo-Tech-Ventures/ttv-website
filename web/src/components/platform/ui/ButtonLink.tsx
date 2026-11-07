import type { AnchorHTMLAttributes, ReactNode } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./recipes";

type ButtonLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "href"> & {
  /** Where it goes. A link that goes nowhere is a button: use `Button`. */
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** A leading icon, hidden from assistive tech. */
  icon?: ReactNode;
  /** A trailing icon, such as an arrow for a page that opens elsewhere. Hidden from assistive tech. */
  trailingIcon?: ReactNode;
  className?: string;
};

/**
 * A link that looks like a button: "Open Mentoring", "Ask for time". It goes
 * somewhere, so it stays an `<a>` and works without JavaScript; an action that
 * changes something on this page is a `Button` in a form. There is no disabled
 * link: when the destination is not open, say why in words instead.
 */
export default function ButtonLink({
  href,
  variant = "quiet",
  size = "md",
  icon,
  trailingIcon,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <a {...rest} href={href} data-variant={variant} data-size={size} className={buttonClass({ variant, size, className })}>
      {icon && (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      )}
      {children}
      {trailingIcon && (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {trailingIcon}
        </span>
      )}
    </a>
  );
}
