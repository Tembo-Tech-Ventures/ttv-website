import { describe, expect, it } from "vitest";
import { STORE_UNAVAILABLE, cohortChangeNotice, cohortRoleLabel, needsCompletionConfirmation } from "./program-detail";

describe("a cohort's admin page", () => {
  it("says staff roles as words", () => {
    expect(cohortRoleLabel("TA")).toBe("Teaching assistant");
    expect(cohortRoleLabel("INSTRUCTOR")).toBe("Instructor");
    expect(cohortRoleLabel("MENTOR")).toBe("Mentor");
  });

  it("says each change in words, never a stored status", () => {
    const notices = [
      cohortChangeNotice({ kind: "details" }),
      cohortChangeNotice({ kind: "enrolled", status: "APPROVED" }),
      cohortChangeNotice({ kind: "enrolled", status: "COMPLETED" }),
      cohortChangeNotice({ kind: "bulk", action: "bulk-approve", count: 1 }),
      cohortChangeNotice({ kind: "bulk", action: "bulk-complete", count: 3 }),
    ];
    expect(notices).toEqual([
      "Cohort details saved.",
      "Enrolled as a current learner.",
      "Enrolled as a past learner. Their certificate and builder portfolio are open now.",
      "1 application accepted.",
      "3 applications completed. Their certificates and builder portfolios are open now.",
    ]);
    for (const notice of notices) expect(notice).not.toMatch(/\b[A-Z]{4,}\b/);
  });

  it("asks before completing anyone, and only then", () => {
    const form = (entries: Record<string, string>) => {
      const data = new FormData();
      for (const [name, value] of Object.entries(entries)) data.set(name, value);
      return data;
    };
    expect(needsCompletionConfirmation(form({}), "COMPLETED")).toBe(true);
    expect(needsCompletionConfirmation(form({ confirmed: "yes" }), "COMPLETED")).toBe(false);
    expect(needsCompletionConfirmation(form({}), "APPROVED")).toBe(false);
  });

  it("says a database failure plainly: nothing changed, and to try again", () => {
    expect(STORE_UNAVAILABLE).toMatch(/nothing changed/);
    expect(STORE_UNAVAILABLE).toMatch(/Try again/);
  });
});
