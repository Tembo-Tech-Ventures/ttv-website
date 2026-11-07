import type { ReactNode } from "react";
import CountBadge from "./CountBadge";
import { cx } from "./cx";
// Sheet brings platform-ui.css, where the file's geometry lives.
import Sheet, { type SheetTone } from "./Sheet";

export type FileTab = {
  /** Stable and unique within the file. */
  id: string;
  label: string;
  href: string;
  /** The tone of the sheet this tab belongs to: its tab is tinted with it. */
  tone: SheetTone;
  /** A small mark before the label, hidden from assistive tech. */
  marker?: ReactNode;
  /** New items waiting behind this tab. */
  count?: number;
  /** Something new, without a number worth showing. Ignored when `count` is set. */
  unread?: boolean;
};

type TabFileProps = {
  /** In the order they stand. */
  tabs: readonly FileTab[];
  /** The tab on screen: it is raised, and the sheet takes its tone. */
  active: string;
  /**
   * The sheet's tone, when it is not simply the active tab's: a file with no
   * tabs to show (the spaces shell before its flag is on) still has a sheet.
   */
  tone?: SheetTone;
  /** Leading content in the tab row, such as a wordmark. Keep it narrow. */
  start?: ReactNode;
  /** Trailing content in the tab row: it sits beside the tabs while they fit and moves above them when they do not. */
  end?: ReactNode;
  /** The nav's accessible name. */
  label: string;
  children: ReactNode;
  sheetAs?: "div" | "section" | "main" | "article";
  className?: string;
};

function Tab({ tab, active }: { tab: FileTab; active: boolean }) {
  const count = tab.count === undefined ? 0 : Math.floor(tab.count);

  return (
    <li className="space-tab" data-tab={tab.id} data-space-tone={tab.tone} data-active={active || undefined}>
      <a className="space-tab__link" href={tab.href} aria-current={active ? "page" : undefined}>
        {tab.marker && (
          <span aria-hidden="true" className="inline-grid shrink-0 place-items-center">
            {tab.marker}
          </span>
        )}
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
 * A row of index tabs standing on a sheet, like a card file: each tab is the
 * edge of another sheet tucked behind this one, and the active tab is the top
 * of the sheet you are reading. Every tab is a link to its own page, so the
 * file works without JavaScript; it is navigation, not an ARIA tab widget.
 *
 * The spaces shell is one (`SpaceFile`); a page with a few sibling sections
 * of its own, such as the public style guide, can be another. Geometry, and
 * how the row folds at narrow widths, lives in platform-ui.css.
 */
export default function TabFile({ tabs, active, tone, start, end, label, children, sheetAs, className }: TabFileProps) {
  const sheetTone = tone ?? tabs.find((tab) => tab.id === active)?.tone;
  if (!sheetTone) throw new Error(`TabFile: no tab "${active}" among ${tabs.map((tab) => tab.id).join(", ")}, and no tone.`);
  if (new Set(tabs.map((tab) => tab.id)).size !== tabs.length) throw new Error("TabFile: tab ids must be unique.");

  // Narrow rows fold inactive tabs down to their markers; without markers there is nothing to fold to.
  const foldable = tabs.every((tab) => tab.marker);

  return (
    <div className={cx("space-file", className)} data-space-file={active} data-tabs={tabs.length} data-fold={foldable ? undefined : "off"}>
      <div className="space-file__row">
        {start && <div className="space-file__start">{start}</div>}
        <nav aria-label={label} className="space-file__nav">
          <ul className="space-file__tabs">
            {tabs.map((tab) => (
              <Tab key={tab.id} tab={tab} active={tab.id === active} />
            ))}
          </ul>
        </nav>
        {end && <div className="space-file__end">{end}</div>}
      </div>
      <Sheet space={sheetTone} as={sheetAs}>
        {children}
      </Sheet>
    </div>
  );
}
