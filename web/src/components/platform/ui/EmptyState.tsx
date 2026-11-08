import type { ReactNode } from "react";
import { cx } from "./cx";

type EmptyStateProps = {
  /** What is missing, said plainly: "No requests yet". */
  title: ReactNode;
  /** Why it is empty and what will fill it, or what the person can do. */
  children?: ReactNode;
  /** The one useful next step, if there is one: a `ButtonLink` or `Button`. */
  action?: ReactNode;
  /**
   * A small mark above the title, such as a `PersonMarker` for who will
   * appear here. Decorative; the title says it.
   */
  mark?: ReactNode;
  /** The title's level, to fit the page's outline. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
};

/**
 * The space where a list will be: a queue with nothing waiting, a search with
 * no results. It says what belongs here and how it gets filled, never just
 * "Nothing here", and it keeps the list's place on the sheet so the page does
 * not jump when the first item arrives.
 */
export default function EmptyState({ title, children, action, mark, headingLevel = 3, className }: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;

  return (
    <div
      data-empty-state
      className={cx(
        "flex min-w-0 flex-col items-start gap-2 rounded-[1.125rem] border border-dashed border-ink-primary/20 px-5 py-6 sm:px-6",
        className,
      )}
    >
      {mark && (
        <span aria-hidden="true" className="mb-1 inline-flex">
          {mark}
        </span>
      )}
      <Heading className="m-0 font-body text-base leading-snug font-bold text-ink-primary">{title}</Heading>
      {children && <div className="max-w-prose text-sm leading-relaxed text-ink-secondary">{children}</div>}
      {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}
