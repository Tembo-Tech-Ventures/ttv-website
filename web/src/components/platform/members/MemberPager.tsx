import { PiArrowLineLeft, PiArrowRight } from "react-icons/pi";
import { ButtonLink } from "@/components/platform/ui";

interface MemberPagerProps {
  /** The first page, while this is a later one. */
  firstHref: string | null;
  /** The next page, while there is one. */
  nextHref: string | null;
  /** Where the reader is: "25–48 of 57". */
  summary: string;
}

/**
 * The way through the directory, for a list paged by cursor: the next page, and
 * the way back to the start. A cursor only knows what comes after it, so there is
 * no "Previous" that would have to guess; the browser's Back goes there. Plain
 * links with their own address, so it works without JavaScript. On one page it
 * draws nothing.
 */
export default function MemberPager({ firstHref, nextHref, summary }: MemberPagerProps) {
  if (!firstHref && !nextHref) return null;
  return (
    <nav aria-label="More members" data-member-pager className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap gap-2">
        {firstHref && <ButtonLink href={firstHref} rel="first" variant="ghost" icon={<PiArrowLineLeft />}>First page</ButtonLink>}
        {nextHref && <ButtonLink href={nextHref} rel="next" trailingIcon={<PiArrowRight />}>Next</ButtonLink>}
      </div>
      {summary && <p className="m-0 text-[0.8125rem] text-ink-secondary">{summary}</p>}
    </nav>
  );
}
