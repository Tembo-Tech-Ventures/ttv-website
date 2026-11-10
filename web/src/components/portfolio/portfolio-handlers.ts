import {
  pendingProfileModeration,
  checkedModerationColumns,
  profileModerationState,
} from "@/lib/members/moderation-state";
import { hasCompletedCohort } from "@/lib/talent/eligibility";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import {
  normalizeHandle,
  validateHandle,
  type HandleValidationError,
} from "@/lib/talent/handles";
import {
  profileEditorSchema,
  serializeSkills,
} from "@/lib/talent/profile";
import {
  profileModerationMessages,
  type ProfileModerationResult,
  type ProfileModerationState,
} from "@/lib/moderation/clef";
import { publishesAfterModeration } from "@/lib/talent/profile-moderation";
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
  /** The text was written, even though the check holds it (a draft's save). Never set when nothing was written. */
  saved?: boolean;
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
  opportunityGoals?: string;
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

interface CurrentProfile extends Partial<ProfileValues> {
  handle: string;
  publishedAt: Date | null;
  status: "DRAFT" | "PUBLISHED" | "SUSPENDED";
  contentVersion: number;
  githubLogin: string | null;
  publicName: string | null;
  publicAvatarUrl: string | null;
  work?: Array<{
    id: string;
    version: number;
    repoFullName: string | null;
    description: string | null;
    blurb: string | null;
    language: string | null;
    topics: string | null;
  }>;
  user: { name: string; image: string | null };
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
      ...pendingProfileModeration(),
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
  const moderationState = profileModerationState({ ...current, ...values }, { skills });
  const moderation = await runContentCheck(
    checkContent,
    moderationState,
    current.publicAvatarUrl,
  );
  const moderationValues = checkedModerationColumns(moderation);

