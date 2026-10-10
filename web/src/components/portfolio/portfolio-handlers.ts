import { and, eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import {
  normalizeHandle,
  validateHandle,
  type HandleValidationError,
} from "@/lib/talent/handles";
import {
  parseSkillsJson,
  profileEditorSchema,
  serializeSkills,
} from "@/lib/talent/profile";
import {
  profileModerationMessages,
  type ProfileModerationResult,
  type ProfileModerationState,
} from "@/lib/moderation/clef";
import {
  moderationColumns,
  publishesAfterModeration,
} from "@/lib/talent/profile-moderation";
import { safePublicProfileAvatarUrl } from "@/lib/avatar";

const HANDLE_ERROR_MESSAGES: Record<HandleValidationError, string> = {
  too_short: "Handle must be at least 3 characters",
  too_long: "Handle must be 39 characters or fewer",
  invalid_chars:
    "Handle can only contain lowercase letters, numbers, and hyphens",
  double_hyphen: "Handle cannot contain consecutive hyphens",
  reserved: "This handle is reserved",
};

export interface ProfileFormResult {
  success: boolean;
  error?: string;
  handleError?: string;
  fieldErrors?: Record<string, string>;
  moderationOutcome?: ProfileModerationResult["outcome"];
  moderationMessages?: string[];
  published?: boolean;
}

export const PROFILE_CHANGED_MESSAGE =
  "This profile changed while your request was running. Reload and try again.";

export type ProfileContentCheck = (
  state: ProfileModerationState,
  avatarUrl: string | null,
) => Promise<ProfileModerationResult & { publicAvatarUrl?: string | null }>;

const failOpenCheck: ProfileContentCheck = () =>
  Promise.resolve({ outcome: "error", flags: [], scores: {} });

async function runContentCheck(
  checkContent: ProfileContentCheck | undefined,
  state: ProfileModerationState,
  avatarUrl: string | null,
): ReturnType<ProfileContentCheck> {
  try {
    return await (checkContent ?? failOpenCheck)(state, avatarUrl);
  } catch {
    return failOpenCheck(state, avatarUrl);
  }
}

interface ProfileValues {
  handle: string;
  headline: string | null;
  bio: string | null;
  location: string | null;
  country: string | null;
  skills: string | null;
  openToFreelance: boolean;
  openToRoles: boolean;
  portfolioUrl: string | null;
  linkedinUrl: string | null;
}

interface CurrentProfile {
  handle: string;
  publishedAt: Date | null;
  status: "DRAFT" | "PUBLISHED" | "SUSPENDED";
  contentVersion: number;
  githubLogin: string | null;
  publicName: string | null;
  publicAvatarUrl: string | null;
  highlights?: Array<{
    repoFullName: string;
    description: string | null;
    blurb: string | null;
  }>;
  user: { name: string; image: string | null };
}

function moderationHighlights(
  highlights: CurrentProfile["highlights"],
): NonNullable<ProfileModerationState["highlights"]> {
  return (highlights ?? []).map(({ repoFullName, description, blurb }) => ({
    repoFullName,
    description,
    blurb,
  }));
}

function collectFieldErrors(
  issues: readonly { path: PropertyKey[]; message: string }[],
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.join(".");
    if (!fieldErrors[path]) fieldErrors[path] = issue.message;
  }
  return fieldErrors;
}

function serializeOptionalSkills(skills: string[] | undefined): string | null {
  return skills ? serializeSkills(skills) : null;
}

function profileChangedDuringCheck(): ProfileFormResult {
  return {
    success: false,
    error: PROFILE_CHANGED_MESSAGE,
  };
}

function publicIdentityColumns(
  moderation: Awaited<ReturnType<ProfileContentCheck>>,
  state: ProfileModerationState,
  avatarUrl: string | null,
) {
  return {
    publicName: state.displayName,
    publicAvatarUrl: Object.hasOwn(moderation, "publicAvatarUrl")
      ? (moderation.publicAvatarUrl ?? null)
      : safePublicProfileAvatarUrl(avatarUrl),
  };
}

async function updateDraftProfile(
  db: Database,
  userId: string,
  profileId: string,
  contentVersion: number,
  values: ProfileValues,
): Promise<ProfileFormResult> {
  const updateResult = await db
    .update(schema.studentProfile)
    .set({
      ...values,
      contentVersion: sql`${schema.studentProfile.contentVersion} + 1`,
    })
    .where(
      and(
        eq(schema.studentProfile.id, profileId),
        eq(schema.studentProfile.userId, userId),
        eq(schema.studentProfile.status, "DRAFT"),
        eq(schema.studentProfile.contentVersion, contentVersion),
      ),
    );
  return updateResult.meta.changes
    ? { success: true }
    : profileChangedDuringCheck();
}

