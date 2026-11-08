import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TranscriptPanel, { centredScrollTop } from "./TranscriptPanel";

const SEGMENTS = [
  { id: "t1", startTime: 0, endTime: 4, text: "Welcome back.", speaker: "Mentor" },
  { id: "t2", startTime: 75.5, endTime: 90, text: "Questions?", speaker: null },
];

describe("TranscriptPanel", () => {
  const html = (segments = SEGMENTS) =>
    renderToStaticMarkup(<TranscriptPanel segments={segments} activeSegmentId="t1" onSeek={() => undefined} />);

  it("makes each line a link to ?t=, so it seeks without the script", () => {
    expect([...html().matchAll(/<a href="([^"]+)"/g)].map((match) => match[1])).toEqual(["?t=0", "?t=75.5"]);
    expect(html()).not.toContain("<button");
  });

  it("marks the playing line, with the kit's inset focus ring and timestamp chip", () => {
    expect(html()).toMatch(/<a href="\?t=0" aria-current="true" class="[^"]*focus-visible:outline-peach-ink/);
    expect(html()).toContain('data-chip="neutral"');
    expect(html()).not.toMatch(/outline-primary|text-white|bg-teal|bg-dark|text-primary/);
  });

  it("says the speaker in sentence case, not as an uppercase eyebrow", () => {
    expect(html()).toContain(">Mentor</span>");
    expect(html()).not.toMatch(/uppercase|tracking-/);
  });

  it("says when there is no transcript in a compact EmptyState", () => {
    const empty = html([]);
    expect(empty).toContain("data-empty-state");
    expect(empty).toContain("No transcript yet");
  });
});

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
