import { pillClass } from "./recipes";

export type PillNavItem = {
  label: string;
  href: string;
  current?: boolean;
  /** How many items wait behind this link. Zero shows nothing. */
  count?: number;
};

type PillNavProps = {
  /** The navigation's accessible name: "Moderation lists". */
  label: string;
  items: readonly PillNavItem[];
  /** Read after each count by screen readers: "waiting", "new". */
  countLabel?: string;
  className?: string;
};

/**
 * A row of links to the views of one page, such as a queue's open and decided
 * cases. Each view is its own address, so the row works without JavaScript and
 * the current one is `aria-current="page"`. To filter what is already on the
 * page, use `Pill` toggles instead; to move between spaces, the tab file.
 */
export default function PillNav({ label, items, countLabel = "waiting", className }: PillNavProps) {
  if (items.filter((item) => item.current).length > 1) {
    throw new Error("PillNav: at most one item can be the current page.");
  }

  return (
    <nav aria-label={label} className={className} data-pill-nav>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {items.map((item) => {
          const count = item.count === undefined ? 0 : Math.floor(item.count);
          return (
            <li key={item.href}>
              <a href={item.href} aria-current={item.current ? "page" : undefined} className={pillClass(Boolean(item.current))}>
                {item.label}
                {count > 0 && (
                  <span className="text-xs font-medium tabular-nums">
                    <span aria-hidden="true">{count}</span>
                    <span className="sr-only">{` ${count} ${countLabel}`}</span>
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
