import { describe, expect, it } from "vitest";

import { getDashboardGreetingName, getFirstName } from "./display-name";

describe("getFirstName", () => {
  it("returns the first name from a full name", () => {
    expect(getFirstName("Harrison John-Anozie")).toBe("Harrison");
  });

  it("keeps a single-name display name unchanged", () => {
    expect(getFirstName("Amina")).toBe("Amina");
  });

  it("trims repeated whitespace before extracting the first name", () => {
    expect(getFirstName("  Harrison   John-Anozie  ")).toBe("Harrison");
  });

  it("returns null for missing or blank names", () => {
    expect(getFirstName(null)).toBeNull();
    expect(getFirstName(undefined)).toBeNull();
    expect(getFirstName("   ")).toBeNull();
  });
});

describe("getDashboardGreetingName", () => {
  it("falls back when no usable display name is available", () => {
    expect(getDashboardGreetingName("")).toBe("there");
  });
});
