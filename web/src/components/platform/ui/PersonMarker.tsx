import { cx } from "./cx";
import TemboMark from "./TemboMark";

export type PersonKind = "builder" | "mentor" | "institution" | "tembo";

type PersonMarkerProps = {
  kind: PersonKind;
  /**
   * Say what the marker means when nothing beside it does. Without a label
   * the marker is decoration and hidden from assistive tech.
   */
  label?: string;
  className?: string;
};

/*
 * The network language the homepage established: builders are peach dots,
 * mentors teal rings, institutions ink diamonds. Every person shape sits in the
 * same 12px box, so markers line up in a column whichever kind they are.
 */
const SHAPES: Record<Exclude<PersonKind, "tembo">, string> = {
  builder: "size-2.5 rounded-full bg-primary",
  mentor: "size-[0.6875rem] rounded-full border-2 border-ring",
  institution: "size-2 rotate-45 bg-ink-primary",
};

export default function PersonMarker({ kind, label, className }: PersonMarkerProps) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };

  return (
    <span
      {...a11y}
      data-person-marker={kind}
      className={cx("inline-grid shrink-0 place-items-center", kind === "tembo" ? "size-4" : "size-3", className)}
    >
      {kind === "tembo" ? (
        <TemboMark size="marker" decorative />
      ) : (
        <span className={SHAPES[kind]} />
      )}
    </span>
  );
}
