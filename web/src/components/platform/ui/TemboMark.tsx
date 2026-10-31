import type { AvatarSize } from "./Avatar";
import { cx } from "./tokens";

const SIZES: Record<AvatarSize, string> = {
  xs: "size-[18px] text-[9px] ring-1",
  sm: "size-6 text-[11px] ring-1",
  md: "size-[34px] text-[15px] ring-[1.5px]",
  lg: "size-12 text-xl ring-2",
  xl: "size-16 text-[26px] ring-2",
};

export interface TemboMarkProps {
  size?: AvatarSize;
  /** Set when "Tembo" is written beside the mark. */
  decorative?: boolean;
  className?: string;
}

/**
 * Tembo's face: the T of the wordmark, in peach on deep teal inside a peach
 * ring. It sits where a person's avatar would, and is deliberately unlike any
 * of them, so an answer from Tembo is never mistaken for a person's.
 *
 * The only Mattone in the platform primitives: it is the brand glyph, not a
 * heading.
 */
export default function TemboMark({ size = "md", decorative = false, className }: TemboMarkProps) {
  return (
    <span
      data-tembo-mark=""
      {...(decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": "Tembo" })}
      className={cx(
        "inline-grid shrink-0 place-items-center rounded-full bg-dark font-heading leading-none text-primary ring-primary ring-inset select-none",
        SIZES[size],
        className
      )}
    >
      <span aria-hidden="true" className="translate-y-[0.04em]">
        T
      </span>
    </span>
  );
}
