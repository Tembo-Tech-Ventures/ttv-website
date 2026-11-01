import { matchSchema } from "@/lib/community/discovery-contract";
import { z } from "zod";
import type {
  CommunityProfile,
  JourneyClaim,
  EvidenceAnswer,
  ScoutCriteria,
} from "../discovery/types";
import type { EditableCommunityProfile } from "./ProfileEditor";
import type { ClaimDraft } from "./JourneyWorkspace";
import type { MentorReviewRequest, MentorReviewDecision } from "./MentorReview";
import { UiApiError } from "../discovery/ui-errors";

// Validate the network boundary independently from server-side authorization.
const profileSchema = z.object({
  userId: z.string(),
  name: z.string(),
  image: z.string().nullable(),
  headline: z.string(),
  bio: z.string(),
  skills: z.array(z.string()),
  opportunityGoals: z.string(),
  version: z.number().int(),
  updatedAt: z.number().nullable(),
});
const confirmationSchema = z.object({
  id: z.string(),
  mentorName: z.string(),
  mentorRole: z.enum(["MENTOR", "ADMIN", "UNKNOWN"]).default("UNKNOWN"),
  statement: z.string(),
  method: z.string(),
  journeyVersion: z.number().int(),
  createdAt: z.number(),
});
const entrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  description: z.string(),
  evidenceUrl: z.string().nullable().optional(),
  occurredAt: z.string(),
  visibility: z.enum(["institution", "private"]),
  version: z.number().int().positive(),
  confirmations: z.array(confirmationSchema).default([]),
});
const accessSchema = z.object({
  isAdmin: z.boolean(),
  isInstitution: z.boolean(),
  isMentor: z.boolean(),
});
const detailSchema = z.object({
  profile: profileSchema,
  entries: z.array(entrySchema),
});
type ProfileDto = z.infer<typeof profileSchema>;
type EntryDto = z.infer<typeof entrySchema>;
export type CommunityAccess = z.infer<typeof accessSchema>;

export function mapJourney(entry: EntryDto): JourneyClaim {
  return {
    id: entry.id,
    title: entry.title,
    description: entry.description,
    date: entry.occurredAt,
    version: entry.version,
    visibility: entry.visibility,
    skills: [],
    evidence: entry.evidenceUrl
      ? [
          {
            id: entry.id,
            title: "Supporting work",
            url: entry.evidenceUrl,
            kind: "Member-attached source",
          },
        ]
      : [],
    confirmations: entry.confirmations.map((confirmation) => ({
      id: confirmation.id,
      mentorName: confirmation.mentorName,
      mentorRole: confirmation.mentorRole,
      note: confirmation.statement,
      method: confirmation.method,
      date: new Date(confirmation.createdAt * 1000).toISOString().slice(0, 10),
      journeyVersion: confirmation.journeyVersion,
    })),
  };
}
export function mapProfile(
  profile: ProfileDto,
  entries?: EntryDto[],
): CommunityProfile {
  return {
    id: profile.userId,
    version: profile.version,
    name: profile.name,
    headline: profile.headline,
    about: profile.bio,
    skills: profile.skills,
    goal: profile.opportunityGoals,
    location: "",
    claims: entries?.map(mapJourney) ?? [],
    evidenceLoaded: entries !== undefined,
  };
}

