import { parseTopicsJson } from "@/lib/talent/profile";
import { sql, type SQLWrapper } from "drizzle-orm";
import { studentProfile } from "@/lib/db/schema";
import { moderationColumns } from "@/lib/talent/profile-moderation";
import type { ProfileModerationResult } from "@/lib/moderation/clef";

export function pendingProfileModeration() {
  return {
    moderationOutcome: sql`CASE WHEN ${studentProfile.moderationOutcome}='hold' THEN 'hold' ELSE NULL END`,
    moderationReviewRequired: true,
  };
}
export function checkedModerationColumns(
  result: ProfileModerationResult,
  column: SQLWrapper = studentProfile.moderationOutcome,
) {
  return {
    ...moderationColumns(result),
    moderationOutcome:
      result.outcome === "error"
        ? sql`CASE WHEN ${column}='hold' THEN 'hold' ELSE 'error' END`
        : result.outcome,
  };
}

/** One text projection for profiles checked with their posted work. */
export function workModerationHighlights(
  work: readonly {
    title?: string;
    repoFullName: string | null;
    repoDescription?: string | null;
    description: string | null;
    blurb: string | null;
    language: string | null;
    topics: string | null;
  }[] = [],
) {
  return work.map((item) => ({
    repoFullName: item.repoFullName ?? item.title ?? "Work",
    description: item.repoFullName
      ? (item.repoDescription ?? item.description)
      : item.description,
    blurb: item.blurb,
    language: item.language,
    topics: parseTopicsJson(item.topics),
  }));
}
