import type { ReactNode } from "react";
import { cx } from "./cx";
import { CHIP_TONES, type ChipTone } from "./tones";

type ChipProps = {
  children: ReactNode;
  tone?: ChipTone;
  /** A leading icon, hidden from assistive tech. */
  icon?: ReactNode;
  className?: string;
};

/** A small static label: a skill, a citation, a status. Not a control. */
export default function Chip({ children, tone = "neutral", icon, className }: ChipProps) {
  return (
    <span
      data-chip={tone}
      className={cx(
        "inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap",
        CHIP_TONES[tone],
        className,
      )}
    >
      {icon && (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}
