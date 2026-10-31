import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx, SHEET_BG, SHEET_VAR, type SpaceId } from "./tokens";

export interface SheetProps extends HTMLAttributes<HTMLElement> {
  tone: SpaceId;
  as?: "div" | "section" | "main";
  children: ReactNode;
}

/**
 * The space's surface: a broad sheet with rounded top corners and a soft
 * shadow cast upward onto the ground, as the homepage's sections are laid on
 * one another. A SpaceTabs row placed directly above grows out of it.
 *
 * It publishes its tone as `--pf-surface`, which avatars use for the gap
 * inside a mentor ring and around corner markers.
 */
export default function Sheet({ tone, as: Element = "div", className, style, children, ...rest }: SheetProps) {
  return (
    <Element
      {...rest}
      data-sheet={tone}
      style={{ "--pf-surface": SHEET_VAR[tone], ...style } as CSSProperties}
      className={cx(
        // Above the inactive tabs, whose feet tuck underneath; below the active one.
        "relative z-[1] rounded-t-[24px] text-ink-primary sm:rounded-t-[28px]",
        "shadow-[0_-1px_0_rgb(255_248_242/0.1),0_-28px_60px_-24px_rgb(0_0_0/0.55)]",
        SHEET_BG[tone],
        className
      )}
    >
      {children}
    </Element>
  );
}
