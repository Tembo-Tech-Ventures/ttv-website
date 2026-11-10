import { createId } from "@paralleldrive/cuid2";
import { and, eq, sql, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import type { ProfileModerationState } from "@/lib/moderation/clef";
import { profileModerationState } from "@/lib/members/moderation-state";
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
  | { outcome: "saved"; revisions: { id: string; version: number }[] }
  | { outcome: "hold" }
  | { outcome: "conflict" }
  | { outcome: "suspended" };

export function profileStateWithHighlights(
  profile: HighlightProfileState,
  skills: string[],
  highlights: readonly ProfileHighlightValues[],
): ProfileModerationState {
  return profileModerationState(profile, {
    skills,
    highlights: highlights.map(
      ({ repoFullName, description, blurb, language, topics }) => ({
        repoFullName,
        description,
        blurb,
        language,
        topics: parseTopicsJson(topics),
      }),
    ),
  });
}

function epochSeconds(value: Date | null): number | null {
  return value ? Math.floor(value.getTime() / 1_000) : null;
}

export async function replaceProfileHighlights(
  db: Database,
  profile: HighlightProfileState,
  highlights: readonly ProfileHighlightValues[],
  repostSelectedDrafts = false,
): Promise<ProfileHighlightWriteResult> {
  if (profile.status === "SUSPENDED") return { outcome: "suspended" };

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
  const selected = JSON.stringify(highlights.map((h) => h.repoFullName));
  const retire = db
    .update(schema.communityJourney)
    .set({ state: "DRAFT", moderationReviewRequired: false })
    .where(
      and(
        eq(schema.communityJourney.userId, profile.userId),
        eq(schema.communityJourney.kind, "repo"),
        profileIsCurrent,
        sql`${schema.communityJourney.repoFullName} NOT IN (SELECT value FROM json_each(${selected}))`,
      ),
    );
  const upserts = highlights.map((h) =>
    db.insert(schema.communityJourney).select(sql`
    SELECT ${createId()},${profile.userId},${h.repoFullName},${h.blurb ?? h.description ?? ""},${h.repoUrl},
      ${new Date(h.pushedAt ?? h.snapshotAt).toISOString().slice(0, 10)},'institution','POSTED','repo',
      ${h.repoFullName},${h.repoUrl},${h.description},${h.language},${h.topics},${h.stars},${epochSeconds(h.pushedAt)},
      ${h.blurb},${h.sortOrder},${epochSeconds(h.snapshotAt)},0,NULL,'[]','{}',NULL,1,1,unixepoch(),unixepoch()
    WHERE ${profileIsCurrent}
    ON CONFLICT(userId,repoFullName) DO UPDATE SET title=excluded.title,description=excluded.description,
      evidenceUrl=excluded.evidenceUrl,occurredAt=excluded.occurredAt,state=CASE WHEN ${Number(repostSelectedDrafts)}=1 AND communityJourney.moderatorHidden=0 THEN 'POSTED' ELSE communityJourney.state END,repoUrl=excluded.repoUrl,
      repoDescription=excluded.repoDescription,language=excluded.language,topics=excluded.topics,stars=excluded.stars,
      pushedAt=excluded.pushedAt,blurb=excluded.blurb,sortOrder=excluded.sortOrder,snapshotAt=excluded.snapshotAt,
      moderationOutcome=CASE WHEN (communityJourney.title IS NOT excluded.title OR communityJourney.description IS NOT excluded.description OR
        communityJourney.evidenceUrl IS NOT excluded.evidenceUrl OR communityJourney.repoDescription IS NOT excluded.repoDescription OR
        communityJourney.language IS NOT excluded.language OR communityJourney.topics IS NOT excluded.topics OR
        communityJourney.blurb IS NOT excluded.blurb) AND communityJourney.moderationOutcome IS NOT 'hold' THEN NULL ELSE communityJourney.moderationOutcome END,
      moderationCheckedAt=CASE WHEN (communityJourney.title IS NOT excluded.title OR communityJourney.description IS NOT excluded.description OR
        communityJourney.evidenceUrl IS NOT excluded.evidenceUrl OR communityJourney.repoDescription IS NOT excluded.repoDescription OR
        communityJourney.language IS NOT excluded.language OR communityJourney.topics IS NOT excluded.topics OR
        communityJourney.blurb IS NOT excluded.blurb) THEN NULL ELSE communityJourney.moderationCheckedAt END,
      moderationReviewRequired=CASE WHEN communityJourney.moderatorHidden=1 OR (${Number(repostSelectedDrafts)}=0 AND communityJourney.state='DRAFT') THEN 0 WHEN (communityJourney.title IS NOT excluded.title OR communityJourney.description IS NOT excluded.description OR
        communityJourney.evidenceUrl IS NOT excluded.evidenceUrl OR communityJourney.repoDescription IS NOT excluded.repoDescription OR
        communityJourney.language IS NOT excluded.language OR communityJourney.topics IS NOT excluded.topics OR
        communityJourney.blurb IS NOT excluded.blurb) OR communityJourney.moderationCheckedAt IS NULL OR communityJourney.moderationOutcome IN ('hold','error') THEN 1 ELSE communityJourney.moderationReviewRequired END,version=communityJourney.version+CASE WHEN
        communityJourney.title IS NOT excluded.title OR communityJourney.description IS NOT excluded.description OR
        communityJourney.evidenceUrl IS NOT excluded.evidenceUrl OR communityJourney.repoDescription IS NOT excluded.repoDescription OR
        communityJourney.language IS NOT excluded.language OR communityJourney.topics IS NOT excluded.topics OR
        communityJourney.blurb IS NOT excluded.blurb THEN 1 ELSE 0 END,updatedAt=unixepoch()
  `),
  );
  const update = db
    .update(schema.studentProfile)
    .set({ contentVersion: sql`${schema.studentProfile.contentVersion}+1` })
    .where(expectedProfile);
  const revisionsQuery = db
    .select({
      id: schema.communityJourney.id,
      version: schema.communityJourney.version,
    })
    .from(schema.communityJourney)
    .where(
      and(
        eq(schema.communityJourney.userId, profile.userId),
        eq(schema.communityJourney.state, "POSTED"),
        eq(schema.communityJourney.moderatorHidden, false),
        sql`${schema.communityJourney.moderationCheckedAt} IS NULL`,
        inArray(
          schema.communityJourney.repoFullName,
          highlights.map((h) => h.repoFullName),
        ),
      ),
    );
  const results = await db.batch([retire, ...upserts, update, revisionsQuery]);
  const changed = results.at(-2) as D1Result;
  return changed?.meta.changes
    ? {
        outcome: "saved",
        revisions: results.at(-1) as { id: string; version: number }[],
      }
    : { outcome: "conflict" };
}