function saveNonDraftProfile(
  db: Database,
  userId: string,
  profileId: string,
  current: CurrentProfile,
  values: ProfileValues,
  skills: string[],
  checkContent?: ProfileContentCheck,
): Promise<ProfileFormResult> {
  if (current.status === "PUBLISHED") {
    return savePublishedProfileEdit(
      db,
      userId,
      profileId,
      values,
      skills,
      current,
      checkContent,
    );
  }
  return Promise.resolve({
    success: false,
    error: "A suspended profile cannot be edited.",
  });
}

async function savePublishedProfileEdit(
  db: Database,
  userId: string,
  profileId: string,
  values: ProfileValues,
  skills: string[],
  current: CurrentProfile,
  checkContent?: ProfileContentCheck,
): Promise<ProfileFormResult> {
  const moderationState: ProfileModerationState = {
    displayName: current.publicName ?? current.user.name,
    handle: values.handle,
    headline: values.headline,
    bio: values.bio,
    location: values.location,
    country: values.country,
    skills,
    githubLogin: current.githubLogin,
    portfolioUrl: values.portfolioUrl,
    linkedinUrl: values.linkedinUrl,
    highlights: moderationHighlights(current.highlights),
  };
  const moderation = await runContentCheck(
    checkContent,
    moderationState,
    current.publicAvatarUrl,
  );
  const moderationValues = moderationColumns(moderation);

  if (!publishesAfterModeration(moderation)) {
    const updateResult = await db
      .update(schema.studentProfile)
      .set({
        ...moderationValues,
        contentVersion: sql`${schema.studentProfile.contentVersion} + 1`,
      })
      .where(
        and(
          eq(schema.studentProfile.id, profileId),
          eq(schema.studentProfile.userId, userId),
          eq(schema.studentProfile.status, "PUBLISHED"),
          eq(schema.studentProfile.contentVersion, current.contentVersion),
        ),
      );
    if (!updateResult.meta.changes) return profileChangedDuringCheck();
    return {
      success: false,
      error: "Your changes need attention before they can go live.",
      moderationOutcome: moderation.outcome,
      moderationMessages: profileModerationMessages(moderation.flags),
    };
  }

  const updateResult = await db
    .update(schema.studentProfile)
    .set({
      ...values,
      ...moderationValues,
      ...publicIdentityColumns(
        moderation,
        moderationState,
        current.publicAvatarUrl,
      ),
      contentVersion: sql`${schema.studentProfile.contentVersion} + 1`,
    })
    .where(
      and(
        eq(schema.studentProfile.id, profileId),
        eq(schema.studentProfile.userId, userId),
        eq(schema.studentProfile.status, "PUBLISHED"),
        eq(schema.studentProfile.contentVersion, current.contentVersion),
      ),
    );
  if (!updateResult.meta.changes) return profileChangedDuringCheck();
  return {
    success: true,
    moderationOutcome: moderation.outcome,
    published: true,
  };
}

export function extractProfileFormData(formData: FormData) {
  const rawSkills = (formData.get("skills") as string) || "";
  const skills = rawSkills
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    handle: (formData.get("handle") as string) || "",
    headline: (formData.get("headline") as string) || undefined,
    bio: (formData.get("bio") as string) || undefined,
    location: (formData.get("location") as string) || undefined,
    country: (formData.get("country") as string) || undefined,
    skills: skills.length > 0 ? skills : undefined,
    openToFreelance: formData.get("openToFreelance") === "on",
    openToRoles: formData.get("openToRoles") === "on",
    portfolioUrl: (formData.get("portfolioUrl") as string) || "",
    linkedinUrl: (formData.get("linkedinUrl") as string) || "",
  };
}

export async function validateProfileHandle(
  handle: string,
  db: Database,
  currentProfileId?: string,
): Promise<{ ok: true; normalized: string } | { ok: false; error: string }> {
  if (!handle.trim()) {
    return { ok: false, error: "Handle is required" };
  }

  const normalized = normalizeHandle(handle);
  const result = validateHandle(normalized);
  if (!result.ok) {
    return {
      ok: false,
      error: HANDLE_ERROR_MESSAGES[result.error],
    };
  }

  const existing = await db.query.studentProfile.findFirst({
    where: eq(schema.studentProfile.handle, normalized),
    columns: { id: true },
  });
  if (existing && existing.id !== currentProfileId) {
    return { ok: false, error: "This handle is already taken" };
  }

  return { ok: true, normalized };
}

