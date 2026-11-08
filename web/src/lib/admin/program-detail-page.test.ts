import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("../../pages/admin/programs/[id].astro", import.meta.url), "utf8");
const mentorsSource = readFileSync(new URL("../../components/admin/CohortMentors.astro", import.meta.url), "utf8");

describe("admin cohort detail page wiring", () => {
  it("uses the typed raw-value parser and guarded atomic update", () => {
    expect(pageSource).toContain("submittedCohortValues = cohortUpdateValuesFromFormData(formData)");
    expect(pageSource).toContain("parseCohortUpdate({");
    expect(pageSource).toContain("buildCohortUpdateStatement({");
    expect(pageSource).toContain("throwCohortUpdateFailure({");
    expect(pageSource).toContain("Astro.response.status = 400");
  });

  it("answers a database failure with 503 and the form as it was sent, not an error page", () => {
    expect(pageSource).toContain("Astro.response.status = 503");
    expect(pageSource).not.toMatch(/throw error;/);
    // Every form's catch tells a refused request (400) from a store failure (503).
    expect(pageSource.match(/\bunavailable\(/g)?.length).toBe(5);
  });

  it("renders existing curriculum selection and the explicit open toggle, from the kit's fields", () => {
    expect(pageSource).toContain('name="curriculumId"');
    expect(pageSource).toContain("defaultValue={cohortEditValues.curriculumId}");
    expect(pageSource).toContain('name="applicationsOpen"');
    expect(pageSource).toContain("defaultChecked={cohortEditValues.applicationsOpen}");
  });

  it("renders field-level errors while preserving submitted values", () => {
    expect(pageSource).toContain("submittedCohortValues ??");
    expect(pageSource).toContain("cohortUpdateErrorField(error)");
    for (const field of ["name", "description", "startDate", "endDate", "curriculumId", "applicationsOpen"]) {
      expect.soft(pageSource, field).toContain(`error={cohortFieldErrors.${field}}`);
    }
  });

  it("answers every change with a 303 and a read-once notice, never a query-string one", () => {
    expect(pageSource).not.toMatch(/Astro\.redirect\(`\$\{page\}/);
    expect(pageSource).not.toContain("?notice=cohort-updated");
    expect(pageSource.match(/redirectWithFlash\(Astro,/g)?.length).toBeGreaterThanOrEqual(6);
    expect(pageSource).toContain("takeFlash(Astro)");
  });

  it("asks before removing someone or completing anyone, on the page and without script", () => {
    for (const source of [pageSource, mentorsSource]) {
      expect(source).not.toContain("confirm(");
      expect(source).toContain("<ConfirmStep");
    }
    expect(pageSource).toContain("needsCompletionConfirmation(formData, enrollment.status)");
    expect(pageSource).toContain("needsCompletionConfirmation(formData, plan.status)");
  });

  it("offers one primary action, Save changes, and keeps the rest quiet", () => {
    expect(pageSource.match(/variant="primary"/g)).toHaveLength(1);
    expect(pageSource).toMatch(/<Button variant="primary" type="submit">Save changes<\/Button>/);
    expect(mentorsSource).not.toContain('variant="primary"');
  });

  it("posts every form to the page itself, never to a #fragment, so a focused notice takes focus", () => {
    // A browser skips autofocus when the address targets an element; the confirm step and a rejected
    // form's notice would render unfocused.
    expect(pageSource).not.toMatch(/method="POST"[^>]*action=\{`[^`]*#/);
    expect(pageSource).not.toMatch(/action=\{`\$\{page\}#/);
  });
});
