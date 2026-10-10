import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { parseSkillsJson } from "@/lib/talent/profile";
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
    with: { user: { columns: { name: true, image: true } } },
  });

  if (!profile) {
    await db
      .update(schema.user)
      .set(userIdentityValues(input))
      .where(eq(schema.user.id, userId));
    return { success: true };
  }

  if (profile.status === "DRAFT") {
    const updateResult = await db
      .update(schema.studentProfile)
      .set(clearedModeration)
      .where(
        and(
          eq(schema.studentProfile.id, profile.id),
          eq(schema.studentProfile.userId, userId),
          eq(schema.studentProfile.status, "DRAFT"),
        ),
      );
    if (!updateResult.meta.changes) return changedDuringCheck();
    await db
      .update(schema.user)
      .set(userIdentityValues(input))
      .where(eq(schema.user.id, userId));
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
  const updateResult = await db
    .update(schema.studentProfile)
    .set(profileValues)
    .where(
      and(
        eq(schema.studentProfile.id, profile.id),
        eq(schema.studentProfile.userId, userId),
        eq(schema.studentProfile.status, "PUBLISHED"),
      ),
    );
  if (!updateResult.meta.changes) return changedDuringCheck();

  if (!publishesAfterModeration(moderation)) {
    return {
      success: false,
      error: "Your changes need attention before they can go live.",
      moderationOutcome: moderation.outcome,
      moderationMessages: profileModerationMessages(moderation.flags),
    };
  }

  await db
    .update(schema.user)
    .set(userIdentityValues(input))
    .where(eq(schema.user.id, userId));
  return {
    success: true,
    moderationOutcome: moderation.outcome,
    published: true,
  };
}
