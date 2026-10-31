/**
 * Shared vocabulary for the platform primitives: the spaces and their sheet
 * tones, the translucent surface tints, and the avatar palette.
 *
 * Tailwind only generates classes it can find written out in full, so every
 * class here is a complete literal rather than one assembled from parts. The
 * contrast test reads the tint percentages back out of these same strings, so
 * the numbers that are checked are the numbers that ship.
 */

/**
 * The fixed space order, matching `SPACE_ORDER` in the platform contracts
 * (B-0.1). Declared here until those contracts land on main; the type is
 * structurally identical, so consumers can pass either.
 */
export const SPACE_ORDER = ["cohort", "community", "mentoring", "discover", "admin", "profile"] as const;
export type SpaceId = (typeof SPACE_ORDER)[number];

/** Background class for each space's sheet. */
export const SHEET_BG: Record<SpaceId, string> = {
  admin: "bg-sheet-admin",
  cohort: "bg-sheet-cohort",
  community: "bg-sheet-community",
  discover: "bg-sheet-discover",
  mentoring: "bg-sheet-mentoring",
  profile: "bg-sheet-profile",
};

/**
 * The CSS custom property holding each tone, for geometry that needs the
 * colour itself (the tab fillets) rather than a background class.
 */
export const SHEET_VAR: Record<SpaceId, string> = {
  admin: "var(--color-sheet-admin)",
  cohort: "var(--color-sheet-cohort)",
  community: "var(--color-sheet-community)",
  discover: "var(--color-sheet-discover)",
  mentoring: "var(--color-sheet-mentoring)",
  profile: "var(--color-sheet-profile)",
};

/*
 * Translucent layers laid over a sheet. Each is a percentage of an ink or
 * brand colour; `platform-contrast.test.ts` composites them over every tone.
 */
export const RAISED_BG = "bg-ink-primary/4";
export const RAISED_HOVER_BG = "hover:bg-ink-primary/7";
export const CHIP_NEUTRAL_BG = "bg-ink-primary/6";
export const CHIP_PEACH_BG = "bg-primary/8";
export const CHIP_RING_BG = "bg-ring/8";
export const DANGER_BG = "bg-danger-ink/7";
export const DANGER_HOVER_BG = "enabled:hover:bg-danger-ink/10";

/** One focus treatment everywhere: a peach ring clear of the element. */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * Avatar fills. Initials are always dark teal, which clears 5:1 on each.
 * The order is part of the contract: appending is safe, reordering would
 * re-colour everyone.
 */
export const AVATAR_FILLS = [
  "bg-avatar-peach",
  "bg-avatar-mint",
  "bg-avatar-apricot",
  "bg-avatar-frost",
  "bg-avatar-shell",
  "bg-avatar-sage",
] as const;

/** Joins class names, skipping empty and false-y parts. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
