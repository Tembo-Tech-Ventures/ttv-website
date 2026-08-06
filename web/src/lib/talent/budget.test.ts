import { describe, expect, it } from "vitest";
import { budgetLabel } from "./budget";

describe("budgetLabel", () => {
  it("maps UNDER_1K to human label", () => {
    expect(budgetLabel("UNDER_1K")).toBe("Under $1k");
  });

  it("maps FROM_1K_TO_5K", () => {
    expect(budgetLabel("FROM_1K_TO_5K")).toBe("$1k–$5k");
  });

  it("maps FROM_5K_TO_15K", () => {
    expect(budgetLabel("FROM_5K_TO_15K")).toBe("$5k–$15k");
  });

  it("maps OVER_15K", () => {
    expect(budgetLabel("OVER_15K")).toBe("Over $15k");
  });

  it("maps UNDISCLOSED", () => {
    expect(budgetLabel("UNDISCLOSED")).toBe("Prefer not to say");
  });

  it("returns the raw value for unknown bands", () => {
    expect(budgetLabel("CUSTOM")).toBe("CUSTOM");
  });
});
