import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { pillClass } from "./recipes";

type PillProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
  children: ReactNode;
  /** Selected filters are ink pills; the rest are words on the sheet. */
  pressed: boolean;
  /** How many items this filter holds. */
  count?: number;
  className?: string;
};

/**
 * A filter toggle, as in "Needs a decision · 3 / Decided". It takes a ref, so
 * a dialog can put focus on the filter that is on when it opens.
 */
const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill({ children, pressed, count, className, type = "button", ...rest }, ref) {
  return (
    <button {...rest} ref={ref} type={type} aria-pressed={pressed} data-pill className={pillClass(pressed, className)}>
      {children}
      {count !== undefined && <span className="text-xs font-medium tabular-nums">{count}</span>}
    </button>
  );
});

export default Pill;