export async function saveProfile(
  db: Database,
  userId: string,
  formData: FormData,
  existingProfileId?: string,
  checkContent?: ProfileContentCheck,
): Promise<ProfileFormResult> {
  const data = extractProfileFormData(formData);
  let current: CurrentProfile | undefined;

  // A published profile's handle is part of every blog post permalink
  // (`/blog/[handle]/[slug]`), so a rename would silently 404 every post and
  // every inbound link to it. Lock the handle once the profile has gone public.
  if (existingProfileId) {
    current = await db.query.studentProfile.findFirst({
      where: and(
        eq(schema.studentProfile.id, existingProfileId),
        eq(schema.studentProfile.userId, userId),
      ),
      columns: {
        handle: true,
        publishedAt: true,
        status: true,
        contentVersion: true,
        githubLogin: true,
        publicName: true,
        publicAvatarUrl: true,
      },
      with: {
        user: { columns: { name: true, image: true } },
        highlights: {
          columns: { repoFullName: true, description: true, blurb: true },
        },
      },
    });
    // `findFirst` yields undefined when there is no row; a Date is always
    // truthy, so this covers "no profile" and "not yet published" together.
    if (
      current?.publishedAt &&
      normalizeHandle(data.handle) !== current.handle
    ) {
      return {
        success: false,
        handleError:
          "Your handle is locked once your profile is published, because it is part of your post links.",
      };
    }
  }

  const handleResult = await validateProfileHandle(
    data.handle,
    db,
    existingProfileId,
  );
  if (!handleResult.ok) {
    return { success: false, handleError: handleResult.error };
  }

  const { handle: _handle, ...profileFields } = data;
  const parsed = profileEditorSchema.safeParse(profileFields);
  if (!parsed.success) {
    return {
      success: false,
      fieldErrors: collectFieldErrors(parsed.error.issues),
    };
  }

  const values = {
    handle: handleResult.normalized,
    headline: parsed.data.headline ?? null,
    bio: parsed.data.bio ?? null,
    location: parsed.data.location ?? null,
    country: parsed.data.country ?? null,
    skills: serializeOptionalSkills(parsed.data.skills),
    openToFreelance: parsed.data.openToFreelance ?? false,
    openToRoles: parsed.data.openToRoles ?? false,
    portfolioUrl: parsed.data.portfolioUrl || null,
    linkedinUrl: parsed.data.linkedinUrl || null,
  };

  if (existingProfileId) {
    if (!current) {
      return { success: false, error: "Profile not found" };
    }

    if (current.status !== "DRAFT") {
      return saveNonDraftProfile(
        db,
        userId,
        existingProfileId,
        current,
        values,
        parsed.data.skills ?? [],
        checkContent,
      );
    }

    return updateDraftProfile(
      db,
      userId,
      existingProfileId,
      current.contentVersion,
      values,
    );
  }

  await db.insert(schema.studentProfile).values({
    ...values,
    userId,
    status: "DRAFT",
  });
  return { success: true };
}

export async function publishProfile(
  db: Database,
  userId: string,
  profileId: string,
  checkContent?: ProfileContentCheck,
): Promise<ProfileFormResult> {
  const profile = await db.query.studentProfile.findFirst({
    where: and(
      eq(schema.studentProfile.id, profileId),
      eq(schema.studentProfile.userId, userId),
    ),
    columns: {
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
      publishedAt: true,
      contentVersion: true,
    },
    with: {
      user: { columns: { name: true, image: true } },
      highlights: {
        columns: { repoFullName: true, description: true, blurb: true },
      },
    },
  });

  if (!profile) {
    return { success: false, error: "Profile not found" };
  }

  if (profile.status !== "DRAFT") {
    return {
      success: false,
      error: "Only a draft profile can be published",
    };
  }

  const moderationState: ProfileModerationState = {
    displayName: profile.user.name,
    handle: profile.handle,
    headline: profile.headline,
    bio: profile.bio,
    location: profile.location,
    country: profile.country,
    skills: parseSkillsJson(profile.skills),
    githubLogin: profile.githubLogin,
    portfolioUrl: profile.portfolioUrl,
    linkedinUrl: profile.linkedinUrl,
    highlights: moderationHighlights(profile.highlights),
  };
  const moderation = await runContentCheck(
    checkContent,
    moderationState,
    profile.user.image,
  );
  const moderationValues = moderationColumns(moderation);
  const identityValues = publicIdentityColumns(
    moderation,
    moderationState,
    profile.user.image,
  );

  const updateResult = await db
    .update(schema.studentProfile)
    .set(
      publishesAfterModeration(moderation)
        ? {
            ...moderationValues,
            ...identityValues,
            status: "PUBLISHED",
            publishedAt: profile.publishedAt ?? new Date(),
            contentVersion: sql`${schema.studentProfile.contentVersion} + 1`,
          }
        : {
            ...moderationValues,
            ...identityValues,
            contentVersion: sql`${schema.studentProfile.contentVersion} + 1`,
          },
    )
    .where(
      and(
        eq(schema.studentProfile.id, profileId),
        eq(schema.studentProfile.userId, userId),
        eq(schema.studentProfile.status, "DRAFT"),
        eq(schema.studentProfile.contentVersion, profile.contentVersion),
      ),
    );
  if (!updateResult.meta.changes) return profileChangedDuringCheck();

  if (!publishesAfterModeration(moderation)) {
    return {
      success: false,
      error: "Your profile needs attention before it can go live.",
      moderationOutcome: moderation.outcome,
      moderationMessages: profileModerationMessages(moderation.flags),
      published: false,
    };
  }

  return {
    success: true,
    moderationOutcome: moderation.outcome,
    published: true,
  };
}
