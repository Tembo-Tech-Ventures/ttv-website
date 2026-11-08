import { people } from "@/lib/platform/fixtures";

/**
 * The fictional people the style guide's examples show: the platform's shared
 * synthetic fixtures, so the guide and the app's own harnesses agree on who
 * Wanjiku, David, Joseph and Lucy are. No real person appears in the guide.
 */
export const GUIDE_PEOPLE = {
  wanjiku: people.wanjiku,
  david: people.david,
  joseph: people.joseph,
  lucy: people.lucy,
} as const;

export { SAMPLE_PHOTO as PHOTO } from "@/components/platform/ui/harness/people";
