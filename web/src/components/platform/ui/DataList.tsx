import type { ReactNode } from "react";
import { cx } from "./cx";
import { FOCUS_RING } from "./recipes";
import { filled } from "./slot";

/*
 * A list of things read one at a time rather than compared: feedback notes,
 * themes, requests. Each item is a row with its title as a link, a line of
 * facts under it, and room for a status and actions; rows are separated by
 * hairlines, not boxed. Composed like DataTable, so it works from `.astro`.
 */

type DataListProps = {
  /** What the list holds, for screen readers: "Feedback notes". */
  label: string;
  /** `DataListItem`s. */
  children?: ReactNode;
  /** True when there is nothing in it: the list gives way to `empty`. */
  isEmpty?: boolean;
  /** An `EmptyState`. From `.astro`, `<Fragment slot="empty">`. */
  empty?: ReactNode;
  className?: string;
};

export default function DataList({ label, children, isEmpty = false, empty, className }: DataListProps) {
  if (isEmpty) return <>{empty}</>;
  return (
    <ul aria-label={label} data-data-list className={cx("m-0 flex min-w-0 list-none flex-col p-0", className)}>
      {children}
    </ul>
  );
}

type DataListItemProps = {
  /** The thing's name. A link when `href` is given: the whole title is the target. */
  title: ReactNode;
  href?: string;
  /** Facts in a line under the title: who, when, where. */
  meta?: ReactNode;
  /** A `StatusChip`, set beside the title. From `.astro`, `<Fragment slot="status">`. */
  status?: ReactNode;
  /** One or two `RowAction`s. From `.astro`, `<Fragment slot="actions">`. */
  actions?: ReactNode;
  /** A sentence or two more: the start of a note, a summary. */
  children?: ReactNode;
  /** The title's level, to fit the page's outline: 3 under a section's h2, 2 straight under the page title. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
};

/** One thing in a `DataList`. */
export function DataListItem({ title, href, meta, status, actions, children, headingLevel = 3, className }: DataListItemProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <li data-data-list-item className={cx("flex min-w-0 flex-col gap-3 border-b border-hairline py-4 first:pt-0 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Heading className="m-0 min-w-0 text-base leading-snug break-words">
            {href ? (
              <a href={href} className={cx("rounded-sm text-ink-primary underline decoration-transparent underline-offset-4 hover:decoration-ink-primary/60", FOCUS_RING)}>
                {title}
              </a>
            ) : (
              title
            )}
          </Heading>
          {status}
        </div>
        {filled(meta) && <div className="text-[0.8125rem] leading-snug text-ink-muted">{meta}</div>}
        {filled(children) && <div className="max-w-prose text-sm leading-relaxed text-ink-secondary">{children}</div>}
      </div>
      {filled(actions) && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </li>
  );
}
