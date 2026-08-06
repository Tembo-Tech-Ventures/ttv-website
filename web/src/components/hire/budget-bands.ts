import { budgetLabel } from "@/lib/talent/budget";

export const BUDGET_BAND_VALUES = [
  "UNDER_1K",
  "FROM_1K_TO_5K",
  "FROM_5K_TO_15K",
  "OVER_15K",
  "UNDISCLOSED",
] as const;

export type BudgetBand = (typeof BUDGET_BAND_VALUES)[number];

// Labels have a single source of truth in lib/talent/budget.ts (shared with
// the admin review surfaces); this module adds the select-options shape the
// hire form and opportunities board render.
export const budgetBandLabel = budgetLabel;

export const BUDGET_BAND_OPTIONS = BUDGET_BAND_VALUES.map((value) => ({
  value,
  label: budgetLabel(value),
}));
