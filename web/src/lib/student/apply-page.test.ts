import { describe, expect, it } from "vitest";
import { APPLY_EMPTY_MESSAGES, applyPageState } from "./apply-page";

describe("applyPageState (QA1-04)", () => {
  it("confirms a submission with nothing contradicting it when no other cohort is open", () => {
    expect(applyPageState({ submittedNow: true, appliedCount: 1, openCount: 1, availableCount: 0 })).toEqual({
      submitted: true,
      showSubtitle: false,
      showOtherCohortsHeading: false,
      emptyMessage: null,
    });
  });

  it("offers the other open cohorts, under their own heading, after a submission", () => {
    expect(applyPageState({ submittedNow: true, appliedCount: 1, openCount: 2, availableCount: 1 })).toEqual({
      submitted: true,
      showSubtitle: true,
      showOtherCohortsHeading: true,
      emptyMessage: null,
    });
  });

  it("does not believe the confirmation without an application to show", () => {
    expect(applyPageState({ submittedNow: true, appliedCount: 0, openCount: 0, availableCount: 0 })).toMatchObject({
      submitted: false,
      emptyMessage: APPLY_EMPTY_MESSAGES.noneOpen,
    });
  });

  it("says exactly which empty case applies", () => {
    expect(applyPageState({ submittedNow: false, appliedCount: 0, openCount: 0, availableCount: 0 }).emptyMessage).toBe(
      "No cohorts are accepting applications right now.",
    );
    expect(applyPageState({ submittedNow: false, appliedCount: 2, openCount: 2, availableCount: 0 }).emptyMessage).toBe(
      "You've applied to every cohort that's open right now.",
    );
    expect(applyPageState({ submittedNow: false, appliedCount: 1, openCount: 0, availableCount: 0 }).emptyMessage).toBe(
      "No cohorts are accepting applications right now.",
    );
  });

  it("shows the list with its subtitle and no empty state while cohorts are open", () => {
    expect(applyPageState({ submittedNow: false, appliedCount: 0, openCount: 1, availableCount: 1 })).toEqual({
      submitted: false,
      showSubtitle: true,
      showOtherCohortsHeading: false,
      emptyMessage: null,
    });
  });
});
