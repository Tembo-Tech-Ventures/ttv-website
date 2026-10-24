import { z } from "zod";
import type { CommunityProfile } from "../discovery/types";
import { UiApiError } from "../discovery/ui-errors";
import { communityRequest } from "./community-client";
import {
  assessmentRubricSchema,
  evidenceAssessmentSchema,
  matchesAssessmentRequest,
  type AssessmentRubric,
} from "./assessment-contract";

export async function assessProfile(
  profile: CommunityProfile,
  rubric: AssessmentRubric,
) {
  const input = assessmentRubricSchema.safeParse(rubric);
  if (!input.success) throw new UiApiError(400);
  const { assessment } = await communityRequest(
    `profiles/${encodeURIComponent(profile.id)}/assessment`,
    z.object({ assessment: evidenceAssessmentSchema }),
    "POST",
    input.data,
  );
  if (!matchesAssessmentRequest(assessment, profile, input.data))
    throw new UiApiError(502);
  return assessment;
}
