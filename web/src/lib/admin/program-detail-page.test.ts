import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  new URL("../../pages/admin/programs/[id].astro", import.meta.url),
  "utf8"
);

describe("admin cohort detail page wiring", () => {
  it("uses the typed raw-value parser and guarded atomic update", () => {
    expect(pageSource).toContain(
      "submittedCohortValues = cohortUpdateValuesFromFormData(formData)"
    );
    expect(pageSource).toContain("parseCohortUpdate({");
    expect(pageSource).toContain("buildCohortUpdateStatement({");
    expect(pageSource).toContain("throwCohortUpdateFailure({");
    expect(pageSource).toContain("Astro.response.status = 400");
  });

  it("renders existing curriculum selection and the explicit open toggle", () => {
    expect(pageSource).toContain('name="curriculumId"');
    expect(pageSource).toContain(
      "selected={curriculum.id === cohortEditValues.curriculumId}"
    );
    expect(pageSource).toContain('name="applicationsOpen"');
    expect(pageSource).toContain(
      "checked={cohortEditValues.applicationsOpen}"
    );
  });

  it("renders field-level errors while preserving submitted values", () => {
    expect(pageSource).toContain("submittedCohortValues ??");
    expect(pageSource).toContain("cohortUpdateErrorField(error)");
    expect(pageSource).toContain('id="name-error"');
    expect(pageSource).toContain('id="description-error"');
    expect(pageSource).toContain('id="curriculum-error"');
    expect(pageSource).toContain('id="start-date-error"');
    expect(pageSource).toContain('id="end-date-error"');
    expect(pageSource).toContain('id="applicationsOpen"');
    expect(pageSource).toContain(
      'aria-describedby={cohortFieldErrors.applicationsOpen ? "applications-open-error" : undefined}'
    );
    expect(pageSource).toContain('id="applications-open-error"');
  });
});
