import { afterEach, describe, expect, it, vi } from "vitest";
import { assessProfile } from "./assessment-client";
import {
  assessmentRubricSchema,
  evidenceAssessmentSchema,
} from "./assessment-contract";
import type { CommunityProfile } from "../discovery/types";

const profile: CommunityProfile = {
  id: "member",
  version: 2,
  name: "Amina Wanjiku",
  headline: "Builder",
  about: "",
  location: "",
  goal: "",
  skills: [],
  claims: [
    {
      id: "entry",
      version: 3,
      title: "Library",
      description: "Keyboard navigation",
      date: "2026-10-24",
      skills: [],
      visibility: "institution",
      evidence: [
        {
          id: "source",
          title: "Source",
          kind: "Member source",
          url: "https://example.com/library",
        },
      ],
      confirmations: [],
    },
  ],
};
const rubric = {
  id: "institution-ui",
  version: 4,
  criteria: [
    {
      id: "c1",
      label: "Accessible interfaces",
      terms: ["keyboard"],
      contraryTerms: [],
    },
  ],
};
function result() {
  return {
    status: "completed",
    method: "model-evidence-support-v1",
    model: "test-model",
    rubric: { id: rubric.id, version: 4 },
    subject: { userId: "member", profileVersion: 2 },
    disclaimer: "Evidence, not ability",
    criteria: [
      {
        criterionId: "c1",
        label: "Accessible interfaces",
        status: "assessed",
        rating: 1,
        explanation: "Limited documented support",
        citations: [
          {
            kind: "journey",
            id: "entry",
            version: 3,
            userId: "member",
            url: "https://untrusted.example/",
          },
        ],
      },
    ],
  };
}
function respond(assessment: unknown, status = 200) {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ assessment }), { status }),
    );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());
describe("evidence assessment boundary", () => {
  it("submits explicit criteria and accepts a low evidence rating with source provenance", async () => {
    const fetcher = respond(result());
    expect((await assessProfile(profile, rubric)).criteria[0].rating).toBe(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/community/profiles/member/assessment",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify(rubric),
      }),
    );
  });
  it.each(["insufficient", "uncertain", "contradictory"])(
    "requires null, not a low rating, for %s",
    (status) => {
      const value = result();
      value.criteria[0].status = status;
      expect(evidenceAssessmentSchema.safeParse(value).success).toBe(false);
    },
  );
  it("keeps insufficient evidence distinct from provider failure", async () => {
    const missing = result();
    Object.assign(missing.criteria[0], {
      status: "insufficient",
      rating: null,
      citations: [],
    });
    respond(missing);
    expect((await assessProfile(profile, rubric)).criteria[0].status).toBe(
      "insufficient",
    );
    const unavailable = {
      ...result(),
      status: "unavailable",
      errorCode: "provider_unavailable",
      criteria: [],
    };
    respond(unavailable);
    expect((await assessProfile(profile, rubric)).status).toBe("unavailable");
    respond({ ...unavailable, criteria: missing.criteria });
    await expect(assessProfile(profile, rubric)).rejects.toMatchObject({
      status: 502,
    });
  });
  it.each(["subject", "rubric", "source", "label", "duplicate", "private"])(
    "rejects mismatched %s",
    async (kind) => {
      const value = result();
      const person = structuredClone(profile);
      if (kind === "subject") value.subject.userId = "someone-else";
      if (kind === "rubric") value.rubric.version++;
      if (kind === "source") value.criteria[0].citations[0].version++;
      if (kind === "label") value.criteria[0].label = "Different criterion";
      if (kind === "duplicate") value.criteria.push(value.criteria[0]);
      if (kind === "private") person.claims[0].visibility = "private";
      respond(value);
      await expect(assessProfile(person, rubric)).rejects.toMatchObject({
        status: 502,
      });
    },
  );
  it("rejects out-of-range or incomplete criteria before fetching", async () => {
    const fetcher = respond(result());
    await expect(
      assessProfile(profile, { ...rubric, criteria: [] }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      assessmentRubricSchema.safeParse({
        ...rubric,
        criteria: Array.from({ length: 11 }, (_, index) => ({
          ...rubric.criteria[0],
          id: String(index),
        })),
      }).success,
    ).toBe(false);
  });
  it("preserves authorization and rate-limit failures", async () => {
    for (const status of [401, 403, 429]) {
      respond({}, status);
      await expect(assessProfile(profile, rubric)).rejects.toMatchObject({
        status,
      });
    }
  });
});
