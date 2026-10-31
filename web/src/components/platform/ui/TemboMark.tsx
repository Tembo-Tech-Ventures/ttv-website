import { AVATAR_SIZES, type AvatarSize } from "./Avatar";
import { cx } from "./cx";

/** Avatar sizes, plus "marker" for the 16px mark beside a name. */
type TemboMarkSize = AvatarSize | "marker";

const SIZES: Record<TemboMarkSize, string> = {
  ...AVATAR_SIZES,
  marker: "size-4 text-[0.5rem]",
};

type TemboMarkProps = {
  size?: TemboMarkSize;
  /** "Tembo" is already written beside the mark. */
  decorative?: boolean;
  className?: string;
};

/**
 * Tembo, the AI, has a mark rather than an avatar: the T in Mattone, peach on
 * dark teal inside a peach ring. It is the only place the display face appears
 * in the primitives, so Tembo is never mistaken for a person.
 */
export default function TemboMark({ size = "md", decorative = false, className }: TemboMarkProps) {
  return (
    <span
      data-tembo-mark
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Tembo"}
      aria-hidden={decorative || undefined}
      className={cx(
        "inline-grid shrink-0 place-items-center rounded-full border-primary bg-dark font-heading leading-none text-primary select-none",
        SIZES[size],
        size === "marker" ? "border" : "border-[1.5px]",
        className,
      )}
    >
      <span aria-hidden="true" className="translate-y-px">
        T
      </span>
    </span>
  );
}
