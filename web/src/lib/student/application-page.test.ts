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

  // What a POST may write is tested against real SQL in save-application-answers.test.ts;
  // here only that the page hands it the signed-in member and the right cohort scope.
  it("saves through saveApplicationAnswers as the signed-in member", () => {
    expect(detailPage).toContain("saveApplicationAnswers({");
    expect(detailPage).toContain("userId: user.id,");
    expect(detailPage).toContain('programId: isDemoUser(user.id) ? DEMO_PREFIX + "program" : undefined,');
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
