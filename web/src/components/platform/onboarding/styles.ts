import { buttonClass, type ButtonVariant } from "@/components/platform/ui/recipes";

/**
 * The onboarding cards' actions: the kit's buttons at their full 44px size
 * (`lg`), because these sit at the top of a page people arrive on with a
 * thumb. Links and form buttons share them, so "Open Mentoring" and "Dismiss"
 * look like the pair they are.
 */
export function action(variant: ButtonVariant): string {
  return buttonClass({ variant, size: "lg" });
}

/** A card's seal: the person marker, enlarged, in a dark well. */
export const SEAL = "grid size-11 shrink-0 place-items-center rounded-full border border-hairline bg-dark/60 sm:size-[3.25rem]";
