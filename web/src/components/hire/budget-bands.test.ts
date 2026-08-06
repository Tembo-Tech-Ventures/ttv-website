import { describe, it, expect } from "vitest";
import { budgetBandLabel, BUDGET_BAND_OPTIONS } from "./budget-bands";

describe("budgetBandLabel", () => {
  it("maps UNDER_1K", () => {
    expect(budgetBandLabel("UNDER_1K")).toBe("Under $1k");
  });

  it("maps FROM_1K_TO_5K", () => {
    expect(budgetBandLabel("FROM_1K_TO_5K")).toBe("$1k–$5k");
  });

  it("maps FROM_5K_TO_15K", () => {
    expect(budgetBandLabel("FROM_5K_TO_15K")).toBe("$5k–$15k");
  });

  it("maps OVER_15K", () => {
    expect(budgetBandLabel("OVER_15K")).toBe("Over $15k");
  });

  it("maps UNDISCLOSED", () => {
    expect(budgetBandLabel("UNDISCLOSED")).toBe("Prefer not to say");
  });

  it("returns unknown values as-is", () => {
    expect(budgetBandLabel("CUSTOM")).toBe("CUSTOM");
  });
});

describe("BUDGET_BAND_OPTIONS", () => {
  it("has exactly 5 options", () => {
    expect(BUDGET_BAND_OPTIONS).toHaveLength(5);
  });

  it("each option has value and label", () => {
    for (const opt of BUDGET_BAND_OPTIONS) {
      expect(opt.value).toBeTruthy();
      expect(opt.label).toBeTruthy();
    }
  });

  it("values match budgetBandLabel keys", () => {
    for (const opt of BUDGET_BAND_OPTIONS) {
      expect(budgetBandLabel(opt.value)).toBe(opt.label);
    }
  });
});
