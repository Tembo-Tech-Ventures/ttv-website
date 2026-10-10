import type {
  ProfileModerationFlag,
  ProfileModerationResult,
} from "@/lib/moderation/clef";
import { safePublicProfileAvatarUrl } from "@/lib/avatar";
import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";

export type ProfileModerationOutcome = ProfileModerationResult["outcome"];

export interface StoredProfileModeration {
  moderationOutcome: ProfileModerationOutcome | null;
  moderationFlags: string | null;
  moderationScores: string | null;
  moderationCheckedAt: Date | null;
  moderationReviewRequired: boolean;
}

const PROFILE_MODERATION_FLAGS = new Set<ProfileModerationFlag>([
  "contains_contact_details",
  "abusive_or_sexual",
  "promotes_unrelated_business",
  "impersonation_risk",
]);

export function moderationColumns(
  result: ProfileModerationResult,
  checkedAt = new Date(),
) {
  return {
    moderationOutcome: result.outcome,
    moderationFlags: JSON.stringify(result.flags),
    moderationScores: JSON.stringify(result.scores),
    moderationCheckedAt: checkedAt,
    moderationReviewRequired: result.outcome !== "pass",
  } as const;
}

export function publishesAfterModeration(
  result: ProfileModerationResult,
): boolean {
  return result.outcome !== "hold";
}

export function parseModerationFlags(
  raw: string | null,
): ProfileModerationFlag[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is ProfileModerationFlag =>
        typeof value === "string" &&
        PROFILE_MODERATION_FLAGS.has(value as ProfileModerationFlag),
    );
  } catch {
    return [];
  }
}

export function parseModerationScores(
  raw: string | null,
): Partial<Record<ProfileModerationFlag, number>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const scores: Partial<Record<ProfileModerationFlag, number>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!PROFILE_MODERATION_FLAGS.has(key as ProfileModerationFlag)) continue;
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1
      ) {
        scores[key as ProfileModerationFlag] = value;
      }
    }
    return scores;
  } catch {
    return {};
  }
}

interface ModerationListRow extends StoredProfileModeration {
  status: string;
  updatedAt: Date | null;
}

export function splitModerationReviewLists<T extends ModerationListRow>(
  profiles: readonly T[],
): { held: T[]; unavailable: T[] } {
  const flagged = profiles
    .filter((profile) => profile.moderationReviewRequired)
    .toSorted((a, b) => {
      const aTime =
        a.moderationCheckedAt?.getTime() ?? a.updatedAt?.getTime() ?? 0;
      const bTime =
        b.moderationCheckedAt?.getTime() ?? b.updatedAt?.getTime() ?? 0;
      return bTime - aTime;
    });

  return {
    held: flagged.filter((profile) => profile.moderationOutcome === "hold"),
    unavailable: flagged.filter(
      (profile) =>
        profile.moderationOutcome === "error" && profile.status === "PUBLISHED",
    ),
  };
}

export type AdminProfileAction = "publish" | "unpublish" | "clear_flag";

interface AdminProfileState {
  status: string;
  publishedAt: Date | null;
  publicName?: string | null;
  publicAvatarUrl?: string | null;
  contentVersion: number;
  user?: { name: string; image: string | null };
}

export function parseAdminProfileAction(value: FormDataEntryValue | null) {
  if (value === "publish" || value === "unpublish" || value === "clear_flag") {
    return value;
  }
  return null;
}

export function resolveAdminProfileUpdate(
  current: AdminProfileState,
  action: AdminProfileAction,
  now = new Date(),
): Record<string, unknown> {
  if (action === "clear_flag") {
    return {
      moderationReviewRequired: false,
      contentVersion: current.contentVersion + 1,
    };
  }
  if (action === "unpublish") {
    return {
      status: "SUSPENDED",
      contentVersion: current.contentVersion + 1,
    };
  }
  return {
    status: "PUBLISHED",
    contentVersion: current.contentVersion + 1,
    moderationReviewRequired: false,
    publicName: current.publicName ?? current.user?.name ?? "TTV Builder",
    publicAvatarUrl:
      current.publicAvatarUrl ??
      safePublicProfileAvatarUrl(current.user?.image),
    ...(current.publishedAt ? {} : { publishedAt: now }),
  };
}

export async function applyAdminProfileAction(
  db: Database,
  profileId: string,
  current: AdminProfileState,
  action: AdminProfileAction,
): Promise<boolean> {
  const result = await db
    .update(schema.studentProfile)
    .set(resolveAdminProfileUpdate(current, action))
    .where(
      and(
        eq(schema.studentProfile.id, profileId),
        eq(schema.studentProfile.contentVersion, current.contentVersion),
      ),
    );
  return result.meta.changes > 0;
}
