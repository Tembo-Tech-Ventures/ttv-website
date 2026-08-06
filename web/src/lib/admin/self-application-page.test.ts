import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  new URL("../../pages/dashboard/apply.astro", import.meta.url),
  "utf8"
);

describe("dashboard cohort application page wiring", () => {
  it("executes the guarded duplicate-safe self-application statement", () => {
    expect(pageSource).toContain("createSelfApplication({");
    expect(pageSource).toContain("buildSelfApplicationStatement(application)");
    expect(pageSource).toContain("result.meta.changes");
    expect(pageSource).toContain("throwSelfApplicationFailure({");
  });

  it("queries only open cohorts for the application list", () => {
    expect(pageSource).toContain(
      "where: eq(schema.program.applicationsOpen, true)"
    );
    expect(pageSource).toContain("data-cohort-id={program.id}");
  });

  it("returns safe client and server failures without leaking database errors", () => {
    expect(pageSource).toContain("caught instanceof ProgramApplicationError");
    expect(pageSource).toContain("Astro.response.status = 400");
    expect(pageSource).toContain("Astro.response.status = 500");
    expect(pageSource).toContain(
      'error = "The application could not be submitted. Please try again."'
    );
    expect(pageSource).toContain('role="alert"');
  });

  it("redirects successful posts to prevent duplicate browser resubmission", () => {
    expect(pageSource).toContain(
      'Astro.redirect("/dashboard/apply?notice=application-submitted")'
    );
  });
});
