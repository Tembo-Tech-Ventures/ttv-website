import type { HomepageBuilder } from "@/lib/homepage/builders";

/** "Cohort 3" or "Cohort 03" → "03", matching `COHORT.timeline` numbers. */
export function cohortNumberOf(builder: HomepageBuilder): string | null {
  return builder.cohort?.match(/\d+/)?.[0]?.padStart(2, "0") ?? null;
}
