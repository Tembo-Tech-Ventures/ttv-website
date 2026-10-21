import { describe, expect, it } from "vitest";
import {
  assessTheme,
  normalizeThemeSummary,
  normalizeThemeTitle,
  parseThemeStatusFilter,
  studentFeedbackState,
  type ThemeSignals,
} from "./themes";

const NOW = new Date("2026-10-21T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1_000);

function signals(overrides: Partial<ThemeSignals> = {}): ThemeSignals {
  return {
    kind: "IDEA",
    status: "COLLECTING",
    change: null,
    recentStudents: 1,
    lastReportAt: daysAgo(1),
    ...overrides,
  };
}

describe("studentFeedbackState", () => {
  it("follows the theme once a note is on one", () => {
    expect(studentFeedbackState("NEW", null)).toBe("RECEIVED");
    expect(studentFeedbackState("NEW", "COLLECTING")).toBe("RECEIVED");
    expect(studentFeedbackState("NEW", "PROPOSED")).toBe("RECEIVED");
    expect(studentFeedbackState("NEW", "DORMANT")).toBe("RECEIVED");
    expect(studentFeedbackState("NEW", "PLANNED")).toBe("PLANNED");
    expect(studentFeedbackState("IN_PROGRESS", "IN_PROGRESS")).toBe("IN_PROGRESS");
    expect(studentFeedbackState("NEW", "SHIPPED")).toBe("DONE");
    expect(studentFeedbackState("NEW", "DECLINED")).toBe("NOT_PLANNED");
  });

  it("keeps an answer someone gave by hand, whatever the theme does", () => {
    expect(studentFeedbackState("RESOLVED", "COLLECTING")).toBe("DONE");
    expect(studentFeedbackState("DECLINED", "IN_PROGRESS")).toBe("NOT_PLANNED");
  });

  it("does not promise work on an unthemed note that is merely being looked at", () => {
    expect(studentFeedbackState("IN_PROGRESS", null)).toBe("IN_PROGRESS");
  });
});

describe("assessTheme", () => {
  it("puts an idea forward at three students within the window", () => {
    expect(assessTheme(signals({ recentStudents: 2 }), NOW)).toMatchObject({
      readyToPropose: false,
      reason: "Needs 1 more student within 60 days.",
    });
    expect(assessTheme(signals({ recentStudents: 3 }), NOW)).toMatchObject({
      readyToPropose: true,
      reason: "3 students raised this in the last 60 days.",
    });
  });

  it("needs only one report for a bug, with no approval", () => {
    expect(assessTheme(signals({ kind: "BUG", recentStudents: 1 }), NOW)).toEqual({
      readyToPropose: true,
      goingDormant: false,
      approval: "none",
      reason: "A reproducible bug needs only one report.",
    });
  });

  it("never turns praise into work", () => {
    expect(assessTheme(signals({ kind: "PRAISE", recentStudents: 10 }), NOW)).toMatchObject({
      readyToPropose: false,
      reason: expect.stringMatching(/protect what works/),
    });
  });

  it("asks the owner for additions, defaults simplifications, and lets fixes through", () => {
    expect(assessTheme(signals({ change: "ADD" }), NOW).approval).toBe("owner");
    expect(assessTheme(signals({ change: null }), NOW).approval).toBe("owner");
    expect(assessTheme(signals({ change: "SIMPLIFY" }), NOW).approval).toBe("default");
    expect(assessTheme(signals({ change: "FIX" }), NOW).approval).toBe("none");
  });

  it("marks a quiet collecting theme dormant after 90 days", () => {
    expect(assessTheme(signals({ lastReportAt: daysAgo(89) }), NOW).goingDormant).toBe(false);
    expect(assessTheme(signals({ lastReportAt: daysAgo(90), recentStudents: 0 }), NOW)).toMatchObject({
      goingDormant: true,
      readyToPropose: false,
      reason: "Needs 3 more students within 60 days.",
    });
    expect(assessTheme(signals({ lastReportAt: null, recentStudents: 0 }), NOW).goingDormant).toBe(true);
  });

  it("lets a dormant theme wake up when enough students return", () => {
    expect(assessTheme(signals({ status: "DORMANT", recentStudents: 3 }), NOW).readyToPropose).toBe(true);
  });

  it("leaves themes that already moved alone", () => {
    expect(assessTheme(signals({ status: "PLANNED", recentStudents: 9 }), NOW)).toMatchObject({
      readyToPropose: false,
      goingDormant: false,
      reason: "Already planned.",
    });
  });
});

describe("theme input", () => {
  it("parses status filters", () => {
    expect(parseThemeStatusFilter(null)).toEqual(["COLLECTING", "PROPOSED", "PLANNED", "IN_PROGRESS"]);
    expect(parseThemeStatusFilter("all")).toHaveLength(7);
    expect(parseThemeStatusFilter("shipped,declined")).toEqual(["SHIPPED", "DECLINED"]);
    expect(() => parseThemeStatusFilter("done")).toThrow(/Unknown theme status filter/);
  });

  it("bounds titles and summaries", () => {
    expect(normalizeThemeTitle("  Apply   button\nunclear ")).toBe("Apply button unclear");
    expect(() => normalizeThemeTitle("")).toThrow(/between 1 and 120/);
    expect(() => normalizeThemeTitle("x".repeat(121))).toThrow(/between 1 and 120/);
    expect(normalizeThemeSummary(undefined)).toBe("");
    expect(() => normalizeThemeSummary(5)).toThrow("The summary must be text.");
    expect(() => normalizeThemeSummary("x".repeat(4_001))).toThrow(/4,000/);
  });
});
