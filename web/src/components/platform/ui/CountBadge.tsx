import { cx } from "./cx";

type CountBadgeProps = {
  /**
   * What is being counted, read after the number by screen readers: "new",
   * "unread messages", "waiting". The number alone means nothing out loud.
   */
  label: string;
  className?: string;
} & (
  | { count: number; dot?: never; max?: number }
  /** An unread marker with no number: "something new here". */
  | { dot: true; count?: never; max?: never }
);

/**
 * A peach count or unread dot. Renders nothing for a count below one, so
 * callers can pass the raw number without guarding.
 */
export default function CountBadge({ label, className, ...props }: CountBadgeProps) {
  if (props.dot) {
    return (
      <span data-count-badge="dot" className={cx("inline-flex shrink-0", className)}>
        <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  const count = Math.floor(props.count);
  if (!Number.isFinite(count) || count < 1) return null;
  const max = props.max ?? 99;
  const shown = count > max ? `${max}+` : String(count);

  return (
    <span
      data-count-badge="count"
      className={cx(
        "inline-grid h-[1.125rem] min-w-[1.125rem] shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[0.6875rem] font-bold leading-none tabular-nums text-dark",
        className,
      )}
    >
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{`${count} ${label}`}</span>
    </span>
  );
}
