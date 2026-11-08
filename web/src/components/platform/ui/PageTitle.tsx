import type { ReactNode } from "react";
import { cx } from "./cx";

type PageTitleProps = {
  children: ReactNode;
  id?: string;
  /**
   * `p` only where a title is shown as an example of one, as the style guide
   * does; on a page the title is its h1, and there is exactly one.
   */
  as?: "h1" | "p";
  className?: string;
};

/**
 * The page's title: its one Mattone heading, 36–60px. Long words wrap rather
 * than push the page sideways, even inside a flex row, and the lines balance
 * so a two-line title does not leave one word alone. Sections below it are
 * Maven Pro h2s, which the base styles give every h2 without a class.
 */
export default function PageTitle({ children, id, as: Tag = "h1", className }: PageTitleProps) {
  return (
    <Tag
      id={id}
      data-page-title
      className={cx(
        "m-0 font-heading tracking-heading text-4xl text-balance wrap-anywhere text-ink-primary sm:text-5xl lg:text-6xl",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
