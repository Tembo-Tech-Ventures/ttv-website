import { createId } from "@paralleldrive/cuid2";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import type {
  ProfileModerationResult,
  ProfileModerationState,
} from "@/lib/moderation/clef";
import {
  moderationColumns,
  publishesAfterModeration,
} from "@/lib/talent/profile-moderation";
import { parseTopicsJson } from "@/lib/talent/profile";

export interface ProfileHighlightValues {
  repoFullName: string;
  repoUrl: string;
  description: string | null;
  language: string | null;
  topics: string;
  stars: number;
  pushedAt: Date | null;
  blurb: string | null;
  sortOrder: number;
  snapshotAt: Date;
}

export interface HighlightProfileState {
  id: string;
  userId: string;
  status: "DRAFT" | "PUBLISHED" | "SUSPENDED";
  contentVersion: number;
  handle: string;
  headline: string | null;
  bio: string | null;
  location: string | null;
  country: string | null;
  skills: string | null;
  githubLogin: string | null;
  portfolioUrl: string | null;
  linkedinUrl: string | null;
  publicName: string | null;
  publicAvatarUrl: string | null;
  user: { name: string; image: string | null };
}

export type ProfileHighlightWriteResult =
  | { outcome: "saved" }
  | { outcome: "hold" }
  | { outcome: "conflict" }
  | { outcome: "suspended" };

const clearedModeration = {
  moderationOutcome: null,
  moderationFlags: null,
  moderationScores: null,
  moderationCheckedAt: null,
  moderationReviewRequired: false,
} as const;

export function profileStateWithHighlights(
  profile: HighlightProfileState,
  skills: string[],
  highlights: readonly ProfileHighlightValues[],
): ProfileModerationState {
  return {
    displayName: profile.publicName ?? profile.user.name,
    handle: profile.handle,
    headline: profile.headline,
    bio: profile.bio,
    location: profile.location,
    country: profile.country,
    skills,
    githubLogin: profile.githubLogin,
    portfolioUrl: profile.portfolioUrl,
    linkedinUrl: profile.linkedinUrl,
    highlights: highlights.map(
      ({ repoFullName, description, blurb, language, topics }) => ({
        repoFullName,
        description,
        blurb,
        language,
        topics: parseTopicsJson(topics),
      }),
    ),
  };
}

function epochSeconds(value: Date | null): number | null {
  return value ? Math.floor(value.getTime() / 1_000) : null;
}

export async function replaceProfileHighlights(
  db: Database,
  profile: HighlightProfileState,
  highlights: readonly ProfileHighlightValues[],
  moderation?: ProfileModerationResult,
): Promise<ProfileHighlightWriteResult> {
  if (profile.status === "SUSPENDED") return { outcome: "suspended" };
  if (profile.status === "PUBLISHED" && !moderation) {
    throw new Error("Published profile highlights require moderation");
  }

  const expectedProfile = and(
    eq(schema.studentProfile.id, profile.id),
    eq(schema.studentProfile.userId, profile.userId),
    eq(schema.studentProfile.status, profile.status),
    eq(schema.studentProfile.contentVersion, profile.contentVersion),
  );
  const profileIsCurrent = sql`exists (
    select 1 from ${schema.studentProfile}
    where ${expectedProfile}
  )`;
  const profileValues = moderation
    ? moderationColumns(moderation)
    : clearedModeration;

  if (moderation && !publishesAfterModeration(moderation)) {
    const result = await db
      .update(schema.studentProfile)
      .set({
        ...profileValues,
        contentVersion: sql`${schema.studentProfile.contentVersion} + 1`,
      })
      .where(expectedProfile);
    return result.meta.changes > 0
      ? { outcome: "hold" }
      : { outcome: "conflict" };
  }

  const deleteHighlights = db
    .delete(schema.profileHighlight)
    .where(
      and(eq(schema.profileHighlight.profileId, profile.id), profileIsCurrent),
    );
  const insertHighlights = highlights.map((highlight) =>
    db.insert(schema.profileHighlight).select(sql`
      select
        ${createId()},
        ${profile.id},
        ${highlight.repoFullName},
        ${highlight.repoUrl},
        ${highlight.description},
        ${highlight.language},
        ${highlight.topics},
        ${highlight.stars},
        ${epochSeconds(highlight.pushedAt)},
        ${highlight.blurb},
        ${highlight.sortOrder},
        ${epochSeconds(highlight.snapshotAt)},
        unixepoch(),
        unixepoch()
      where ${profileIsCurrent}
    `),
  );
  const updateProfile = db
    .update(schema.studentProfile)
    .set({
      ...profileValues,
      contentVersion: sql`${schema.studentProfile.contentVersion} + 1`,
    })
    .where(expectedProfile);
  const queries = [deleteHighlights, ...insertHighlights, updateProfile] as [
    typeof deleteHighlights,
    ...typeof insertHighlights,
    typeof updateProfile,
  ];
  const results = await db.batch(queries);
  const profileResult = results.at(-1);

  return profileResult?.meta.changes
    ? { outcome: "saved" }
    : { outcome: "conflict" };
}
