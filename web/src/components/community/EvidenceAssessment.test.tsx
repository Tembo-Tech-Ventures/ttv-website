/* oxlint-disable eslint/no-script-url -- Deliberately hostile source URLs verify safe rendering. */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import EvidenceAssessmentForm, { AssessmentResults } from "./EvidenceAssessment";
import type { EvidenceAssessment } from "./assessment-contract";
import type { CommunityProfile } from "../discovery/types";

const profile: CommunityProfile = {
  id: "member",
  version: 1,
  name: "Amina Wanjiku",
  headline: "",
  about: "",
  location: "",
  goal: "",
  skills: [],
  claims: [],
};
const assessment: EvidenceAssessment = {
  status: "completed",
  method: "model-evidence-support-v1",
  model: "test-model",
  rubric: { id: "test", version: 2 },
  subject: { userId: "member", profileVersion: 1 },
  disclaimer: "Evidence support",
  criteria: [],
};
it("shows low evidence support separately from each unscored state and escapes source text", () => {
  const value: EvidenceAssessment = {
    ...assessment,
    criteria: ["assessed", "insufficient", "uncertain", "contradictory"].map(
      (status, index) => ({
        criterionId: String(index),
        label: `Criterion ${index}`,
        status: status as EvidenceAssessment["criteria"][number]["status"],
        rating: status === "assessed" ? 1 : null,
        explanation: "<script>unsafe</script>",
        citations:
          status === "insufficient"
            ? []
            : [
                {
                  kind: "profile",
                  id: "member",
                  userId: "member",
                  version: 1,
                  url: "javascript:alert(1)",
                  quote: "<img onerror=alert(1)>",
                },
              ],
      }),
    ),
  };
  const html = renderToStaticMarkup(
    <AssessmentResults assessment={value} profile={profile} />,
  );
  expect(html).toContain("Evidence support 1/5");
  expect(html).toContain("AI-generated evidence support");
  expect(html).not.toContain("No AI assessment was run.");
  expect(html).toContain(
    "Assessments use profile text and skills, published contribution text, and current review notes. Linked artifacts are not fetched.",
  );
  for (const state of ["Insufficient", "Uncertain", "Contradictory"])
    expect(html).toContain(`${state} evidence · Not scored`);
  expect(html).not.toContain("javascript:");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img");
  expect(html).toContain("Community profile · Revision 1");
  expect(html).toContain(
    "not ability, verification or a hiring recommendation",
  );
});
it.each(["unavailable", "invalid_output"] as const)(
  "does not turn %s into an evidence judgment",
  (status) => {
    const html = renderToStaticMarkup(
      <AssessmentResults
        assessment={{ ...assessment, status }}
        profile={profile}
      />,
    );
    expect(html).toContain("No evidence ratings were produced");
    expect(html).not.toContain("Insufficient evidence");
    expect(html).not.toContain("/5");
  },
);

it("does not claim AI generation when empty evidence bypasses the model", () => {
  const html = renderToStaticMarkup(
    <AssessmentResults
      assessment={{
        ...assessment,
        model: null,
        criteria: [
          {
            criterionId: "empty",
            label: "Accessible interfaces",
            status: "insufficient",
            rating: null,
            explanation: "No published evidence is available.",
            citations: [],
          },
        ],
      }}
      profile={profile}
    />,
  );
  expect(html).toContain("Evidence availability");
  expect(html).toContain("No AI assessment was run.");
  expect(html).toContain("Insufficient evidence · Not scored");
  expect(html).not.toContain("AI-generated");
  expect(html).not.toContain("/5");
});

 it("keeps accessible criteria grouping and evidence limits without a second visible title", () => {
  const html = renderToStaticMarkup(<EvidenceAssessmentForm profile={profile} onAssess={async () => assessment} />);
  expect(html).toContain('class="discovery-sr-only">Your assessment criteria');
  expect(html).toContain("documented evidence, not ability");
  expect(html).toContain("change your search filters");
  expect(html).toContain("What the 1–5 scale means");
  expect(html).toContain("Missing, uncertain or conflicting evidence is not scored");
});
