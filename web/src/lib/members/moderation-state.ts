import { parseTopicsJson } from "@/lib/talent/profile";
import { sql, type SQLWrapper } from "drizzle-orm";
import { studentProfile } from "@/lib/db/schema";
import { moderationColumns } from "@/lib/talent/profile-moderation";
import type {
  ProfileModerationResult,
  ProfileModerationState,
} from "@/lib/moderation/clef";

export function pendingProfileModeration() {
  return {
    moderationOutcome: sql`CASE WHEN ${studentProfile.moderationOutcome}='hold' THEN 'hold' ELSE NULL END`,
    moderationReviewRequired: true,
  };
}
export function checkedModerationColumns(
  result: ProfileModerationResult,
  column: SQLWrapper = studentProfile.moderationOutcome,
) {
  return {
    ...moderationColumns(result),
    moderationOutcome:
      result.outcome === "error"
        ? sql`CASE WHEN ${column}='hold' THEN 'hold' ELSE 'error' END`
        : result.outcome,
  };
}

/** One text projection for profiles checked with their posted work. */
export function workModerationHighlights(
  work: readonly {
    title?: string;
    repoFullName: string | null;
    repoDescription?: string | null;
    description: string | null;
    blurb: string | null;
    language: string | null;
    topics: string | null;
  }[] = [],
) {
  return work.map((item) => ({
    repoFullName: item.repoFullName ?? item.title ?? "",
    description: item.repoFullName
      ? (item.repoDescription ?? item.description)
      : item.description,
    blurb: item.blurb,
    language: item.language,
    topics: parseTopicsJson(item.topics),
  }));
}

/** Canonical profile text projection for every write entrypoint. Overrides are proposed edits. */
export function profileModerationState(
  profile: {
    handle: string;
    headline?: string | null;
    bio?: string | null;
    opportunityGoals?: string | null;
    location?: string | null;
    country?: string | null;
    skills?: string | null;
    githubLogin?: string | null;
    portfolioUrl?: string | null;
    linkedinUrl?: string | null;
    publicName?: string | null;
    user?: { name: string };
    work?: Parameters<typeof workModerationHighlights>[0];
  },
  overrides: Partial<ProfileModerationState> = {},
): ProfileModerationState {
  return {
    displayName: profile.publicName ?? profile.user?.name ?? "",
    handle: profile.handle,
    headline: profile.headline ?? null,
    bio:
      [profile.bio, profile.opportunityGoals].filter(Boolean).join("\n") ||
      null,
    location: profile.location ?? null,
    country: profile.country ?? null,
    skills: parseTopicsJson(profile.skills ?? null),
    githubLogin: profile.githubLogin ?? null,
    portfolioUrl: profile.portfolioUrl ?? null,
    linkedinUrl: profile.linkedinUrl ?? null,
    ...(profile.work
      ? { highlights: workModerationHighlights(profile.work) }
      : {}),
    ...overrides,
  };
}
