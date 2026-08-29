import { describe, expect, it } from "vitest";
import { centredScrollTop } from "./TranscriptPanel";

const PANEL = { panelHeight: 400, panelScrollHeight: 2000 };

describe("centredScrollTop", () => {
  it("centres a segment in the middle of the panel", () => {
    // 1000 - 200 + 25 → the segment's midpoint lands on the panel's midpoint.
    expect(
      centredScrollTop({ segmentOffsetTop: 1000, segmentHeight: 50, ...PANEL })
    ).toBe(825);
  });

  it("does not scroll past the top for the first segment", () => {
    // Centring segment 0 asks for a negative offset.
    expect(centredScrollTop({ segmentOffsetTop: 0, segmentHeight: 50, ...PANEL })).toBe(0);
  });

  it("does not scroll past the bottom for the last segment", () => {
    expect(
      centredScrollTop({ segmentOffsetTop: 1950, segmentHeight: 50, ...PANEL })
    ).toBe(1600);
  });

  it("stays at zero when the panel does not overflow", () => {
    // A short transcript has nothing to scroll; asking for a centre would
    // otherwise produce a negative or clipped offset.
    expect(
      centredScrollTop({
        segmentOffsetTop: 120,
        segmentHeight: 50,
        panelHeight: 400,
        panelScrollHeight: 300,
      })
    ).toBe(0);
  });
});
