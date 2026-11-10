import {
  pendingProfileModeration,
  checkedModerationColumns,
  profileModerationState,
} from "@/lib/members/moderation-state";
import { and, eq, exists, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { profileModerationMessages} from "@/lib/moderation/clef";
import { publishesAfterModeration } from "@/lib/talent/profile-moderation";
import {
  PROFILE_CHANGED_MESSAGE,
  type ProfileContentCheck,
  type ProfileFormResult,
} from "@/components/portfolio/portfolio-handlers";

export interface ProfileIdentityInput {
  name?: string;
  avatarUrl?: string;
}

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
  expectedStatus: typeof schema.studentProfile.$inferSelect.status,
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
      opportunityGoals: true,
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
      work: {
        columns: {
          title: true,
          repoDescription: true,
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

  if (profile.status === "SUSPENDED") {
    await db
      .update(schema.user)
      .set(userIdentityValues(input))
      .where(eq(schema.user.id, userId));
    return { success: true };
  }

  const proposedName = input.name ?? profile.publicName ?? profile.user.name;
  const proposedAvatarUrl = input.avatarUrl ?? profile.publicAvatarUrl;
  if (
    proposedName === (profile.publicName ?? profile.user.name) &&
    proposedAvatarUrl === profile.publicAvatarUrl
  ) {
    await db
      .update(schema.user)
      .set(userIdentityValues(input))
      .where(eq(schema.user.id, userId));
    return { success: true };
  }
  const moderationState= profileModerationState(profile, {
    displayName: proposedName,
    });
  const saveTextFirst = profile.status === "DRAFT";
  // Saved profiles are visible to members. Save text first, then check
  // the exact new revision. Keep the previous safe avatar until its check ends.
  if (saveTextFirst) {
    const saved = await applyVersionedIdentityUpdate(
      db,
      userId,
      profile,
      profile.status,
      input,
      {
        publicName: proposedName,
        ...pendingProfileModeration(),
      },
    );
    if (!saved) return changedDuringCheck();
  }
  let moderation: Awaited<ReturnType<ProfileContentCheck>>;
  try {
    moderation = await (checkContent?.(moderationState, proposedAvatarUrl) ??
      Promise.resolve({ outcome: "error" as const, flags: [], scores: {} }));
  } catch {
    moderation = { outcome: "error" as const, flags: [], scores: {} };
  }

  const moderationValues = checkedModerationColumns(moderation);
  if (saveTextFirst)
    return finishSavedIdentity(
      db,
      userId,
      profile,
      proposedName,
      proposedAvatarUrl,
      moderation,
    );
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

async function finishSavedIdentity(
  db: Database,
  userId: string,
  profile: {
    id: string;
    status: typeof schema.studentProfile.$inferSelect.status;
    contentVersion: number;
  },
  proposedName: string,
  proposedAvatarUrl: string | null,
  moderation: Awaited<ReturnType<ProfileContentCheck>>,
): Promise<ProfileFormResult> {
  const result = await db
    .update(schema.studentProfile)
    .set({
      publicName: proposedName,
      ...checkedModerationColumns(moderation),
      ...(publishesAfterModeration(moderation)
        ? {
            publicAvatarUrl: Object.hasOwn(moderation, "publicAvatarUrl")
              ? (moderation.publicAvatarUrl ?? null)
              : proposedAvatarUrl,
          }
        : {}),
    })
    .where(
      and(
        eq(schema.studentProfile.id, profile.id),
        eq(schema.studentProfile.userId, userId),
        eq(schema.studentProfile.status, profile.status),
        eq(schema.studentProfile.contentVersion, profile.contentVersion + 1),
      ),
    );
  if (!result.meta.changes) return changedDuringCheck();
  return {
    success: true,
    moderationOutcome: moderation.outcome,
    ...(profile.status === "PUBLISHED" ? { published: true } : {}),
  };
}
