import type { AnchorHTMLAttributes, ReactNode } from "react";
import { PiArrowLeft } from "react-icons/pi";
import { cx } from "./cx";
import { FOCUS_RING } from "./recipes";

type BackLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "href" | "children"> & {
  /** The page it goes back to, the list this detail page came from. */
  href: string;
  /** That page's name, as its own title says it: "Cohorts", "Feedback". */
  children: ReactNode;
  className?: string;
};

/**
 * The way up from a detail page to its list, above the page's title. A plain
 * link with an arrow, quiet so it never competes with the page's own action,
 * and a 44px target on a touch screen. It is positioned, so it paints, and
 * takes presses, above the display title's overhanging line box below it.
 */
export default function BackLink({ href, children, className, ...rest }: BackLinkProps) {
  return (
    <a
      {...rest}
      href={href}
      data-back-link
      className={cx(
        "relative -mx-1 inline-flex items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-ink-secondary transition-colors duration-150 motion-reduce:transition-none hover:text-ink-primary pointer-coarse:min-h-11",
        FOCUS_RING,
        className,
      )}
    >
      <PiArrowLeft aria-hidden className="size-4 shrink-0" />
      <span>{children}</span>
    </a>
  );
}
