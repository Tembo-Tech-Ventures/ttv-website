import { PiArrowLeft, PiArrowRight } from "react-icons/pi";
import ButtonLink from "./ButtonLink";
import { cx } from "./cx";

type PagerProps = {
  /** The newer page, or null on the first. */
  previousHref?: string | null;
  /** The older page, or null on the last. */
  nextHref?: string | null;
  /** Where the reader is: "21–40 of 133". */
  summary?: string;
  /** Names the navigation, when a page has more than one list: "Feedback pages". */
  label?: string;
  className?: string;
};

/**
 * The way through a list longer than one page: links to the previous and next
 * page, so it works without JavaScript and each page has its address. An end
 * of the list has no link there rather than a disabled one, and the summary
 * says where the reader is.
 */
export default function Pager({ previousHref, nextHref, summary, label = "Pages", className }: PagerProps) {
  if (!previousHref && !nextHref) return null;
  return (
    <nav aria-label={label} data-pager className={cx("flex min-w-0 flex-wrap items-center justify-between gap-3", className)}>
      <div className="flex min-w-0 gap-2">
        {previousHref && (
          <ButtonLink href={previousHref} rel="prev" icon={<PiArrowLeft />}>
            Previous
          </ButtonLink>
        )}
        {nextHref && (
          <ButtonLink href={nextHref} rel="next" trailingIcon={<PiArrowRight />}>
            Next
          </ButtonLink>
        )}
      </div>
      {summary && <p className="m-0 text-[0.8125rem] text-ink-muted">{summary}</p>}
    </nav>
  );
}
