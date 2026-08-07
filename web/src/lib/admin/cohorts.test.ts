import { describe, expect, it } from "vitest";
import {
  createCohortValuesFromFormData,
  validateCreateCohort,
  type CreateCohortValues,
} from "./cohorts";

const validValues: CreateCohortValues = {
  name: "Cohort 05",
  description: "Advanced web development",
  curriculumId: "curriculum-1",
  startDate: "2026-09-01",
  endDate: "2026-12-15",
  applicationsOpen: false,
};

describe("createCohortValuesFromFormData", () => {
  it("preserves submitted text and reads only an explicit checked value", () => {
    const formData = new FormData();
    formData.set("name", "  Cohort 05  ");
    formData.set("description", "  Advanced web development  ");
    formData.set("curriculumId", " curriculum-1 ");
    formData.set("startDate", "2026-09-01");
    formData.set("endDate", "2026-12-15");
    formData.set("applicationsOpen", "true");

    expect(createCohortValuesFromFormData(formData)).toEqual({
      name: "  Cohort 05  ",
      description: "  Advanced web development  ",
      curriculumId: " curriculum-1 ",
      startDate: "2026-09-01",
      endDate: "2026-12-15",
      applicationsOpen: true,
    });
  });

  it("defaults unchecked applications and non-text values safely", () => {
    const formData = new FormData();
    formData.set("description", new File(["content"], "description.txt"));

    expect(createCohortValuesFromFormData(formData)).toEqual({
      name: "",
      description: "",
      curriculumId: "",
      startDate: "",
      endDate: "",
      applicationsOpen: false,
    });
  });
});

describe("validateCreateCohort", () => {
  it("normalizes successful values and preserves the applications setting", () => {
    const values = {
      ...validValues,
      name: "  Cohort 05  ",
      description: "  Advanced web development  ",
      curriculumId: " curriculum-1 ",
      startDate: " 2026-09-01 ",
      applicationsOpen: true,
    };

    expect(validateCreateCohort(values, ["curriculum-1"])).toEqual({
      valid: true,
      values,
      errors: {},
      data: {
        name: "Cohort 05",
        description: "Advanced web development",
        curriculumId: "curriculum-1",
        startDate: new Date("2026-09-01T00:00:00.000Z"),
        endDate: new Date("2026-12-15T00:00:00.000Z"),
        applicationsOpen: true,
      },
    });
  });

  it("accepts optional blank dates and remains closed by default", () => {
    const values = {
      ...validValues,
      startDate: " ",
      endDate: "",
    };

    expect(validateCreateCohort(values, ["curriculum-1"])).toMatchObject({
      valid: true,
      data: {
        startDate: null,
        endDate: null,
        applicationsOpen: false,
      },
    });
  });

  it("rejects whitespace-only required fields and preserves inline values", () => {
    const values = {
      ...validValues,
      name: "   ",
      description: "\t",
    };

    expect(validateCreateCohort(values, ["curriculum-1"])).toEqual({
      valid: false,
      values,
      errors: {
        name: "Enter a cohort name.",
        description: "Enter a cohort description.",
      },
    });
  });

  it("rejects a forged or stale curriculum selection", () => {
    const values = { ...validValues, curriculumId: "deleted-curriculum" };

    expect(validateCreateCohort(values, ["curriculum-1"])).toEqual({
      valid: false,
      values,
      errors: { curriculumId: "Select an available curriculum." },
    });
  });

  it.each([
    ["2026-02-30", "2026-12-15", "startDate"],
    ["09/01/2026", "2026-12-15", "startDate"],
    ["2026-09-01", "2026-13-01", "endDate"],
    ["0000-01-01", "2026-12-15", "startDate"],
  ] as const)(
    "rejects non-real or non-strict dates (%s, %s)",
    (startDate, endDate, field) => {
      const values = { ...validValues, startDate, endDate };
      expect(validateCreateCohort(values, ["curriculum-1"])).toEqual({
        valid: false,
        values,
        errors: { [field]: "Enter a real date in YYYY-MM-DD format." },
      });
    }
  );

  it("rejects a start date after the end date", () => {
    const values = {
      ...validValues,
      startDate: "2026-12-16",
      endDate: "2026-12-15",
    };

    expect(validateCreateCohort(values, ["curriculum-1"])).toEqual({
      valid: false,
      values,
      errors: { endDate: "End date must be on or after start date." },
    });
  });
});
