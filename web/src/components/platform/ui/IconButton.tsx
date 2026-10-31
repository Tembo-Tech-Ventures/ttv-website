import type { ButtonHTMLAttributes } from "react";
import { formatCount } from "./CountBadge";
import Icon, { type IconSource } from "./Icon";
import { cx, FOCUS_RING } from "./tokens";

export type IconButtonVariant = "quiet" | "ghost";

const VARIANTS: Record<IconButtonVariant, string> = {
  quiet:
    "border-ink-primary/9 bg-ink-primary/6 text-sheet-ink-secondary enabled:hover:bg-ink-primary/10 enabled:hover:text-ink-primary",
  ghost:
    "border-transparent bg-transparent text-sheet-ink-secondary enabled:hover:bg-ink-primary/7 enabled:hover:text-ink-primary",
};

const SIZES = {
  sm: "size-8 rounded-[10px] [&_svg]:size-4",
  md: "size-[38px] rounded-xl [&_svg]:size-[18px]",
} as const;

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> {
  /** Required: an icon alone says nothing to a screen reader. */
  label: string;
  /** An element or an icon component. */
  icon: IconSource;
  variant?: IconButtonVariant;
  size?: keyof typeof SIZES;
  /** For toggles (e.g. an open panel). Pressed buttons turn warm white. */
  pressed?: boolean;
  /** A count in the corner, e.g. attention items. Zero shows nothing. */
  count?: number;
  /** An unread dot in the corner, when there is no number to give. */
  unread?: boolean;
  /** Noun for the count in the accessible name: "Notifications, 4 new". */
  countNoun?: string;
}

/** The accessible name, including whatever the corner badge shows. */
export function iconButtonName(
  label: string,
  { count = 0, unread = false, countNoun = "new" }: Pick<IconButtonProps, "count" | "unread" | "countNoun">
): string {
  const shown = formatCount(count);
  if (shown !== "0") return `${label}, ${shown} ${countNoun}`;
  return unread ? `${label}, unread` : label;
}

/**
 * A square button with only an icon. `label` is mandatory and becomes the
 * accessible name; the badge is drawn but folded into that name, so it is
 * never announced as a stray number.
 */
export default function IconButton({
  label,
  icon,
  variant = "quiet",
  size = "md",
  pressed,
  count,
  unread,
  countNoun,
  type = "button",
  className,
  ...rest
}: IconButtonProps) {
  if (!label.trim()) throw new TypeError("IconButton needs a non-empty label");

  const shown = formatCount(count ?? 0);
  return (
    <button
      {...rest}
      type={type}
      aria-label={iconButtonName(label, { count, unread, countNoun })}
      aria-pressed={pressed}
      title={rest.title ?? label}
      className={cx(
        "relative inline-grid shrink-0 place-items-center border transition-colors duration-150 motion-reduce:transition-none",
        "disabled:cursor-not-allowed disabled:opacity-55 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        FOCUS_RING,
        SIZES[size],
        pressed ? "border-transparent bg-ink-primary text-dark" : VARIANTS[variant],
        className
      )}
    >
      <Icon icon={icon} />
      {shown !== "0" ? (
        <span
          aria-hidden="true"
          data-corner="count"
          className="absolute -top-1.5 -right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-[5px] text-[11px] leading-none font-bold text-dark tabular-nums ring-2 ring-ground"
        >
          {shown}
        </span>
      ) : (
        unread && (
          <span
            aria-hidden="true"
            data-corner="dot"
            className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-ground"
          />
        )
      )}
    </button>
  );
}
