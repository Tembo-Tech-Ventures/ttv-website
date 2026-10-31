import { cx } from "./cx";
import PersonMarker from "./PersonMarker";
import { CHIP_TONES } from "./tones";

export type RoleKind = "cohort" | "alumni" | "mentor" | "ta" | "ai" | "staff";

type RoleBadgeProps = { className?: string } & (
  | { kind: "cohort"; cohort: number }
  | { kind: "alumni"; cohort?: number }
  | { kind: "mentor" | "ta" | "ai" | "staff"; cohort?: never }
);

/** Cohorts are written as two digits everywhere: "Cohort 04". */
export function cohortName(cohort: number): string {
  return `Cohort ${String(cohort).padStart(2, "0")}`;
}

/**
 * The role a person speaks with, next to their name. Mentors keep their ring
 * and Tembo its peach, so the two voices people most need to tell apart are
 * the two that look different.
 */
export default function RoleBadge(props: RoleBadgeProps) {
  const { kind, className } = props;
  const base = cx(
    "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[0.71875rem] leading-none font-bold whitespace-nowrap",
    className,
  );

  switch (kind) {
    case "cohort":
      return (
        <span data-role-badge={kind} className={cx(base, CHIP_TONES.neutral)}>
          {cohortName(props.cohort)}
        </span>
      );
    case "alumni":
      return (
        <span data-role-badge={kind} className={cx(base, CHIP_TONES.neutral)}>
          {props.cohort === undefined ? "Alumni" : `Alumni · ${cohortName(props.cohort)}`}
        </span>
      );
    case "mentor":
      return (
        <span data-role-badge={kind} className={cx(base, CHIP_TONES.ring)}>
          <PersonMarker kind="mentor" className="-ml-0.5 scale-90" />
          Mentor
        </span>
      );
    case "ta":
      return (
        <span data-role-badge={kind} className={cx(base, CHIP_TONES.neutral)}>
          <span aria-hidden="true">TA</span>
          <span className="sr-only">Teaching assistant</span>
        </span>
      );
    case "ai":
      return (
        <span data-role-badge={kind} className={cx(base, CHIP_TONES.peach)}>
          AI
        </span>
      );
    case "staff":
      return (
        <span data-role-badge={kind} className={cx(base, CHIP_TONES.neutral)}>
          Staff
        </span>
      );
  }
}
