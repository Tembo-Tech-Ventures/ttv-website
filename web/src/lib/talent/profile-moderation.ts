import { hasCompletedCohort } from "@/lib/talent/eligibility";
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
      (profile) => profile.moderationOutcome !== "hold",
    ),
  };
}

export type AdminProfileAction = "publish" | "unpublish" | "clear_flag";

interface AdminProfileState {
  status: string;
  /** What an admin's pause interrupted (null unless suspended, or paused before this was kept). */
  suspendedFrom?: "DRAFT" | "PUBLISHED" | null;
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

export function parseAdminProfileVersion(
  value: FormDataEntryValue | null,
): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) ? version : null;
}

export function resolveAdminProfileUpdate(
  current: AdminProfileState,
  action: AdminProfileAction,
  now = new Date(),
): Record<string, unknown> {
  if (action === "clear_flag") {
    return {
      moderationOutcome: "pass",
      moderationReviewRequired: false,
      contentVersion: current.contentVersion + 1,
    };
  }
  if (action === "unpublish") {
    return {
      status: "SUSPENDED",
      // Remember what the pause interrupts, so restoring it puts back the person's own choice.
      suspendedFrom: current.status === "SUSPENDED" ? (current.suspendedFrom ?? null) : current.status,
      contentVersion: current.contentVersion + 1,
    };
  }
  // "publish" restores a paused profile to what it was: a person who had taken themselves off the
  // public website stays off it. Only they list themselves; an admin never publishes a draft.
  if (restoredStatus(current) === "DRAFT") {
    return { status: "DRAFT", suspendedFrom: null, contentVersion: current.contentVersion + 1 };
  }
  return {
    suspendedFrom: null,
    status: "PUBLISHED",
    contentVersion: current.contentVersion + 1,
    moderationReviewRequired: false,
    moderationOutcome: "pass",
    publicName: current.publicName ?? current.user?.name ?? "TTV Builder",
    publicAvatarUrl:
      current.publicAvatarUrl ??
      safePublicProfileAvatarUrl(current.user?.image),
    ...(current.publishedAt ? {} : { publishedAt: now }),
  };
}

/** What restoring a paused profile puts back: the status the pause interrupted. */
export function restoredStatus(current: Pick<AdminProfileState, "suspendedFrom" | "publishedAt">): "DRAFT" | "PUBLISHED" {
  return current.suspendedFrom ?? (current.publishedAt ? "PUBLISHED" : "DRAFT");
}

export async function applyAdminProfileAction(
  db: Database,
  profileId: string,
  current: AdminProfileState,
  action: AdminProfileAction,
  expectedVersion: number,
): Promise<"done" | "changed" | "ineligible"> {
  if (current.contentVersion !== expectedVersion) return "changed";
  // Listing is the person's own choice: an admin only restores a profile they paused.
  if (action === "publish" && current.status !== "SUSPENDED") return "changed";
  if (action === "publish" && restoredStatus(current) === "PUBLISHED") {
    const profile = await db.query.studentProfile.findFirst({
      where: eq(schema.studentProfile.id, profileId),
      columns: { userId: true },
    });
    // The public website is for people who completed a cohort: without one, it can't be republished.
    if (!profile || !(await hasCompletedCohort(db, profile.userId))) return "ineligible";
  }
  const result = await db
    .update(schema.studentProfile)
    .set(resolveAdminProfileUpdate(current, action))
    .where(
      and(
        eq(schema.studentProfile.id, profileId),
        eq(schema.studentProfile.contentVersion, expectedVersion),
      ),
    );
  return result.meta.changes > 0 ? "done" : "changed";
}
