import type { ReactNode } from "react";
import CountBadge from "./CountBadge";
import { cx } from "./cx";
import Sheet from "./Sheet";
import SpaceGlyph from "./SpaceGlyph";
import { SPACES, type Space } from "./spaces";
import "./platform-ui.css";

export type SpaceTabItem = {
  space: Space;
  label: string;
  href: string;
  /** New items waiting in this space. */
  count?: number;
  /** Something new, without a number worth showing. Ignored when `count` is set. */
  unread?: boolean;
};

type Person = { id: string; name: string; src?: string };

type SpaceFileProps = {
  tabs: readonly SpaceTabItem[];
  /** The space on screen: its tab is raised and the sheet takes its tone. */
  active: Space;
  /** Who is signed in. The Profile tab wears their avatar. */
  person: Person;
  /**
   * Leading content in the tab row, such as the wordmark. It stays beside the
   * tabs on their line, so keep it narrow.
   */
  start?: ReactNode;
  /**
   * Trailing content in the tab row, such as search and attention. It sits
   * beside the tabs while they fit and moves above them when they do not.
   */
  end?: ReactNode;
  /** The nav's accessible name. */
  label?: string;
  children: ReactNode;
  sheetAs?: "div" | "section" | "main" | "article";
  className?: string;
};

const ORDER = new Map(SPACES.map((space, index) => [space, index]));

function SpaceTab({ tab, active, person }: { tab: SpaceTabItem; active: boolean; person: Person }) {
  const count = tab.count === undefined ? 0 : Math.floor(tab.count);

  return (
    <li className="space-tab" data-space={tab.space} data-space-tone={tab.space} data-active={active || undefined}>
      <a className="space-tab__link" href={tab.href} aria-current={active ? "page" : undefined}>
        <span aria-hidden="true" className="inline-grid shrink-0 place-items-center">
          <SpaceGlyph space={tab.space} person={person} />
        </span>
        <span className="space-tab__label">{tab.label}</span>
        {count > 0 ? (
          <CountBadge count={count} label="new" />
        ) : (
          tab.unread && <CountBadge dot label="new activity" />
        )}
      </a>
    </li>
  );
}

/**
 * A row of space tabs standing on the sheet of the active space, like the
 * index tabs of a card file. With one role the tabs are places to go; with
 * several they double as a role switch. Geometry lives in platform-ui.css.
 */
export default function SpaceFile({
  tabs,
  active,
  person,
  start,
  end,
  label = "Spaces",
  children,
  sheetAs,
  className,
}: SpaceFileProps) {
  const ordered = tabs.toSorted((a, b) => (ORDER.get(a.space) ?? 0) - (ORDER.get(b.space) ?? 0));

  return (
    <div className={cx("space-file", className)} data-space-file={active} data-tabs={ordered.length}>
      <div className="space-file__row">
        {start && <div className="space-file__start">{start}</div>}
        <nav aria-label={label} className="space-file__nav">
          <ul className="space-file__tabs">
            {ordered.map((tab) => (
              <SpaceTab key={tab.space} tab={tab} active={tab.space === active} person={person} />
            ))}
          </ul>
        </nav>
        {end && <div className="space-file__end">{end}</div>}
      </div>
      <Sheet space={active} as={sheetAs}>
        {children}
      </Sheet>
    </div>
  );
}