  if (!publishesAfterModeration(moderation)) {
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
  if (moderation.outcome === "pass") await passCheckedWork(db, current.work);
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
    opportunityGoals: formData.has("opportunityGoals")
      ? String(formData.get("opportunityGoals"))
      : undefined,
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
        headline: true,
        bio: true,
        opportunityGoals: true,
        location: true,
        country: true,
        skills: true,
        portfolioUrl: true,
        linkedinUrl: true,
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
        work: {
          columns: {
            id: true,
            version: true,
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
    // After the first save the handle changes only when the form opened it on purpose
    // (`changeHandle=1`): a stale tab or another form posting the old value never renames,
    // and never undoes a rename made elsewhere.
    if (current && formData.get("changeHandle") !== "1") data.handle = current.handle;
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

  const values = editorValues(handleResult.normalized, parsed.data);

  if (existingProfileId) {
    if (!current) {
      return { success: false, error: "Profile not found" };
    }

    if (unchangedProfileText(current, values)) {
      await db
        .update(schema.studentProfile)
        .set({
          openToFreelance: values.openToFreelance,
          openToRoles: values.openToRoles,
        })
        .where(
          and(
            eq(schema.studentProfile.id, existingProfileId),
            eq(schema.studentProfile.userId, userId),
            eq(schema.studentProfile.contentVersion, current.contentVersion),
          ),
        );
      return { success: true };
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

    const saved = await updateDraftProfile(
      db,
      userId,
      existingProfileId,
      current.contentVersion,
      values,
    );
    if (!saved.success) return saved;
    return moderateSavedProfile(db, userId, checkContent);
  }

  await db.insert(schema.studentProfile).values({
    ...values,
    userId,
    status: "DRAFT",
    moderationReviewRequired: true,
  });
  return moderateSavedProfile(db, userId, checkContent);
}

async function moderateSavedProfile(
  db: Database,
  userId: string,
  checkContent?: ProfileContentCheck,
): Promise<ProfileFormResult> {
  const p = await db.query.studentProfile.findFirst({
    where: eq(schema.studentProfile.userId, userId),
    with: { user: true },
  });
  if (!p) return { success: false, error: "Profile not found" };
  const state = profileModerationState(p);
  const result = await runContentCheck(checkContent, state, p.user.image);
  await db
    .update(schema.studentProfile)
    .set({
      ...checkedModerationColumns(result),
      ...publicIdentityColumns(result, state, p.user.image),
    })
    .where(
      and(
        eq(schema.studentProfile.id, p.id),
        eq(schema.studentProfile.contentVersion, p.contentVersion),
      ),
    );
  return {
    success: result.outcome !== "hold",
    moderationOutcome: result.outcome,
    ...(result.outcome === "hold"
      ? { saved: true, error: "Your profile is saved and waiting for a human review." }
      : {}),
  };
}

export async function publishProfile(
  db: Database,
  userId: string,
  profileId: string,
  checkContent?: ProfileContentCheck,
): Promise<ProfileFormResult> {
  if (!(await hasCompletedCohort(db, userId)))
    return {
      success: false,
      error:
        "Complete a cohort before listing your profile on the public website.",
    };
  const profile = await db.query.studentProfile.findFirst({
    where: and(
      eq(schema.studentProfile.id, profileId),
      eq(schema.studentProfile.userId, userId),
    ),
    columns: {
      status: true,
      moderationOutcome: true,
      handle: true,
      headline: true,
      bio: true,
      opportunityGoals: true,
      publicName: true,
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
      work: {
        columns: {
          id: true,
          version: true,
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
    return { success: false, error: "Profile not found" };
  }

  if (profile.status !== "DRAFT") {
    return {
      success: false,
      error: "Only a draft profile can be published",
    };
  }

  // A held profile waits for a person: asking the check again must never lift the hold on its own.
  if (profile.moderationOutcome === "hold") {
    return {
      success: false,
      error: "Your profile is waiting for a check. A person at TTV looks at it before it can be listed.",
      moderationOutcome: "hold",
      published: false,
    };
  }

  const moderationState = profileModerationState(profile);
  const moderation = await runContentCheck(
    checkContent,
    moderationState,
    profile.user.image,
  );
  const moderationValues = checkedModerationColumns(moderation);
  const identityValues = publicIdentityColumns(
    moderation,
    moderationState,
    profile.user.image,
  );

  // A held profile never gets here (above), so only this check's own outcome decides.
  const canPublish = publishesAfterModeration(moderation);
  const updateResult = await db
    .update(schema.studentProfile)
    .set(
      canPublish
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
        canPublish && moderation.outcome === "error"
          ? sql`coalesce(${schema.studentProfile.moderationOutcome}, '') <> 'hold'`
          : undefined,
      ),
    );
  if (!updateResult.meta.changes) return profileChangedDuringCheck();

  if (!canPublish) {
    return {
      success: false,
      error: "Your profile needs attention before it can go live.",
      moderationOutcome: moderation.outcome,
      moderationMessages: profileModerationMessages(moderation.flags),
      published: false,
    };
  }

  if (moderation.outcome === "pass") await passCheckedWork(db, profile.work);
  return {
    success: true,
    moderationOutcome: moderation.outcome,
    published: true,
  };
}

/** A whole-profile pass covers only the exact unchecked posted work that was screened. */
async function passCheckedWork(db: Database, work: CurrentProfile["work"] = []) {
  const updates = work.map((item) =>
    db
      .update(schema.communityJourney)
      .set({
        moderationOutcome: "pass",
        moderationCheckedAt: new Date(),
        moderationReviewRequired: false,
      })
      .where(
        and(
          eq(schema.communityJourney.id, item.id),
          eq(schema.communityJourney.version, item.version),
          eq(schema.communityJourney.state, "POSTED"),
          eq(schema.communityJourney.moderatorHidden, false),
          isNull(schema.communityJourney.moderationOutcome),
          isNull(schema.communityJourney.moderationCheckedAt),
        ),
      ),
  );
  if (updates.length > 0) await db.batch([updates[0], ...updates.slice(1)]);
}

function unchangedProfileText(current: CurrentProfile, values: ProfileValues) {
  const textKeys = [
    "handle",
    "headline",
    "bio",
    "opportunityGoals",
    "location",
    "country",
    "skills",
    "portfolioUrl",
    "linkedinUrl",
  ] as const;
  return (
    current.status !== "SUSPENDED" &&
    textKeys.every((key) => current[key] === values[key])
  );
}

function editorValues(
  handle: string,
  data: ReturnType<typeof profileEditorSchema.parse>,
): ProfileValues {
  return {
    handle: handle,
    headline: data.headline ?? null,
    bio: data.bio ?? null,
    opportunityGoals: data.opportunityGoals,
    location: data.location ?? null,
    country: data.country ?? null,
    skills: serializeOptionalSkills(data.skills),
    openToFreelance: data.openToFreelance ?? false,
    openToRoles: data.openToRoles ?? false,
    portfolioUrl: data.portfolioUrl || null,
    linkedinUrl: data.linkedinUrl || null,
  };
}

/**
 * The owner takes their profile off the public website: PUBLISHED back to DRAFT, nothing else
 * changed. Everything public follows the listing (publicProfileEligibility and
 * isEligiblePublicProfile read the status): the /talent page, their post pages and bylines, the
 * sitemap, the homepage builders and the certificate's link. The profile stays in the signed-in
 * Members directory, and the handle stays theirs, so re-listing through publishProfile brings the
 * same addresses back. A consent control, so it needs no check and no one else's approval; a
 * profile the team has paused (SUSPENDED) is not the owner's to change.
 */
export async function unpublishProfile(db: Database, userId: string, profileId: string): Promise<ProfileFormResult> {
  const result = await db
    .update(schema.studentProfile)
    .set({ status: "DRAFT", contentVersion: sql`${schema.studentProfile.contentVersion} + 1` })
    .where(and(
      eq(schema.studentProfile.id, profileId),
      eq(schema.studentProfile.userId, userId),
      eq(schema.studentProfile.status, "PUBLISHED"),
    ));
  if (!result.meta.changes) {
    // Already off (a second press, or another tab): the person's wish holds, so say so the same way.
    const current = await db.query.studentProfile.findFirst({
      where: and(eq(schema.studentProfile.id, profileId), eq(schema.studentProfile.userId, userId)),
      columns: { status: true },
    });
    if (current?.status === "DRAFT") return { success: true, published: false };
    return { success: false, error: current ? "Your profile is paused, so it isn't on the public website." : "Your profile isn't on the public website." };
  }
  return { success: true, published: false };
}
