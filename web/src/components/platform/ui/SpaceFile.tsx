import type { ReactNode } from "react";
import Avatar from "./Avatar";
import CountBadge from "./CountBadge";
import { cx } from "./cx";
import Sheet from "./Sheet";
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

/** Each space's marker, in the homepage's network language. */
function SpaceGlyph({ space, person }: { space: Space; person: Person }) {
  switch (space) {
    case "cohort":
      return <span className="size-2.5 rounded-full bg-primary" />;
    case "community":
      return (
        <span className="relative h-3 w-[1.125rem]">
          <span className="absolute bottom-0.5 left-0 size-2 rounded-full bg-primary" />
          <span className="absolute top-0 right-0 size-[0.6875rem] rounded-full border-2 border-ring" />
        </span>
      );
    case "mentoring":
      return <span className="size-[0.6875rem] rounded-full border-2 border-ring" />;
    case "discover":
      return <span className="size-2 rotate-45 bg-ink-primary" />;
    case "admin":
      return <span className="size-2.5 rounded-[3px] border-2 border-primary" />;
    case "profile":
      return <Avatar id={person.id} name={person.name} src={person.src} size="xs" decorative />;
  }
}

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
