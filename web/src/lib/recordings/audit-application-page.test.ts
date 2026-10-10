import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  new URL("../../pages/dashboard/application/[id].astro", import.meta.url),
  "utf8"
);

describe("application details page", () => {
  it("explains Audit access and its certificate boundary in one sentence", () => {
    expect(pageSource).toContain('application.status === "AUDIT"');
    expect(pageSource).toContain(
      "As an Audit participant, you can learn alongside the cohort through session recordings and Ask AI, but Audit does not include a completion certificate."
    );
  });
});
