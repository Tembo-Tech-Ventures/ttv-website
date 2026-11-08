import type { ReactNode } from "react";
import { cx } from "./cx";
import PageTitle from "./PageTitle";

type PageHeaderProps = {
  /** The page's title, its h1. */
  title: ReactNode;
  /** One sentence on what the page is for, when the title does not say it. */
  children?: ReactNode;
  /**
   * The page's one primary action, if it has one: a `ButtonLink` to where the
   * work starts, or a `Button` in its form. From an `.astro` page, wrap it in
   * `<Fragment slot="action">`.
   */
  action?: ReactNode;
  /** The title's id, for a region the title names. */
  titleId?: string;
  /** `p` only for showing a header as an example, as the style guide does. */
  titleAs?: "h1" | "p";
  className?: string;
};

/**
 * The top of a page: the title, the sentence under it and the action the page
 * exists for. The action sits beside the title from 40rem and under the
 * sentence below that, before the long content it relates to either way.
 */
export default function PageHeader({ title, children, action, titleId, titleAs, className }: PageHeaderProps) {
  return (
    <header data-page-header className={cx("flex min-w-0 flex-col gap-5 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="flex min-w-0 flex-col gap-3">
        <PageTitle id={titleId} as={titleAs}>
          {title}
        </PageTitle>
        {children && <div className="max-w-prose text-base leading-relaxed text-ink-secondary">{children}</div>}
      </div>
      {action && (
        <div data-page-action className="flex shrink-0 flex-wrap gap-2">
          {action}
        </div>
      )}
    </header>
  );
}
