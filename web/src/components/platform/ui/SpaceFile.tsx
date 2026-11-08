import type { ReactNode } from "react";
import SpaceGlyph from "./SpaceGlyph";
import { SPACES, type Space } from "./spaces";
import TabFile from "./TabFile";

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

/**
 * The spaces as a tab file standing on the active space's sheet. With one
 * role the tabs are places to go; with several they double as a role switch.
 * Spaces always stand in the same order, Profile last, each with its glyph.
 */
export default function SpaceFile({ tabs, active, person, start, end, label = "Spaces", children, sheetAs, className }: SpaceFileProps) {
  const ordered = tabs.toSorted((a, b) => (ORDER.get(a.space) ?? 0) - (ORDER.get(b.space) ?? 0));

  return (
    <TabFile
      tabs={ordered.map((tab) => ({
        id: tab.space,
        label: tab.label,
        href: tab.href,
        tone: tab.space,
        marker: <SpaceGlyph space={tab.space} person={person} />,
        count: tab.count,
        unread: tab.unread,
      }))}
      active={active}
      tone={active}
      start={start}
      end={end}
      label={label}
      sheetAs={sheetAs}
      className={className}
    >
      {children}
    </TabFile>
  );
}
