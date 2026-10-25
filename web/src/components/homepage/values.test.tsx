import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FeaturesSection from "./FeaturesSection";
import ValuesSection from "./ValuesSection";
import { VALUES } from "./values";

describe("homepage value commitments", () => {
  it("retains the exact five source words and commitment descriptions", () => {
    expect(VALUES).toEqual([
      { word: "COMMUNITY", commitment: "Less a program, more a group of people building together." },
      { word: "PHILOSOPHY", commitment: "We teach how to see a system, not a syllabus to memorize." },
      { word: "EQUITY", commitment: "No degree required. English required — fluency isn't." },
      { word: "CONTINUITY", commitment: "We stay in touch after the cohort. We make it easy to reconnect when life pulls someone away." },
      { word: "HONESTY", commitment: "Two students in fintech internships so far. No job placements yet — we'll tell you when there are." },
    ]);
  });
  it("renders a manual carousel with named controls and a polite slide announcement", () => {
    const html = renderToStaticMarkup(<FeaturesSection />);
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('aria-label="Previous value"');
    expect(html).toContain('aria-label="Next value"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="1 of 5"');
    expect(html).toContain('role="group"');
    expect(html).not.toContain("<fieldset");
    expect(html).toContain(VALUES[0].word);
    expect(html).toContain(VALUES[0].commitment);
    expect(html).not.toContain("Mentorship");
    expect(html).toContain("How we build together");
    expect(html).toContain("Accountability over assignments.");
    expect(html).toContain("Some come back as mentors.");
  });
  it("keeps all five commitments available in the static section without clipping utilities", () => {
    const html = renderToStaticMarkup(<ValuesSection />);
    for (const { word, commitment } of VALUES) {
      expect(html).toContain(word);
      expect(html).toContain(commitment.replaceAll("'", "&#x27;"));
    }
    expect(html).not.toContain("overflow-x-clip");
    expect(html).not.toContain("overflow-hidden");
  });
});
