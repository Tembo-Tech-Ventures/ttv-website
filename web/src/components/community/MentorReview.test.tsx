/* oxlint-disable no-script-url -- Deliberately unsafe URL fixtures verify link filtering. */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import MentorReview, {
  safeMentorEvidenceUrl,
  validateMentorNote,
  type MentorReviewRequest,
} from "./MentorReview";

const request: MentorReviewRequest = {
  id: "claim-1",
  memberName: "Demo member",
  claimTitle: "Built a scheduling API",
  claimDescription: "Implemented documented API routes with tests.",
  status: "pending",
  evidence: [
    {
      id: "source-1",
      title: "Project repository",
      url: "https://example.com/project",
    },
  ],
};
const render = (requests = [request], demo = false) =>
  renderToStaticMarkup(
    <MentorReview
      requests={requests}
      onReview={vi.fn(async () => {})}
      demo={demo}
    />,
  );

describe("MentorReview", () => {
  it("identifies the exact claim, scope, evidence and labelled review fields", () => {
    const html = render();
    expect(html).toContain("Built a scheduling API");
    expect(html).toContain("not an endorsement of the whole person");
    expect(html).toContain("An assistant response does not confirm a claim");
    expect(html).toContain('href="https://example.com/project"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("What did you personally check?");
    expect(html).toContain("Choose a decision");
    expect(html).toMatch(/<textarea[^>]+required=""/);
    expect(html).toContain("aria-labelledby=");
  });
  it("marks demonstration actions clearly", () => {
    expect(render([request], true)).toContain("not real mentor confirmations");
    expect(render([request], true)).toContain("Save demo review");
    expect(render()).not.toContain("Save demo review");
  });
  it.each(["confirmed", "declined"] as const)(
    "does not offer repeat review for %s claims",
    (status) => {
      const html = render([{ ...request, status }]);
      expect(html).not.toContain("<form");
      expect(html).toContain(
        status === "confirmed"
          ? "Claim confirmed: Built a scheduling API"
          : "Confirmation declined for this claim: Built a scheduling API",
      );
    },
  );
  it("provides empty states without implying a negative judgment", () => {
    expect(render([])).toContain("No claims are awaiting review");
    expect(render([{ ...request, evidence: [] }])).toContain(
      "Missing evidence is not evidence against the member",
    );
  });
  it("renders unsafe evidence as text without a navigable link", () => {
    const html = render([
      {
        ...request,
        evidence: [{ id: "bad", title: "Source", url: "javascript:alert(1)" }],
      },
    ]);
    expect(html).toContain("Source — link unavailable");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("javascript:");
  });
});

describe("mentor review validation", () => {
  it.each(["", "   ", "Looks good", "a".repeat(30), " ".repeat(30) + "yes"])(
    "rejects insufficient note %j",
    (note) => {
      expect(validateMentorNote(note)).not.toBeNull();
    },
  );
  it("accepts a personal review and rejects oversized notes", () => {
    expect(
      validateMentorNote(
        "I ran the repository tests and inspected the API routes.",
      ),
    ).toBeNull();
    expect(
      validateMentorNote("Checked the source " + "a".repeat(2000)),
    ).toContain("2,000");
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,test",
    "//example.com",
    "/private",
    "https://user:password@example.com",
    "not a url",
  ])("blocks unsupported URL %j", (url) => {
    expect(safeMentorEvidenceUrl(url)).toBeNull();
  });
  it.each(["http://example.com/", "https://example.com/source"])(
    "allows web evidence %j",
    (url) => {
      expect(safeMentorEvidenceUrl(url)).toBe(url);
    },
  );
});
