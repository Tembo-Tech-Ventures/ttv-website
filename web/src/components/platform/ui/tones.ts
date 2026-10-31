/**
 * The three chip tones every small label on a sheet uses. Each pairs a tint
 * with the one ink that clears 4.5:1 on it over every sheet, card included
 * (contrast.test.ts models exactly these numbers).
 */
export type ChipTone = "neutral" | "peach" | "ring";

export const CHIP_TONES: Record<ChipTone, string> = {
  neutral: "bg-ink-primary/6 text-ink-secondary",
  peach: "bg-primary/10 text-peach-ink",
  ring: "bg-ring/8 text-ring",
};

/** A card's lift off its sheet: the sheet's own light, slightly brighter. */
export const RAISED = "bg-ink-primary/4";
