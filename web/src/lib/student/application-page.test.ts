import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const detailPage = read("../../pages/dashboard/application/[id].astro");
const answersView = read("../../components/platform/application/ApplicationAnswers.astro");
const applyPage = read("../../pages/dashboard/apply.astro");
/** What an .astro file renders: everything after its frontmatter. */
const template = (source: string) => source.split(/^---$/m).slice(2).join("---");

describe("member application page wiring (QA1-01, QA1-02)", () => {
  it("never offers the stored JSON to members", () => {
    for (const source of [detailPage, answersView]) {
      expect(template(source)).not.toMatch(/JSON/i);
      expect(source).not.toMatch(/JSON\.(stringify|parse)/);
      expect(source).not.toMatch(/name="application"/);
    }
  });

  it("posts only answers to the application's own questions, while it is pending", () => {
    expect(detailPage).toContain('answers.kind === "questions" && canEditAnswers(answers, application.status)');
    expect(detailPage).toContain("readAnswerSubmission(answers.questions");
    expect(detailPage).toContain("writeAnswers(application.application, submission.values)");
    expect(detailPage).toContain('and(ownApplication, eq(schema.programApplication.status, "PENDING"))');
  });

  it("returns a rejected form with what was typed and a status that says so", () => {
    expect(detailPage).toContain("drafts = submission.drafts;");
    expect(detailPage).toContain("fieldErrors = submission.errors;");
    expect(detailPage).toContain("Astro.response.status = 400;");
    expect(detailPage).toContain("Astro.response.status = 409;");
    expect(answersView).toContain('role="alert"');
    expect(answersView).toContain("aria-invalid");
  });

  it("keeps the ordinary no-script POST form", () => {
    expect(answersView).toContain('<form method="POST"');
    expect(answersView).not.toMatch(/client:(load|visible|idle)/);
  });
});

describe("post-submit apply page (QA1-04)", () => {
  it("confirms the application without the contradicting empty state", () => {
    expect(applyPage).toContain("Your cohort application was submitted.");
    expect(applyPage).toContain(") : !submitted && (");
    expect(applyPage).not.toContain("You may already have applied");
  });

  it("only believes the notice once the person has an application", () => {
    expect(applyPage).toContain('notice === "application-submitted" && appliedProgramIds.length > 0');
  });
});
