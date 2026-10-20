import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FeedbackWidget, { FEEDBACK_KIND_OPTIONS } from "./FeedbackWidget";
import { strokeWidthFor } from "./MarkupEditor";
import { FEEDBACK_KIND_LABELS } from "@/lib/feedback/model";

describe("FeedbackWidget", () => {
  it("renders a labelled launcher that is kept out of page captures and print", () => {
    const html = renderToStaticMarkup(<FeedbackWidget />);
    expect(html).toContain("Feedback");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("data-feedback-ignore");
    expect(html).toContain("print:hidden");
  });

  it("keeps the launcher disabled until hydration attaches its handler", () => {
    expect(renderToStaticMarkup(<FeedbackWidget />)).toMatch(/<button[^>]*disabled=""/);
  });

  it("renders nothing visible on immersive pages that open it from a menu", () => {
    const html = renderToStaticMarkup(<FeedbackWidget showLauncher={false} />);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Send feedback");
  });

  it("offers the same kind labels the admin console shows", () => {
    for (const option of FEEDBACK_KIND_OPTIONS) {
      expect(option.label).toBe(FEEDBACK_KIND_LABELS[option.value]);
    }
  });
});

describe("strokeWidthFor", () => {
  it("scales with the image but never gets hairline-thin", () => {
    expect(strokeWidthFor(300)).toBe(3);
    expect(strokeWidthFor(2560)).toBe(9);
  });
});
