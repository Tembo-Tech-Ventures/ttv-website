const BUDGET_BAND_LABELS: Record<string, string> = {
  UNDER_1K: "Under $1k",
  FROM_1K_TO_5K: "$1k–$5k",
  FROM_5K_TO_15K: "$5k–$15k",
  OVER_15K: "Over $15k",
  UNDISCLOSED: "Prefer not to say",
};

export function budgetBandLabel(band: string): string {
  return BUDGET_BAND_LABELS[band] ?? band;
}

export const BUDGET_BAND_OPTIONS = [
  { value: "UNDER_1K", label: "Under $1k" },
  { value: "FROM_1K_TO_5K", label: "$1k–$5k" },
  { value: "FROM_5K_TO_15K", label: "$5k–$15k" },
  { value: "OVER_15K", label: "Over $15k" },
  { value: "UNDISCLOSED", label: "Prefer not to say" },
] as const;
