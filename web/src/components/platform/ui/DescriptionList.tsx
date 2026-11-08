import type { ReactNode } from "react";
import { cx } from "./cx";

type DescriptionItemProps = {
  /** What the fact is: "Applied", "Cohort", "Email". */
  term: ReactNode;
  /** The fact itself: words, a date, a link or a chip. */
  children: ReactNode;
  className?: string;
};

type DescriptionListProps = {
  /** Plain facts, for the common case where every detail is text. Each term names one fact, once. */
  items?: ReadonlyArray<{ term: string; detail: ReactNode }>;
  /** `DescriptionItem`s, for details that hold a link or a chip; from `.astro` too. */
  children?: ReactNode;
  className?: string;
};

/**
 * One fact in a `DescriptionList`: its name in the muted ink, the fact in
 * the page's own. The name stacks above the fact on a phone and stands beside
 * it from 40rem.
 */
export function DescriptionItem({ term, children, className }: DescriptionItemProps) {
  return (
    <div
      data-description-item
      className={cx(
        "grid min-w-0 gap-1 border-t border-hairline py-3 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-6",
        className,
      )}
    >
      <dt className="m-0 text-sm font-semibold text-ink-secondary">{term}</dt>
      <dd className="m-0 min-w-0 text-sm leading-relaxed break-words text-ink-primary">{children}</dd>
    </div>
  );
}

/**
 * Facts about one thing, as name and value: an application's dates, a
 * person's roles, a recording's source. A real `<dl>`, so each fact is read
 * with its name, separated by hairlines rather than boxes.
 */
export default function DescriptionList({ items, children, className }: DescriptionListProps) {
  return (
    <dl data-description-list className={cx("m-0 flex min-w-0 flex-col", className)}>
      {items?.map((item) => (
        <DescriptionItem key={String(item.term)} term={item.term}>
          {item.detail}
        </DescriptionItem>
      ))}
      {children}
    </dl>
  );
}
