import { asc, count, desc, eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { PROFILE_MODERATION_MESSAGES } from "@/lib/moderation/clef";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/paging";
import {
  applyAdminProfileAction,
  parseModerationFlags,
  splitModerationReviewLists,
  type AdminProfileAction,
} from "@/lib/talent/profile-moderation";

/*
 * The admin's list of profiles: the ones the content check left for
 * a person, then every profile a page at a time, filtered by status in SQL.
 */

export const PROFILES_PATH = "/admin/profiles";
export const PROFILE_STATUSES = schema.studentProfile.status.enumValues;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

/** The status asked for in `?status=`, if it is one a profile can have. */
export function parseProfileStatus(value: string | null): ProfileStatus | null {
  return PROFILE_STATUSES.find((status) => status === value) ?? null;
}

interface ActionableProfile {
  status: string;
  moderationReviewRequired: boolean;
}

/**
 * The publishing actions that change something for this profile: Restore a
 * profile an admin paused, Unpublish (pause) while it can still be hidden,
 * Clear flag while the content check asks for a person. Never one that would
 * do nothing, and never listing someone: that is the person's own choice.
 */
export function profileActionsFor(profile: ActionableProfile): AdminProfileAction[] {
  const actions: AdminProfileAction[] = [];
  if (profile.status === "SUSPENDED") actions.push("publish");
  if (profile.status !== "SUSPENDED") actions.push("unpublish");
  if (profile.moderationReviewRequired) actions.push("clear_flag");
  return actions;
}

/** What an action's button says: a paused profile is republished, or restored to members only. */
export function profileActionLabel(action: AdminProfileAction, restoresTo: "DRAFT" | "PUBLISHED" = "PUBLISHED"): string {
  if (action === "publish") return restoresTo === "PUBLISHED" ? "Republish" : "Restore";
  return action === "unpublish" ? "Unpublish" : "Clear flag";
}

/** What an action says once it is done, as the page's flash. */
export const PROFILE_DONE: Record<AdminProfileAction, string> = {
  publish: "Profile restored",
  unpublish: "Profile unpublished",
  clear_flag: "Flag cleared",
};

interface ReviewableProfile {
  status?: string;
  moderationFlags: string | null;
  moderationOutcome: string | null;
}

/** Why a profile is waiting for a person, in the content check's own words. */
export function profileReviewReasons(profile: ReviewableProfile): string[] {
  const flags = parseModerationFlags(profile.moderationFlags);
  if (flags.length > 0) return flags.map((flag) => PROFILE_MODERATION_MESSAGES[flag]);
  if (profile.moderationOutcome === "pass") return [];
  if (profile.moderationOutcome === "hold") return ["The content check held this profile."];
  if (profile.moderationOutcome === "error") return [
    profile.status === "PUBLISHED"
      ? "The check was unavailable. This profile remains listed and needs review."
      : "The check was unavailable. This saved profile needs review.",
  ];
  return ["The content check has not finished. This saved profile needs review."];
}

// Drafts first, then public profiles, then hidden ones; within each, the newest change first.
const STATUS_ORDER = sql`case ${schema.studentProfile.status} when 'DRAFT' then 0 when 'PUBLISHED' then 1 else 2 end`;

/**
 * One page of profiles, how many there are with each status, and the profiles
 * waiting for a person: independent reads, started together.
 */
export async function readProfilesPage(db: Database, { status, page }: { status: ProfileStatus | null; page: number }) {
  const [rows, counts, review] = await Promise.all([
    db.query.studentProfile.findMany({
      where: status ? eq(schema.studentProfile.status, status) : undefined,
      columns: { id: true, handle: true, status: true, updatedAt: true, publishedAt: true },
      with: { user: { columns: { name: true, email: true } } },
      orderBy: [STATUS_ORDER, desc(schema.studentProfile.updatedAt), asc(schema.studentProfile.id)],
      limit: ADMIN_PAGE_SIZE,
      offset: (page - 1) * ADMIN_PAGE_SIZE,
    }),
    db
      .select({ status: schema.studentProfile.status, total: count() })
      .from(schema.studentProfile)
      .groupBy(schema.studentProfile.status),
    db.query.studentProfile.findMany({
      where: eq(schema.studentProfile.moderationReviewRequired, true),
      columns: {
        id: true,
        handle: true,
        status: true,
        suspendedFrom: true,
        publishedAt: true,
        updatedAt: true,
        contentVersion: true,
        moderationOutcome: true,
        moderationFlags: true,
        moderationScores: true,
        moderationCheckedAt: true,
        moderationReviewRequired: true,
      },
      with: { user: { columns: { name: true } } },
    }),
  ]);
  const byStatus = new Map(counts.map((row) => [row.status, row.total]));
  const total = status ? (byStatus.get(status) ?? 0) : counts.reduce((sum, row) => sum + row.total, 0);
  return { rows, total, review: splitModerationReviewLists(review) };
}

export type ProfileModerationResult = "done" | "missing" | "changed";

/**
 * Publish, unpublish or clear the flag on one profile, only if it is still the
 * version the admin was looking at. A database failure is thrown, for a 503.
 */
export async function moderateProfile(
  db: Database,
  { profileId, action, expectedVersion }: { profileId: string; action: AdminProfileAction; expectedVersion: number },
): Promise<ProfileModerationResult> {
  const current = await db.query.studentProfile.findFirst({
    where: eq(schema.studentProfile.id, profileId),
    columns: { status: true, suspendedFrom: true, publishedAt: true, contentVersion: true, publicName: true, publicAvatarUrl: true },
    with: { user: { columns: { name: true, image: true } } },
  });
  if (!current) return "missing";
  return (await applyAdminProfileAction(db, profileId, current, action, expectedVersion)) ? "done" : "changed";
}
