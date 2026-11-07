import type { ButtonHTMLAttributes, ReactNode } from "react";
import { pillClass } from "./recipes";

type PillProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
  children: ReactNode;
  /** Selected filters are ink pills; the rest are words on the sheet. */
  pressed: boolean;
  /** How many items this filter holds. */
  count?: number;
  className?: string;
};

/** A filter toggle, as in "Needs a decision · 3 / Decided". */
export default function Pill({ children, pressed, count, className, type = "button", ...rest }: PillProps) {
  return (
    <button {...rest} type={type} aria-pressed={pressed} data-pill className={pillClass(pressed, className)}>
      {children}
      {count !== undefined && <span className="text-xs font-medium tabular-nums">{count}</span>}
    </button>
  );
}
