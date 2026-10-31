import { cx } from "./tokens";

/**
 * The network's markers, as on the homepage skills map: builders are peach
 * dots, mentors teal rings, institutions diamonds. "community" is a builder
 * and a mentor together, and "staff" a small peach shield, for space tabs.
 */
export type MarkerKind = "builder" | "mentor" | "institution" | "community" | "staff";

const SHAPES: Record<Exclude<MarkerKind, "community">, string> = {
  builder: "size-2.5 rounded-full bg-primary",
  mentor: "size-[11px] rounded-full border-2 border-ring",
  institution: "size-[9px] rotate-45 bg-ink-primary",
  staff: "size-2.5 rounded-[3px] border-2 border-primary",
};

export interface PersonMarkerProps {
  kind: MarkerKind;
  /**
   * Name the marker only when it stands alone. Beside a word such as
   * "Mentor" it is decoration and stays hidden.
   */
  label?: string;
  className?: string;
}

export default function PersonMarker({ kind, label, className }: PersonMarkerProps) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };

  if (kind === "community") {
    return (
      <span {...a11y} data-marker={kind} className={cx("relative inline-block h-3 w-[18px] shrink-0", className)}>
        <i className="absolute top-0.5 left-0 size-2 rounded-full bg-primary" />
        <i className="absolute top-0 left-1.5 size-[11px] rounded-full border-2 border-ring" />
      </span>
    );
  }

  return <span {...a11y} data-marker={kind} className={cx("inline-block shrink-0", SHAPES[kind], className)} />;
}
