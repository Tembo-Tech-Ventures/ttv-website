/**
 * The chip tones every small label on a sheet uses. Each pairs a tint with the
 * one ink that clears 4.5:1 on it over every sheet, card included
 * (contrast.test.ts models exactly these numbers). Neutral for facts, peach
 * for what needs someone, ring for a mentor's part only; the status tones for
 * an outcome (approved, needs checking, declined), always with its word.
 */
export type ChipTone = "neutral" | "peach" | "ring" | "success" | "warning" | "danger";

export const CHIP_TONES: Record<ChipTone, string> = {
  neutral: "bg-ink-primary/6 text-ink-secondary",
  peach: "bg-primary/10 text-peach-ink",
  ring: "bg-ring/8 text-ring",
  success: "bg-success-ink/10 text-success-ink",
  warning: "bg-warning-ink/10 text-warning-ink",
  danger: "bg-danger-ink/10 text-danger-ink",
};

/** A card's lift off its sheet: the sheet's own light, slightly brighter. */
export const RAISED = "bg-ink-primary/4";
