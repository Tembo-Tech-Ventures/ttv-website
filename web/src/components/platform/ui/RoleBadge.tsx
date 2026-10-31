import type { RoleBadge as RoleBadgeData, RoleBadgeKind } from "@/lib/platform/contracts";
import { cx } from "./cx";
import PersonMarker, { type PersonKind } from "./PersonMarker";
import { CHIP_TONES, type ChipTone } from "./tones";

type RoleBadgeProps = {
  /** A badge as the server sends it. The server owns the wording ("Cohort 04"). */
  badge: Pick<RoleBadgeData, "kind" | "label">;
  className?: string;
};

/*
 * Mentors keep their ring and Tembo its peach, so the two voices people most
 * need to tell apart are the two that look different. Institutions carry their
 * diamond. Every other role is a quiet label.
 */
const TONES: Record<RoleBadgeKind, ChipTone> = {
  COHORT: "neutral",
  ALUMNI: "neutral",
  COMMUNITY: "neutral",
  MENTOR: "ring",
  TA: "neutral",
  INSTRUCTOR: "neutral",
  INSTITUTION: "neutral",
  STAFF: "neutral",
  ADMIN: "neutral",
  AI: "peach",
};

const MARKERS: Partial<Record<RoleBadgeKind, PersonKind>> = {
  MENTOR: "mentor",
  INSTITUTION: "institution",
};

/** Abbreviated labels, said in full to screen readers. */
const SPOKEN: Record<string, string> = {
  TA: "Teaching assistant",
};

/** The role a person speaks with, next to their name. */
export default function RoleBadge({ badge, className }: RoleBadgeProps) {
  const marker = MARKERS[badge.kind];
  const spoken = SPOKEN[badge.label];

  return (
    <span
      data-role-badge={badge.kind}
      className={cx(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[0.71875rem] leading-none font-bold whitespace-nowrap",
        CHIP_TONES[TONES[badge.kind]],
        className,
      )}
    >
      {marker && <PersonMarker kind={marker} className="-ml-0.5 scale-90" />}
      {spoken ? (
        <>
          <span aria-hidden="true">{badge.label}</span>
          <span className="sr-only">{spoken}</span>
        </>
      ) : (
        badge.label
      )}
    </span>
  );
}
