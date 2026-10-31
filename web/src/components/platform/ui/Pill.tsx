import type { ButtonHTMLAttributes, ReactNode } from "react";
import { FOCUS_RING } from "./Button";
import { cx } from "./cx";

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
    <button
      {...rest}
      type={type}
      aria-pressed={pressed}
      data-pill
      className={cx(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-semibold whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none pointer-coarse:min-h-11",
        pressed ? "bg-ink-primary text-dark" : "text-ink-secondary hover:bg-ink-primary/7 hover:text-ink-primary",
        FOCUS_RING,
        className,
      )}
    >
      {children}
      {count !== undefined && <span className="text-xs font-medium tabular-nums">{count}</span>}
    </button>
  );
}
