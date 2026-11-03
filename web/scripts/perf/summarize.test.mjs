import { describe, expect, it } from "vitest";
import { quantile, summarize } from "./summarize.mjs";

const row = (step, clickToVisibleMs, d1, waves, depth, headersMs) => ({
  profile: "fast", journey: "student", step, clickToVisibleMs, doc: { ttfb: clickToVisibleMs - 100 }, server: { d1, waves, depth, headersMs },
});

describe("summarize", () => {
  it("takes nearest-rank medians and p75s, ignoring missing values", () => {
    expect(quantile([3, 1, 2], 0.5)).toBe(2);
    expect(quantile([3, 1, 2], 0.75)).toBe(3);
    expect(quantile([4, 1, 3, 2], 0.5)).toBe(2);
    expect(quantile([undefined, null], 0.5)).toBeNull();
  });

  it("prints one row per step, and baseline → this run when given a baseline", () => {
    const before = [row("cohort tab", 900, 25, 13, 13, 800), row("cohort tab", 1000, 25, 13, 13, 820), row("cohort tab", 1100, 25, 12, 13, 900)];
    const after = [row("cohort tab", 600, 14, 5, 5, 400), row("cohort tab", 700, 14, 5, 5, 420), row("cohort tab", 650, 14, 5, 5, 410)];
    expect(summarize(after)).toContain("| cohort tab | 3 | 650 (700) | 550 (600) | 410 (420) | 14 (14) | 5 (5) | 5 (5) |");
    expect(summarize(after, before)).toContain("| cohort tab | 3 | 1000 (1100) → 650 (700) |");
    expect(summarize(after, [])).toContain("| cohort tab | 3 | – → 650 (700) |");
  });

  it("lists a step that could not run as skipped, with why, instead of dropping it", () => {
    const skipped = { profile: "fast", journey: "student", step: "thread", skipped: "Error: No link for a[href^=\"?thread=\"]" };
    const ran = row("thread", 70, 0, 0, 0, 0);
    expect(summarize([skipped, skipped])).toContain('| thread | 0 (2 skipped) | skipped: Error: No link for a[href^="?thread="] |');
    expect(summarize([ran, skipped])).toContain("| thread | 1 (1 skipped) | 70 (70) |");
  });
});
