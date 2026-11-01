/**
 * What /dashboard/apply says around its list of cohorts (QA1-04): after a
 * successful application it confirms it, and nothing on the page contradicts
 * that.
 */
export interface ApplyPageState {
  /** Show the "submitted" confirmation. */
  submitted: boolean;
  /** Show the "browse cohorts" subtitle: not when nothing is left to browse after submitting. */
  showSubtitle: boolean;
  /** Head the list "Other open cohorts", after submitting. */
  showOtherCohortsHeading: boolean;
  /** The empty-state message, or null when the empty state is not shown. */
  emptyMessage: string | null;
}

export const APPLY_EMPTY_MESSAGES = {
  noneOpen: "No cohorts are accepting applications right now.",
  allApplied: "You've applied to every cohort that's open right now.",
} as const;

export function applyPageState({
  notice,
  appliedCount,
  openCount,
  availableCount,
}: {
  /** The `notice` query parameter. */
  notice: string | null;
  /** How many cohorts this person has applied to. */
  appliedCount: number;
  /** How many cohorts are open. */
  openCount: number;
  /** How many open cohorts this person has not applied to. */
  availableCount: number;
}): ApplyPageState {
  // The notice is only believed once the person has an application to show.
  const submitted = notice === "application-submitted" && appliedCount > 0;
  const hasList = availableCount > 0;
  return {
    submitted,
    showSubtitle: hasList || !submitted,
    showOtherCohortsHeading: submitted && hasList,
    emptyMessage: hasList || submitted ? null : openCount > 0 ? APPLY_EMPTY_MESSAGES.allApplied : APPLY_EMPTY_MESSAGES.noneOpen,
  };
}
