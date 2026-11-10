import { createId } from "@paralleldrive/cuid2";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import type {
  ProfileModerationResult,
  ProfileModerationState,
} from "@/lib/moderation/clef";
import { parseTopicsJson } from "@/lib/talent/profile";

export interface ProfileHighlightValues {
  repoFullName: string;
  repoUrl: string;
  description: string | null;
  language: string | null;
  topics: string;
  stars: number;
  pushedAt: Date | null;
  blurb: string | null;
  sortOrder: number;
  snapshotAt: Date;
}

export interface HighlightProfileState {
  id: string;
  userId: string;
  status: "DRAFT" | "PUBLISHED" | "SUSPENDED";
  contentVersion: number;
  handle: string;
  headline: string | null;
  bio: string | null;
  location: string | null;
  country: string | null;
  skills: string | null;
  githubLogin: string | null;
  portfolioUrl: string | null;
  linkedinUrl: string | null;
  publicName: string | null;
  publicAvatarUrl: string | null;
  user: { name: string; image: string | null };
}

export type ProfileHighlightWriteResult =
  | { outcome: "saved" }
  | { outcome: "hold" }
  | { outcome: "conflict" }
  | { outcome: "suspended" };

export function profileStateWithHighlights(
  profile: HighlightProfileState,
  skills: string[],
  highlights: readonly ProfileHighlightValues[],
): ProfileModerationState {
  return {
    displayName: profile.publicName ?? profile.user.name,
    handle: profile.handle,
    headline: profile.headline,
    bio: profile.bio,
    location: profile.location,
    country: profile.country,
    skills,
    githubLogin: profile.githubLogin,
    portfolioUrl: profile.portfolioUrl,
    linkedinUrl: profile.linkedinUrl,
    highlights: highlights.map(
      ({ repoFullName, description, blurb, language, topics }) => ({
        repoFullName,
        description,
        blurb,
        language,
        topics: parseTopicsJson(topics),
      }),
    ),
  };
}

function epochSeconds(value: Date | null): number | null {
  return value ? Math.floor(value.getTime() / 1_000) : null;
}

export async function replaceProfileHighlights(
  db: Database,
  profile: HighlightProfileState,
  highlights: readonly ProfileHighlightValues[],
  moderation?: ProfileModerationResult,
): Promise<ProfileHighlightWriteResult> {
  if (profile.status === "SUSPENDED") return { outcome: "suspended" };
  if (profile.status === "PUBLISHED" && !moderation) {
    throw new Error("Published profile highlights require moderation");
  }

  const expectedProfile = and(
    eq(schema.studentProfile.id, profile.id),
    eq(schema.studentProfile.userId, profile.userId),
    eq(schema.studentProfile.status, profile.status),
    eq(schema.studentProfile.contentVersion, profile.contentVersion),
  );
  const profileIsCurrent = sql`exists (
    select 1 from ${schema.studentProfile}
    where ${expectedProfile}
  )`;
  const result = moderation ?? { outcome: "error" as const, flags: [], scores: {} };
  const selected = JSON.stringify(highlights.map(h => h.repoFullName));
  const retire = db.update(schema.communityJourney).set({ state: "DRAFT" }).where(and(
    eq(schema.communityJourney.userId,profile.userId),eq(schema.communityJourney.kind,"repo"),profileIsCurrent,
    sql`${schema.communityJourney.repoFullName} NOT IN (SELECT value FROM json_each(${selected}))`,
  ));
  const upserts = highlights.map(h => db.insert(schema.communityJourney).select(sql`
    SELECT ${createId()},${profile.userId},${h.repoFullName},${h.blurb ?? h.description ?? ""},${h.repoUrl},
      ${new Date(h.pushedAt ?? h.snapshotAt).toISOString().slice(0,10)},'institution','POSTED','repo',${profile.id},
      ${h.repoFullName},${h.repoUrl},${h.description},${h.language},${h.topics},${h.stars},${epochSeconds(h.pushedAt)},
      ${h.blurb},${h.sortOrder},${epochSeconds(h.snapshotAt)},${result.outcome},${JSON.stringify(result.flags)},
      ${JSON.stringify(result.scores)},unixepoch(),${Number(result.outcome!=="pass")},1,unixepoch(),unixepoch()
    WHERE ${profileIsCurrent}
    ON CONFLICT(userId,repoFullName) DO UPDATE SET title=excluded.title,description=excluded.description,
      evidenceUrl=excluded.evidenceUrl,occurredAt=excluded.occurredAt,state='POSTED',repoUrl=excluded.repoUrl,
      repoDescription=excluded.repoDescription,language=excluded.language,topics=excluded.topics,stars=excluded.stars,
      pushedAt=excluded.pushedAt,blurb=excluded.blurb,sortOrder=excluded.sortOrder,snapshotAt=excluded.snapshotAt,
      moderationOutcome=excluded.moderationOutcome,moderationFlags=excluded.moderationFlags,
      moderationScores=excluded.moderationScores,moderationCheckedAt=excluded.moderationCheckedAt,
      moderationReviewRequired=excluded.moderationReviewRequired,version=communityJourney.version+1,updatedAt=unixepoch()
  `));
  const update = db.update(schema.studentProfile).set({ contentVersion: sql`${schema.studentProfile.contentVersion}+1` }).where(expectedProfile);
  const results = await db.batch([retire,...upserts,update]);
  return results.at(-1)?.meta.changes ? { outcome: result.outcome === "hold" ? "hold" : "saved" } : { outcome:"conflict" };
}
