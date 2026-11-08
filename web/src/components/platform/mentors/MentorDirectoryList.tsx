import type { ReactNode } from "react";
import { PiCaretDown, PiCheck } from "react-icons/pi";
import type { MentorDirectoryItem } from "@/lib/platform/contracts";
import { MENTOR_REQUEST_FORMATS } from "@/lib/platform/client/mentor-constants";
import { askHref, directoryHref, sameArea, type DirectoryFilters } from "@/lib/platform/client/mentor-directory";
import { ButtonLink, EmptyState, FOCUS_RING, PillNav, cx, pillClass } from "@/components/platform/ui";
import MentorCard, { type MentorCardStanding } from "./MentorCard";
import { FORMAT_LABELS, MENTOR_RESULTS_ID, resultsHeading } from "./mentor-display";

/** A filter's link lands on the results heading, so a keyboard carries on from the results (QA4-18). */
const toResults = (href: string) => `${href}#${MENTOR_RESULTS_ID}`;

/** How many areas the filter row shows before "More areas": the ones most mentors offer. */
export const TOP_AREAS = 4;

/**
 * The areas shown on the filter row, and the rest under "More areas": the TOP_AREAS most mentors
 * offer (areaOptions orders them so), and the chosen one wherever it falls, so it always shows.
 */
export function splitAreas(areas: readonly string[], chosen: string | null): { shown: string[]; more: string[] } {
  const shown = areas.slice(0, TOP_AREAS);
  const pick = chosen ? areas.find(area => sameArea(area, chosen)) : undefined;
  if (pick && !shown.includes(pick)) shown.push(pick);
  return { shown, more: areas.filter(area => !shown.includes(area)) };
}

/**
 * A filter's further choices, dropping under it (details/summary, so it opens without JavaScript).
 * With JavaScript, filter-menus.ts hangs the list from whichever edge keeps it inside the row, and
 * Escape or a press elsewhere closes it.
 */
function FilterMenu({ label, active, end = false, children }: { label: ReactNode; active: boolean; end?: boolean; children: ReactNode }) {
  return (
    <details className={cx("mentor-filter-menu", end && "mentor-filter-menu--end")} data-filter-menu>
      <summary className={pillClass(active, cx("cursor-pointer", !active && "border border-hairline"))}>
        {label}
        <PiCaretDown aria-hidden className="size-4" />
      </summary>
      <ul className="mentor-filter-menu__list">{children}</ul>
    </details>
  );
}

/** One of a menu's links: the view it names, current when the page shows it. */
function MenuLink({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <li>
      <a href={toResults(href)} aria-current={current ? "page" : undefined} className={pillClass(current)}>{children}</a>
    </li>
  );
}

/**
 * The directory's filters, on one row (T06): the areas most mentors offer, the rest under "More
 * areas", how (a format) and "Has open spots". Plain links that keep the URL, so they work without JavaScript.
 */
function FilterBar({ path, filters, areas }: { path: string; filters: DirectoryFilters; areas: readonly string[] }) {
  const { shown, more } = splitAreas(areas, filters.area);
  const areaItems = [
    { label: "All", href: toResults(directoryHref(path, filters, { area: null })), current: !filters.area },
    ...shown.map(area => ({
      label: area, href: toResults(directoryHref(path, filters, { area })), current: Boolean(filters.area && sameArea(filters.area, area)),
    })),
  ];
  return (
    <nav aria-label="Filter mentors" className="flex flex-wrap items-center justify-between gap-3" data-mentor-filters>
      <div className="flex flex-wrap items-center gap-2">
        <PillNav label="Area" items={areaItems} />
        {more.length > 0 && (
          <FilterMenu label="More areas" active={false}>
            {more.map(area => <MenuLink key={area} href={directoryHref(path, filters, { area })} current={false}>{area}</MenuLink>)}
          </FilterMenu>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <FilterMenu end active={filters.format !== null} label={filters.format ? FORMAT_LABELS[filters.format] : "Any format"}>
          <MenuLink href={directoryHref(path, filters, { format: null })} current={!filters.format}>Any format</MenuLink>
          {MENTOR_REQUEST_FORMATS.map(format => (
            <MenuLink key={format} href={directoryHref(path, filters, { format })} current={filters.format === format}>{FORMAT_LABELS[format]}</MenuLink>
          ))}
        </FilterMenu>
        {/*
          A toggle: its link turns the filter off again, so it is not the current page, and says it is on
          with aria-current="true". The check is drawn only while it is on, so it never looks on when off (QA4-14).
        */}
        <a
          href={toResults(directoryHref(path, filters, { available: !filters.available }))}
          aria-current={filters.available ? "true" : undefined}
          className={pillClass(filters.available, cx("border", filters.available ? "border-transparent" : "border-hairline"))}
          data-filter-available
        >
          {filters.available && <PiCheck aria-hidden className="size-4" />}
          Has open spots
        </a>
      </div>
    </nav>
  );
}

export interface MentorDirectoryListProps {
  /** This page's path, which every filter link keeps. */
  path: string;
  /** The filters alone: following a filter, or asking, keeps them. */
  filters: DirectoryFilters;
  /** The area filters to offer. */
  areas: readonly string[];
  /** The listed mentors these filters match. */
  shown: readonly MentorDirectoryItem[];
  /** Where this person stands with each mentor, as the page read their requests. */
  standings: ReadonlyMap<string, MentorCardStanding>;
  now: number;
}

/**
 * The directory itself (screen 05), rendered on the server with no island: the filters, the results
 * heading every filter link lands on, and the mentors' cards, or what to do when none match.
 */
export default function MentorDirectoryList({ path, filters, areas, shown, standings, now }: MentorDirectoryListProps) {
  const filtered = Boolean(filters.area || filters.format || filters.available);
  return (
    <>
      <FilterBar path={path} filters={filters} areas={areas} />

      {/* Filter links land here (`#mentor-results`), so the next Tab reaches the first mentor (QA4-18). */}
      <h2
        id={MENTOR_RESULTS_ID} tabIndex={-1}
        className={cx("mt-5 mb-0 w-fit scroll-mt-40 rounded-sm text-[0.9375rem] text-ink-secondary", FOCUS_RING)}
        data-mentor-results
      >
        {resultsHeading(shown.length, filters, areas)}
      </h2>
      {shown.length > 0 ? (
        <ul className="mentor-grid" data-mentor-grid>
          {shown.map(item => (
            <MentorCard
              key={item.person.id} item={item} now={now}
              askHref={askHref(path, filters, item.person.id)} standing={standings.get(item.person.id) ?? null}
            />
          ))}
        </ul>
      ) : (
        <div className="mt-5" data-mentors-empty>
          {filtered ? (
            <EmptyState
              title="No mentors match these filters"
              action={<ButtonLink href={toResults(path)} variant="quiet">Show every mentor</ButtonLink>}
            >
              Nobody listed offers this right now. Try fewer filters.
            </EmptyState>
          ) : (
            <EmptyState title="No mentors listed yet">Mentors appear here once they've set out their availability.</EmptyState>
          )}
        </div>
      )}
    </>
  );
}
