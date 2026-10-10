import { and, eq, exists, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { parseSkillsJson, parseTopicsJson } from "@/lib/talent/profile";
import {
  profileModerationMessages,
  type ProfileModerationState,
} from "@/lib/moderation/clef";
import {
  moderationColumns,
  publishesAfterModeration,
} from "@/lib/talent/profile-moderation";
import {
  PROFILE_CHANGED_MESSAGE,
  type ProfileContentCheck,
  type ProfileFormResult,
} from "@/components/portfolio/portfolio-handlers";

export interface ProfileIdentityInput {
  name?: string;
  avatarUrl?: string;
}

const clearedModeration = {
  publicName: null,
  publicAvatarUrl: null,
  moderationOutcome: null,
  moderationFlags: null,
  moderationScores: null,
  moderationCheckedAt: null,
  moderationReviewRequired: false,
} as const;

function changedDuringCheck(): ProfileFormResult {
  return {
    success: false,
    error: PROFILE_CHANGED_MESSAGE,
  };
}

function userIdentityValues(input: ProfileIdentityInput) {
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.avatarUrl === undefined ? {} : { image: input.avatarUrl }),
  };
}

async function applyVersionedIdentityUpdate(
  db: Database,
  userId: string,
  profile: { id: string; contentVersion: number },
  expectedStatus: "DRAFT" | "PUBLISHED",
  input: ProfileIdentityInput,
  profileValues: Record<string, unknown>,
): Promise<boolean> {
  const expectedProfile = and(
    eq(schema.studentProfile.id, profile.id),
    eq(schema.studentProfile.userId, userId),
    eq(schema.studentProfile.status, expectedStatus),
    eq(schema.studentProfile.contentVersion, profile.contentVersion),
  );
  const userWrite = db
    .update(schema.user)
    .set(userIdentityValues(input))
    .where(
      and(
        eq(schema.user.id, userId),
        exists(
          db
            .select({ id: schema.studentProfile.id })
            .from(schema.studentProfile)
            .where(expectedProfile),
        ),
      ),
    );
  const profileWrite = db
    .update(schema.studentProfile)
    .set({
      ...profileValues,
      contentVersion: sql`${schema.studentProfile.contentVersion} + 1`,
    })
    .where(expectedProfile);

  // D1 batches are atomic. Writing the user first keeps both predicates on the
  // same expected profile version; either both identity rows move together or
  // neither does.
  const [userResult, profileResult] = await db.batch([userWrite, profileWrite]);
  return userResult.meta.changes > 0 && profileResult.meta.changes > 0;
}

export async function saveProfileIdentity(
  db: Database,
  userId: string,
  input: ProfileIdentityInput,
  checkContent?: ProfileContentCheck,
): Promise<ProfileFormResult> {
  const profile = await db.query.studentProfile.findFirst({
    where: eq(schema.studentProfile.userId, userId),
    columns: {
      id: true,
      status: true,
      contentVersion: true,
      handle: true,
      headline: true,
      bio: true,
      location: true,
      country: true,
      skills: true,
      githubLogin: true,
      portfolioUrl: true,
      linkedinUrl: true,
      publicName: true,
      publicAvatarUrl: true,
    },
    with: {
      user: { columns: { name: true, image: true } },
      highlights: {
        columns: {
          repoFullName: true,
          description: true,
          blurb: true,
          language: true,
          topics: true,
        },
      },
    },
  });

  if (!profile) {
    await db
      .update(schema.user)
      .set(userIdentityValues(input))
      .where(eq(schema.user.id, userId));
    return { success: true };
  }

  if (profile.status === "DRAFT") {
    const updated = await applyVersionedIdentityUpdate(
      db,
      userId,
      profile,
      "DRAFT",
      input,
      clearedModeration,
    );
    if (!updated) return changedDuringCheck();
    return { success: true };
  }

  if (profile.status === "SUSPENDED") {
    await db
      .update(schema.user)
      .set(userIdentityValues(input))
      .where(eq(schema.user.id, userId));
    return { success: true };
  }

  const proposedName = input.name ?? profile.publicName ?? profile.user.name;
  const proposedAvatarUrl = input.avatarUrl ?? profile.publicAvatarUrl;
  const moderationState: ProfileModerationState = {
    displayName: proposedName,
    handle: profile.handle,
    headline: profile.headline,
    bio: profile.bio,
    location: profile.location,
    country: profile.country,
    skills: parseSkillsJson(profile.skills),
    githubLogin: profile.githubLogin,
    portfolioUrl: profile.portfolioUrl,
    linkedinUrl: profile.linkedinUrl,
    highlights: profile.highlights.map(
      ({ repoFullName, description, blurb, language, topics }) => ({
        repoFullName,
        description,
        blurb,
        language,
        topics: parseTopicsJson(topics),
      }),
    ),
  };
  let moderation: Awaited<ReturnType<ProfileContentCheck>>;
  try {
    moderation = await (checkContent?.(moderationState, proposedAvatarUrl) ??
      Promise.resolve({ outcome: "error" as const, flags: [], scores: {} }));
  } catch {
    moderation = { outcome: "error" as const, flags: [], scores: {} };
  }

  const moderationValues = moderationColumns(moderation);
  const profileValues = publishesAfterModeration(moderation)
    ? {
        ...moderationValues,
        publicName: proposedName,
        publicAvatarUrl: Object.hasOwn(moderation, "publicAvatarUrl")
          ? (moderation.publicAvatarUrl ?? null)
          : proposedAvatarUrl,
      }
    : moderationValues;
  if (!publishesAfterModeration(moderation)) {
    const updateResult = await db
      .update(schema.studentProfile)
      .set({
        ...profileValues,
        contentVersion: sql`${schema.studentProfile.contentVersion} + 1`,
      })
      .where(
        and(
          eq(schema.studentProfile.id, profile.id),
          eq(schema.studentProfile.userId, userId),
          eq(schema.studentProfile.status, "PUBLISHED"),
          eq(schema.studentProfile.contentVersion, profile.contentVersion),
        ),
      );
    if (!updateResult.meta.changes) return changedDuringCheck();
    return {
      success: false,
      error: "Your changes need attention before they can go live.",
      moderationOutcome: moderation.outcome,
      moderationMessages: profileModerationMessages(moderation.flags),
    };
  }

  const updated = await applyVersionedIdentityUpdate(
    db,
    userId,
    profile,
    "PUBLISHED",
    input,
    profileValues,
  );
  if (!updated) return changedDuringCheck();
  return {
    success: true,
    moderationOutcome: moderation.outcome,
    published: true,
  };
}
