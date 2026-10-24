import { z } from "zod";
import { parseInput, type CommunityJourney, type CommunityProfile } from "./model";

export const rubricInput = z.object({
  id: z.string().trim().min(1).max(100),
  version: z.number().int().positive(),
  criteria: z.array(z.object({
    id: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(200),
    terms: z.array(z.string().trim().min(2).max(80)).min(1).max(10),
    contraryTerms: z.array(z.string().trim().min(2).max(80)).max(10).default([]),
  }).strict()).min(1).max(10),
}).strict().refine((r) => new Set(r.criteria.map((c) => c.id)).size === r.criteria.length, "Criterion IDs must be unique.");

export interface EvidenceCitation {
  kind: "profile" | "journey" | "confirmation";
  id: string;
  version: number;
  userId: string;
  url?: string | null;
}

/** Literal coverage of supplied criteria, never an inference of ability or truth. */
export function assessEvidence(profile: CommunityProfile, journeys: CommunityJourney[], input: unknown) {
  const rubric = parseInput(rubricInput, input);
  const sources = journeys.filter((j) => j.userId === profile.userId && j.visibility === "institution");
  return {
    method: "deterministic-literal-evidence-coverage-v1" as const,
    disclaimer: "Literal evidence matching, not verification, an ability rating, or a hiring recommendation.",
    rubric: { id: rubric.id, version: rubric.version },
    subject: { userId: profile.userId, profileVersion: profile.version },
    criteria: rubric.criteria.map((criterion) => {
      const matches = sources.filter((j) => criterion.terms.some((term) => `${j.title} ${j.description}`.toLowerCase().includes(term.toLowerCase())));
      const contrary = sources.filter((j) => (criterion.contraryTerms ?? []).some((term) => `${j.title} ${j.description}`.toLowerCase().includes(term.toLowerCase())));
      const cited = [...new Map([...matches, ...contrary].map((j) => [j.id, j])).values()];
      const stale = matches.some((j) => j.confirmations.some((c) => c.journeyVersion !== j.version));
      const status = matches.length > 0 && contrary.length > 0 ? "contradictory" : contrary.length > 0 || stale ? "uncertain" : matches.length > 0 ? "supported" : "insufficient";
      return { criterionId: criterion.id, label: criterion.label, status,
        explanation: status === "supported" ? "Published contribution text contains a supplied term; this does not establish proficiency." : status === "contradictory" ? "Both supplied supporting and contrary terms occur; human review required." : status === "uncertain" ? "Contrary terms or outdated confirmations require human review." : "No published contribution contains the supplied terms; absence is not evidence of inability.",
        citations: cited.flatMap((j): EvidenceCitation[] => [
          { kind: "journey", id: j.id, version: j.version, userId: j.userId, url: j.evidenceUrl },
          ...j.confirmations.filter((c) => c.journeyVersion === j.version).map((c): EvidenceCitation => ({ kind: "confirmation", id: c.id, version: c.journeyVersion, userId: j.userId })),
        ]),
      };
    }),
  };
}
