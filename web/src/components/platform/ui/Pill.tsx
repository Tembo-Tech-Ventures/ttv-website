import type { ReactNode } from "react";
import Icon, { type IconSource } from "./Icon";
import { CHIP_NEUTRAL_BG, CHIP_PEACH_BG, CHIP_RING_BG, cx } from "./tokens";

export type PillTone = "neutral" | "peach" | "ring";

const TONES: Record<PillTone, string> = {
  neutral: `${CHIP_NEUTRAL_BG} text-sheet-ink-secondary`,
  peach: `${CHIP_PEACH_BG} text-peach-ink`,
  ring: `${CHIP_RING_BG} text-ring`,
};

const SIZES = {
  sm: "h-6 gap-1.5 px-[9px] text-xs [&_svg]:size-[13px]",
  md: "h-8 gap-1.5 border border-ink-primary/9 px-3 text-[13px] [&_svg]:size-[15px]",
} as const;

export interface PillProps {
  tone?: PillTone;
  size?: keyof typeof SIZES;
  /** Leading icon, as an element or a component; decorative. */
  icon?: IconSource;
  children: ReactNode;
  className?: string;
}

/**
 * A static label: a skill, a source, a status. Not a control; anything you
 * can press is a Button or a TextReaction.
 */
export default function Pill({ tone = "neutral", size = "sm", icon, children, className }: PillProps) {
  return (
    <span
      data-pill={tone}
      className={cx(
        "inline-flex shrink-0 items-center rounded-full font-semibold whitespace-nowrap",
        TONES[tone],
        SIZES[size],
        className
      )}
    >
      <Icon icon={icon} />
      {children}
    </span>
  );
}