export async function communityRequest<T>(
  path: string,
  schema: {
    safeParse(
      input: unknown,
    ): { success: true; data: T } | { success: false; error: unknown };
  },
  method = "GET",
  body?: unknown,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const controller = new AbortController();
  // Chat may use three bounded model steps (60s total); allow response overhead.
  const timeoutMs = (path === "chat" || path === "profiles/discover") && method === "POST" ? 70_000 : 25_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`/api/community/${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new UiApiError(response.status);
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new UiApiError(502);
    return parsed.data;
  } catch (error) {
    if (error instanceof UiApiError) throw error;
    throw new UiApiError(500);
  } finally {
    clearTimeout(timeout);
  }
}

export const loadAccess = () => communityRequest("access", accessSchema);
export async function loadOwnProfile() {
  const [profile, entries] = await Promise.all([
    communityRequest("profile", z.object({ profile: profileSchema })),
    communityRequest("journey", z.object({ entries: z.array(entrySchema) })),
  ]);
  return mapProfile(profile.profile, entries.entries);
}
export async function loadProfile(id: string) {
  const data = await communityRequest(
    `profiles/${encodeURIComponent(id)}`,
    detailSchema,
  );
  return mapProfile(data.profile, data.entries);
}
export async function saveProfile(draft: EditableCommunityProfile) {
  const result = await communityRequest(
    "profile",
    z.object({ profile: profileSchema }),
    "PUT",
    draft,
  );
  return mapProfile(result.profile);
}
export async function saveContribution(draft: ClaimDraft) {
  const result = await communityRequest(
    "journey",
    z.object({ entry: entrySchema }),
    "POST",
    {
      title: draft.title,
      description: draft.description,
      evidenceUrl: draft.sourceUrl.trim() || null,
      occurredAt: draft.date,
      visibility: "institution",
    },
  );
  return mapJourney(result.entry);
}
export async function updateContribution(claim: JourneyClaim, draft: ClaimDraft): Promise<JourneyClaim> {
  await communityRequest(`journey/${encodeURIComponent(claim.id)}`,z.object({id:z.string(),updated:z.literal(true)}),"PUT",{
    title:draft.title,description:draft.description,evidenceUrl:draft.sourceUrl.trim()||null,occurredAt:draft.date,
    visibility:claim.visibility??"institution",expectedRevision:claim.version,
  });
  const current=await communityRequest("journey",z.object({entries:z.array(entrySchema)}));
  const saved=current.entries.find(entry=>entry.id===claim.id);
  if(!saved || saved.version<=claim.version)throw new UiApiError(502);
  return mapJourney(saved);
}
export async function discoverPeople(criteria: ScoutCriteria) {
  const result = await communityRequest("profiles/discover", z.object({profiles:z.array(z.object({profile:profileSchema,matches:z.array(matchSchema)})),evaluated:z.number(),searched:z.number()}),"POST",criteria);
  return result.profiles.map(item=>({...mapProfile(item.profile),matches:item.matches,discovery:{evaluated:result.evaluated,searched:result.searched}}));
}
export async function searchProfiles(criteria: ScoutCriteria) {
  // Both filters are evaluated by the service before its result limit.
  const query = new URLSearchParams({
    query: criteria.query,
    skills: criteria.skills,
    limit: "50",
  });
  const result = await communityRequest(
    `profiles?${query}`,
    z.object({ profiles: z.array(profileSchema) }),
  );
  return result.profiles.map((profile) => mapProfile(profile));
}
export async function loadMentorship(): Promise<MentorReviewRequest[]> {
  const result = await communityRequest(
    "mentorship",
    z.object({
      // Retained QA personas read through a separate handler that predates set-aside.
      entries: z.array(entrySchema.extend({ memberName: z.string(), reviewedByCurrentMentor: z.boolean(), setAsideByCurrentMentor: z.boolean().default(false) })),
    }),
  );
  return result.entries.map((entry) => ({
    id: entry.id,
    version: entry.version,
    memberName: entry.memberName,
    claimTitle: entry.title,
    claimDescription: entry.description,
    evidence: mapJourney(entry).evidence,
    confirmations: mapJourney(entry).confirmations,
    status: entry.reviewedByCurrentMentor ? "confirmed" : "pending",
    // A confirmation outranks a set-aside: confirmed work is not waiting either way.
    setAside: entry.setAsideByCurrentMentor && !entry.reviewedByCurrentMentor,
  }));
}
/** "I can't confirm this": private to the mentor, for the revision they saw. */
export async function setAsideContribution(id: string, expectedRevision: number): Promise<void> {
  const result = await communityRequest(
    `journey/${encodeURIComponent(id)}/set-aside`,
    z.object({ setAside: z.object({ journeyId: z.string(), journeyVersion: z.number().int(), setAside: z.literal(true) }) }),
    "POST",
    { expectedRevision },
  );
  if (result.setAside.journeyId !== id || result.setAside.journeyVersion !== expectedRevision) throw new UiApiError(502);
}
export async function undoSetAside(id: string): Promise<void> {
  await communityRequest(
    `journey/${encodeURIComponent(id)}/set-aside`,
    z.object({ setAside: z.object({ journeyId: z.literal(id), setAside: z.literal(false) }) }),
    "DELETE",
  );
}
export async function confirmContribution(
  id: string,
  review: MentorReviewDecision,
): Promise<void> {
  if (review.decision !== "confirmed") throw new UiApiError(400);
  const result = await communityRequest(
    `journey/${encodeURIComponent(id)}/confirmations`,
    z.object({
      confirmation: z.object({
        id: z.string(),
        journeyVersion: z.number().int(),
      }),
    }),
    "POST",
    {
      statement: review.note,
      method: review.method,
      expectedRevision: review.expectedRevision,
    },
  );
  if (result.confirmation.journeyVersion !== review.expectedRevision)
    throw new UiApiError(502);
}

const chatSchema = z.object({
  answer: z.string(),
  aiGenerated: z.literal(true),
  grounded: z.boolean(),
  limited: z.boolean(),
  citations: z.array(
    z.object({
      kind: z.enum(["profile", "journey", "confirmation"]),
      id: z.string(),
      userId: z.string(),
      version: z.number().int(),
      url: z.string().nullable().optional(),
    }),
  ),
});
export async function askProfile(
  profile: CommunityProfile,
  question: string,
  criteria: ScoutCriteria,
): Promise<EvidenceAnswer> {
  const answer = await communityRequest("chat", chatSchema, "POST", {
    message: question,
    profileId: profile.id,
    context: `${criteria.context.slice(0, 1000)}\nSkills of interest: ${criteria.skills.slice(0, 300)}`,
  });
  if (!answer.grounded)
    return {
      text: "An evidence-grounded answer could not be produced. Narrow your question or review the published contributions directly.",
      sources: [],
      limited: true,
    };
  const references: string[] = [];
  const sources = new Map<string, JourneyClaim["evidence"][number]>();
  for (const citation of answer.citations) {
    if (citation.userId !== profile.id) throw new UiApiError(502);
    if (citation.kind === "profile") {
      if (citation.id !== profile.id || citation.version !== profile.version)
        throw new UiApiError(502);
      references.push(`Community profile · Revision ${citation.version}`);
      continue;
    }
    const claim = profile.claims.find((item) =>
      citation.kind === "journey"
        ? item.id === citation.id && item.version === citation.version
        : item.version === citation.version &&
          item.confirmations.some(
            (confirmation) =>
              confirmation.id === citation.id &&
              confirmation.journeyVersion === item.version,
          ),
    );
    if (!claim) throw new UiApiError(502);
    references.push(
      `${citation.kind === "confirmation" ? "Confirmation of " : ""}${claim.title} · Revision ${claim.version}`,
    );
    for (const source of claim.evidence) sources.set(source.id, source);
  }
  if (references.length === 0) throw new UiApiError(502);
  return {
    text: answer.answer,
    references: [...new Set(references)],
    sources: [...sources.values()],
    limited: answer.limited,
  };
}

/** Model order is confined to profiles actually retrieved and cited by the server. */
export async function orderProfilesByEvidence(criteria: ScoutCriteria) {
  const schema=z.object({answer:z.string(),grounded:z.boolean(),evaluatedCandidates:z.number().int().min(0).max(10),orderedProfiles:z.array(z.object({userId:z.string(),name:z.string(),reason:z.string(),missingEvidence:z.array(z.string()),citations:z.array(z.object({kind:z.enum(["journey","confirmation"]),id:z.string(),version:z.number().int(),url:z.string().nullable()})).default([])})).max(3)});
  const response=await communityRequest("chat",schema,"POST",{orderByEvidence:true,message:`Find a small shortlist using query ${JSON.stringify(criteria.query)} and skills ${JSON.stringify(criteria.skills.split(',').map(s=>s.trim()).filter(Boolean))}. Compare published project evidence for the opportunity and order by evidence relevance, with comparative reasons and unknowns.`,context:criteria.context.slice(0,2000)});
  if(!response.grounded || response.orderedProfiles.length === 0) throw new UiApiError(502);
  return {text:response.answer,evaluatedCandidates:response.evaluatedCandidates,profiles:response.orderedProfiles};
}
