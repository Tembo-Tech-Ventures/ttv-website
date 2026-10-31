import type { HTMLAttributes, ReactNode } from "react";
import { cx, RAISED_BG } from "./tokens";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "article" | "section" | "li";
  padding?: "sm" | "md";
  /** The chosen one of several (a mentor picked in a list). */
  selected?: boolean;
  children: ReactNode;
}

const PADDING = { sm: "p-3.5", md: "px-[18px] py-4" } as const;

/**
 * A smaller sheet laid on the space's sheet: a translucent warm lift with a
 * hairline, so it takes the tone of whatever space it sits in. Selection
 * is shown by a peach edge, never by a fill that would cost text contrast.
 */
export default function Card({
  as: Element = "div",
  padding = "md",
  selected = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Element
      {...rest}
      data-card=""
      data-selected={selected || undefined}
      className={cx(
        "rounded-[18px] border shadow-[0_10px_24px_-18px_rgb(0_0_0/0.7)]",
        RAISED_BG,
        PADDING[padding],
        selected ? "border-primary/45" : "border-ink-primary/9",
        className
      )}
    >
      {children}
    </Element>
  );
}
