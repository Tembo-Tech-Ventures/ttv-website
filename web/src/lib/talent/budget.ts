const BUDGET_LABELS: Record<string, string> = {
  UNDER_1K: "Under $1k",
  FROM_1K_TO_5K: "$1k–$5k",
  FROM_5K_TO_15K: "$5k–$15k",
  OVER_15K: "Over $15k",
  UNDISCLOSED: "Prefer not to say",
};

export function budgetLabel(band: string): string {
  return BUDGET_LABELS[band] ?? band;
}
