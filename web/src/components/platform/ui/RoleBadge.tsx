import PersonMarker, { type MarkerKind } from "./PersonMarker";
import { CHIP_NEUTRAL_BG, CHIP_PEACH_BG, CHIP_RING_BG, cx } from "./tokens";

/**
 * Display badges, not permissions, matching `RoleBadgeKind` in the platform
 * contracts (B-0.1). The label comes with the data ("Cohort 04",
 * "Alumni · Cohort 02"); the kind only decides how it looks.
 */
export const ROLE_BADGE_KINDS = [
  "COHORT",
  "ALUMNI",
  "COMMUNITY",
  "MENTOR",
  "TA",
  "INSTRUCTOR",
  "INSTITUTION",
  "STAFF",
  "ADMIN",
  "AI",
] as const;
export type RoleBadgeKind = (typeof ROLE_BADGE_KINDS)[number];

/** Longer labels are cut with an ellipsis; the full text stays in the title. */
export const ROLE_BADGE_MAX_CHARS = 28;

const NEUTRAL = `${CHIP_NEUTRAL_BG} text-sheet-ink-secondary`;
const PEACH = `${CHIP_PEACH_BG} text-peach-ink`;
const RING = `${CHIP_RING_BG} text-ring`;

const LOOK: Record<RoleBadgeKind, { tone: string; marker?: MarkerKind }> = {
  COHORT: { tone: NEUTRAL },
  ALUMNI: { tone: NEUTRAL },
  COMMUNITY: { tone: NEUTRAL },
  MENTOR: { tone: RING, marker: "mentor" },
  TA: { tone: PEACH },
  INSTRUCTOR: { tone: PEACH },
  INSTITUTION: { tone: NEUTRAL, marker: "institution" },
  STAFF: { tone: NEUTRAL, marker: "staff" },
  ADMIN: { tone: NEUTRAL, marker: "staff" },
  AI: { tone: PEACH },
};

export function clipLabel(label: string, max = ROLE_BADGE_MAX_CHARS): string {
  const chars = Array.from(label.trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : chars.join("");
}

export interface RoleBadgeProps {
  kind: RoleBadgeKind;
  label: string;
  className?: string;
}

export default function RoleBadge({ kind, label, className }: RoleBadgeProps) {
  const { tone, marker } = LOOK[kind];
  const shown = clipLabel(label);
  return (
    <span
      data-role-badge={kind}
      title={shown === label.trim() ? undefined : label}
      className={cx(
        "inline-flex h-5 shrink-0 items-center gap-[5px] rounded-full px-2 text-[11.5px] leading-none font-bold whitespace-nowrap",
        tone,
        className
      )}
    >
      {marker && <PersonMarker kind={marker} className="scale-80" />}
      {shown}
    </span>
  );
}
