import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import {
  normalizeHandle,
  validateHandle,
  type HandleValidationError,
} from "@/lib/talent/handles";
import { profileEditorSchema, serializeSkills } from "@/lib/talent/profile";
import { canTransition, PROFILE_TRANSITIONS } from "@/lib/talent/transitions";

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
): Promise<ProfileFormResult> {
  const data = extractProfileFormData(formData);

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
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      if (!fieldErrors[path]) {
        fieldErrors[path] = issue.message;
      }
    }
    return { success: false, fieldErrors };
  }

  const values = {
    handle: handleResult.normalized,
    headline: parsed.data.headline ?? null,
    bio: parsed.data.bio ?? null,
    location: parsed.data.location ?? null,
    country: parsed.data.country ?? null,
    skills: parsed.data.skills ? serializeSkills(parsed.data.skills) : null,
    openToFreelance: parsed.data.openToFreelance ?? false,
    openToRoles: parsed.data.openToRoles ?? false,
    portfolioUrl: parsed.data.portfolioUrl || null,
    linkedinUrl: parsed.data.linkedinUrl || null,
  };

  if (existingProfileId) {
    await db
      .update(schema.studentProfile)
      .set(values)
      .where(
        and(
          eq(schema.studentProfile.id, existingProfileId),
          eq(schema.studentProfile.userId, userId),
        ),
      );
  } else {
    await db.insert(schema.studentProfile).values({
      ...values,
      userId,
      status: "DRAFT",
    });
  }

  return { success: true };
}

export async function submitForReview(
  db: Database,
  userId: string,
  profileId: string,
): Promise<ProfileFormResult> {
  const profile = await db.query.studentProfile.findFirst({
    where: and(
      eq(schema.studentProfile.id, profileId),
      eq(schema.studentProfile.userId, userId),
    ),
    columns: { status: true },
  });

  if (!profile) {
    return { success: false, error: "Profile not found" };
  }

  if (!canTransition(PROFILE_TRANSITIONS, profile.status, "IN_REVIEW")) {
    return {
      success: false,
      error: "Profile cannot be submitted for review from its current status",
    };
  }

  await db
    .update(schema.studentProfile)
    .set({ status: "IN_REVIEW" })
    .where(
      and(
        eq(schema.studentProfile.id, profileId),
        eq(schema.studentProfile.userId, userId),
      ),
    );

  return { success: true };
}
