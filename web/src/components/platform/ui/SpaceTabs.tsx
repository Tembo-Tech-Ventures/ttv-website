import type { CSSProperties } from "react";
import Avatar from "./Avatar";
import CountBadge from "./CountBadge";
import PersonMarker, { type MarkerKind } from "./PersonMarker";
import { cx, SHEET_VAR, SPACE_ORDER, type SpaceId } from "./tokens";

export const SPACE_LABELS: Record<SpaceId, string> = {
  cohort: "Cohort",
  community: "Community",
  mentoring: "Mentoring",
  discover: "Discover",
  admin: "Admin",
  profile: "Profile",
};

/** Profile shows the person's own face instead of a marker. */
const SPACE_MARKERS: Record<Exclude<SpaceId, "profile">, MarkerKind> = {
  cohort: "builder",
  community: "community",
  mentoring: "mentor",
  discover: "institution",
  admin: "staff",
};

export interface SpaceTabItem {
  id: SpaceId;
  href: string;
  /** Things waiting in this space. Takes precedence over `unread`. */
  count?: number;
  /** Something new, without a number. */
  unread?: boolean;
}

export interface ProfileFace {
  id: string;
  name: string;
  src?: string | null;
}

/** The spaces a person has, deduplicated and always in the fixed order. */
export function orderSpaces(items: readonly SpaceTabItem[]): SpaceTabItem[] {
  const byId = new Map<SpaceId, SpaceTabItem>();
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
  return SPACE_ORDER.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

/*
 * Geometry. A sheet's top corner is 24px (28px from `sm`), and each fillet is
 * 14px wide, so the row starts 40px (44px) in: every fillet then lands on the
 * straight part of the sheet's edge, never over its curve.
 *
 * Inactive tabs are 48px and sit 4px low, so their feet tuck under the sheet
 * (which is z-1) and 44px stays visible: the touch target. The active tab is
 * 52px, sits above the sheet (z-2) and overlaps its top hairline by 1px, so
 * the tab and the sheet read as one surface with no seam.
 */
const TAB =
  "relative flex items-center gap-[9px] rounded-t-2xl px-[18px] pb-1 text-[15px] font-semibold whitespace-nowrap " +
  "transition-colors duration-150 motion-reduce:transition-none " +
  "focus-visible:z-[3] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-primary " +
  "@max-xl:px-3";

const ACTIVE =
  "z-[2] -mb-px h-[52px] bg-[var(--pf-tab)] text-ink-primary shadow-[inset_0_1px_0_rgb(255_248_242/0.12)] " +
  "before:absolute before:bottom-0 before:-left-3.5 before:size-3.5 " +
  "before:bg-[radial-gradient(circle_at_0_0,transparent_13.5px,var(--pf-tab)_14px)] " +
  "after:absolute after:-right-3.5 after:bottom-0 after:size-3.5 " +
  "after:bg-[radial-gradient(circle_at_100%_0,transparent_13.5px,var(--pf-tab)_14px)]";

const INACTIVE =
  "z-0 h-12 min-w-11 translate-y-1 justify-center text-sheet-ink-secondary " +
  "bg-[color-mix(in_srgb,var(--pf-tab)_62%,var(--color-ground))] shadow-[inset_0_1px_0_rgb(255_248_242/0.09)] " +
  "hover:bg-[color-mix(in_srgb,var(--pf-tab)_80%,var(--color-ground))] hover:text-ink-primary";

/*
 * A narrow row has no room for numbers or labels on the tabs behind: each
 * becomes a 44px square showing its marker, with a dot in the corner when
 * something is waiting. The count is still spoken.
 */
const COMPACT_DOT =
  "size-[7px] rounded-full bg-primary @max-xl:absolute @max-xl:top-2 @max-xl:right-1.5";

interface SpaceTabProps extends SpaceTabItem {
  active: boolean;
  profile?: ProfileFace;
}

function SpaceTabMarker({ id, profile }: { id: SpaceId; profile?: ProfileFace }) {
  if (id !== "profile") return <PersonMarker kind={SPACE_MARKERS[id]} />;
  if (!profile) return null;
  return <Avatar id={profile.id} name={profile.name} src={profile.src} size="xs" decorative />;
}

/**
 * One index tab. Inactive tabs are the edges of the other sheets in the file,
 * each tinted with its own space's tone; the active tab is the top of the
 * sheet below it. When the row is narrow, inactive tabs keep only their
 * marker (the label stays for screen readers and in the tooltip).
 */
export function SpaceTab({ id, href, count, unread, active, profile }: SpaceTabProps) {
  const label = SPACE_LABELS[id];
  const hasCount = (count ?? 0) >= 1;
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      title={active ? undefined : label}
      data-space-tab={id}
      data-active={active || undefined}
      style={{ "--pf-tab": SHEET_VAR[id] } as CSSProperties}
      className={cx(TAB, active ? ACTIVE : INACTIVE)}
    >
      <SpaceTabMarker id={id} profile={profile} />
      <span data-space-label="" className={active ? undefined : "@max-xl:sr-only"}>
        {label}
      </span>
      {hasCount ? (
        <>
          <CountBadge count={count} className={active ? undefined : "@max-xl:hidden"} />
          {!active && <span aria-hidden="true" className={cx("hidden @max-xl:block", COMPACT_DOT)} />}
        </>
      ) : (
        unread && <CountBadge variant="dot" label="New activity" className={active ? undefined : COMPACT_DOT} />
      )}
    </a>
  );
}

export interface SpaceTabsProps {
  spaces: readonly SpaceTabItem[];
  active: SpaceId;
  /** The signed-in person, whose face marks the Profile tab. */
  profile?: ProfileFace;
  className?: string;
}

/**
 * The row of space tabs. Place it directly above the active space's Sheet,
 * with nothing between them. These are links between pages, so they are a
 * navigation list with `aria-current`, not an ARIA tablist.
 */
export default function SpaceTabs({ spaces, active, profile, className }: SpaceTabsProps) {
  return (
    <nav aria-label="Spaces" data-space-tabs="" className={cx("@container w-full", className)}>
      <ul className="flex items-end gap-1 ps-10 sm:ps-11">
        {orderSpaces(spaces).map((space) => (
          <li key={space.id} className="flex">
            <SpaceTab {...space} active={space.id === active} profile={profile} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
