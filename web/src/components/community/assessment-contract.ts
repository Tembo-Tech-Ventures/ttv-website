import { z } from "zod";
import type { CommunityProfile } from "../discovery/types";

// Browser-only contract matching the assessment REST DTO; no provider code enters the client bundle.
const terms = z.array(z.string().trim().min(2).max(80)).min(1).max(10);
export const assessmentRubricSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    version: z.number().int().positive(),
    criteria: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(100),
          label: z.string().trim().min(1).max(200),
          terms,
          contraryTerms: z
            .array(z.string().trim().min(2).max(80))
            .max(10)
            .default([]),
        }),
      )
      .min(1)
      .max(10),
  })
  .refine(
    (rubric) =>
      new Set(rubric.criteria.map((item) => item.id)).size ===
      rubric.criteria.length,
  );
export type AssessmentRubric = z.infer<typeof assessmentRubricSchema>;
const citationSchema = z.object({
  kind: z.enum(["profile", "journey", "confirmation"]),
  id: z.string(),
  userId: z.string(),
  version: z.number().int().nonnegative(),
  url: z.string().nullable().optional(),
  quote: z.string().optional(),
});
const criterionSchema = z
  .object({
    criterionId: z.string(),
    label: z.string(),
    status: z.enum(["assessed", "insufficient", "uncertain", "contradictory"]),
    rating: z.number().int().min(1).max(5).nullable(),
    explanation: z.string(),
    citations: z.array(citationSchema),
  })
  .refine(
    (item) =>
      (item.status === "assessed"
        ? item.rating !== null
        : item.rating === null) &&
      (item.status === "insufficient"
        ? item.citations.length === 0
        : item.citations.length > 0),
  );
export const evidenceAssessmentSchema = z
  .object({
    status: z.enum(["completed", "unavailable", "invalid_output"]),
    method: z.literal("model-evidence-support-v1"),
    model: z.string().nullable(),
    rubric: z.object({ id: z.string(), version: z.number().int().positive() }),
    subject: z.object({
      userId: z.string(),
      profileVersion: z.number().int().nonnegative(),
    }),
    errorCode: z.enum(["provider_unavailable", "invalid_output"]).optional(),
    disclaimer: z.string(),
    criteria: z.array(criterionSchema).max(10),
  })
  .refine((assessment) =>
    assessment.status === "completed"
      ? assessment.errorCode === undefined
      : assessment.criteria.length === 0 &&
        assessment.errorCode ===
          (assessment.status === "unavailable"
            ? "provider_unavailable"
            : "invalid_output"),
  );
export type EvidenceAssessment = z.infer<typeof evidenceAssessmentSchema>;
type Citation = z.infer<typeof citationSchema>;

/** Resolve only against the authorized profile snapshot; never trust model URLs. */
export function assessmentSource(
  profile: CommunityProfile,
  citation: Citation,
) {
  if (citation.userId !== profile.id) return null;
  if (citation.kind === "profile")
    return citation.id === profile.id && citation.version === profile.version
      ? {
          label: `Community profile · Revision ${citation.version}`,
          sources: [],
        }
      : null;
  const claim = profile.claims.find(
    (item) =>
      item.visibility === "institution" &&
      (citation.kind === "journey"
        ? item.id === citation.id && item.version === citation.version
        : item.confirmations.some(
            (confirmation) =>
              confirmation.id === citation.id &&
              confirmation.journeyVersion === citation.version &&
              item.version === citation.version,
          )),
  );
  if (!claim) return null;
  return {
    label: `${citation.kind === "confirmation" ? "Confirmation of " : ""}${claim.title} · Revision ${citation.version}`,
    sources: claim.evidence,
  };
}

export function matchesAssessmentRequest(
  assessment: EvidenceAssessment,
  profile: CommunityProfile,
  rubric: AssessmentRubric,
) {
  if (
    assessment.subject.userId !== profile.id ||
    assessment.subject.profileVersion !== profile.version ||
    assessment.rubric.id !== rubric.id ||
    assessment.rubric.version !== rubric.version
  )
    return false;
  if (assessment.status !== "completed") return true;
  return (
    assessment.criteria.length === rubric.criteria.length &&
    new Set(assessment.criteria.map((item) => item.criterionId)).size ===
      rubric.criteria.length &&
    assessment.criteria.every(
      (item) =>
        rubric.criteria.some(
          (criterion) =>
            criterion.id === item.criterionId && criterion.label === item.label,
        ) &&
        new Set(
          item.citations.map((citation) =>
            JSON.stringify([citation.kind, citation.id, citation.version]),
          ),
        ).size === item.citations.length &&
        item.citations.every(
          (citation) => assessmentSource(profile, citation) !== null,
        ),
    )
  );
}
