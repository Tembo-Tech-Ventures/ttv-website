import type { ButtonHTMLAttributes } from "react";
import { formatCount } from "./CountBadge";
import { CHIP_PEACH_BG, cx, FOCUS_RING, RAISED_BG, RAISED_HOVER_BG } from "./tokens";

/**
 * The fixed reaction set, in display order, matching `ReactionKind` in the
 * platform contracts (B-0.1). Words rather than emoji: they say what the
 * reader got from the message.
 */
export const REACTION_LABELS = {
  useful: "Useful",
  learned: "Learned something",
  thanks: "Thanks",
  agree: "Agree",
  congrats: "Congrats",
} as const;
export type ReactionKind = keyof typeof REACTION_LABELS;
export const REACTION_KINDS = Object.keys(REACTION_LABELS) as ReactionKind[];

export interface TextReactionProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onChange"> {
  kind: ReactionKind;
  count: number;
  /** Whether the reader has given this reaction. */
  mine: boolean;
  /**
   * Called with the membership the reader wants, never a toggle, so a retried
   * request cannot undo itself (the contract's `ReactToMessage.active`).
   */
  onChange?: (active: boolean) => void;
}

/** "Useful, 6 people" — the visible "Useful · 6" as a sentence. */
export function reactionName(kind: ReactionKind, count: number): string {
  const shown = formatCount(count);
  if (shown === "0") return REACTION_LABELS[kind];
  return `${REACTION_LABELS[kind]}, ${shown} ${shown === "1" ? "person" : "people"}`;
}

/**
 * A reaction chip. It is a toggle button: `aria-pressed` tells a screen reader
 * whether it is yours, and yours are drawn in peach.
 */
export default function TextReaction({
  kind,
  count,
  mine,
  onChange,
  className,
  type = "button",
  onClick,
  ...rest
}: TextReactionProps) {
  const shown = formatCount(count);
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={mine}
      aria-label={reactionName(kind, count)}
      data-reaction={kind}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onChange?.(!mine);
      }}
      className={cx(
        "relative inline-flex h-[26px] shrink-0 items-center gap-[5px] rounded-full border px-[9px] text-[12.5px] font-semibold whitespace-nowrap",
        "transition-colors duration-150 motion-reduce:transition-none",
        // A finger gets a 44px-tall target without the chip itself growing:
        // the hit area reaches 10px above and below the drawn pill.
        "pointer-coarse:before:absolute pointer-coarse:before:inset-x-0 pointer-coarse:before:-inset-y-[10px]",
        "disabled:cursor-not-allowed disabled:opacity-55",
        FOCUS_RING,
        mine
          ? `border-primary/40 ${CHIP_PEACH_BG} text-peach-ink`
          : `border-ink-primary/9 ${RAISED_BG} ${RAISED_HOVER_BG} text-sheet-ink-secondary hover:text-ink-primary`,
        className
      )}
    >
      <span aria-hidden="true">{REACTION_LABELS[kind]}</span>
      {shown !== "0" && (
        <span aria-hidden="true" className="tabular-nums">
          · {shown}
        </span>
      )}
    </button>
  );
}
