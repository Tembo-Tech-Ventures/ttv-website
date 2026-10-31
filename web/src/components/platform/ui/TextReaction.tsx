import { FOCUS_RING } from "./Button";
import { cx } from "./cx";
import { RAISED } from "./tones";

export const REACTIONS = {
  useful: "Useful",
  learned: "Learned something",
  thanks: "Thanks",
  agree: "Agree",
  congrats: "Congrats",
} as const;

export type ReactionKind = keyof typeof REACTIONS;

type TextReactionProps = {
  kind: ReactionKind;
  count: number;
  /** You are one of the people who reacted. */
  mine?: boolean;
  /**
   * Makes the chip a toggle. Without it the chip is a read-only tally, so a
   * reaction never looks pressable where it cannot be pressed.
   */
  onToggle?: () => void;
  className?: string;
};

function people(count: number) {
  return count === 1 ? "1 person" : `${count} people`;
}

/**
 * A reaction in words, not emoji: "Useful · 6". Words say what a reaction
 * means, read the same in every font, and keep the conversation's register.
 */
export default function TextReaction({ kind, count, mine = false, onToggle, className }: TextReactionProps) {
  const label = REACTIONS[kind];
  const classes = cx(
    "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[0.8125rem] font-semibold whitespace-nowrap",
    mine ? "border-primary/55 bg-primary/10 text-peach-ink" : cx("border-hairline text-ink-secondary", RAISED),
    className,
  );
  const tally = count > 0 && (
    <span aria-hidden="true" className="tabular-nums">
      · {count}
    </span>
  );

  if (!onToggle) {
    return (
      <span data-reaction={kind} data-mine={mine || undefined} className={classes}>
        {label}
        {tally}
        <span className="sr-only">{`, ${people(count)}${mine ? ", including you" : ""}`}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={mine}
      onClick={onToggle}
      data-reaction={kind}
      data-mine={mine || undefined}
      className={cx(
        classes,
        "transition-colors duration-150 motion-reduce:transition-none pointer-coarse:min-h-11",
        mine ? "hover:border-primary/80" : "hover:bg-ink-primary/7 hover:text-ink-primary",
        FOCUS_RING,
      )}
    >
      {label}
      {tally}
      <span className="sr-only">{`, ${people(count)}`}</span>
    </button>
  );
}
