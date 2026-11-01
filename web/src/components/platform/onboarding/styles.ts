import { BUTTON_VARIANTS, FOCUS_RING, type ButtonVariant } from "@/components/platform/ui/Button";

/**
 * The onboarding cards' actions: the kit's button variants at a full 44px
 * touch target, because these sit at the top of a page people arrive on with
 * a thumb. Links and form buttons share them, so "Open Mentoring" and
 * "Dismiss" look like the pair they are.
 */
export function action(variant: ButtonVariant): string[] {
  return [
    "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold whitespace-nowrap",
    "transition-colors duration-150 motion-reduce:transition-none",
    BUTTON_VARIANTS[variant],
    FOCUS_RING,
  ];
}

/** A card's seal: the person marker, enlarged, in a dark well. */
export const SEAL = "grid size-11 shrink-0 place-items-center rounded-full border border-hairline bg-dark/60 sm:size-[3.25rem]";
