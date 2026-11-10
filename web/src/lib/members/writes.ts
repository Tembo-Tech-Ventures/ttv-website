import { createId } from "@paralleldrive/cuid2";
import {
  safePublicProfileAvatarUrl,
  loadProfilePhotoForModeration,
  resolveModeratedProfileAvatar,
} from "@/lib/avatar";
import {
  checkProfileContent,
  type ProfileModerationState,
} from "@/lib/moderation/clef";
import type { CommunityProfileInput } from "@/lib/community/model";
import { CommunityError } from "@/lib/community/model";
import { nextMemberHandle } from "./handles";

export type MemberModerationEnv = Pick<Env, "AI" | "AI_GATEWAY_NAME"> &
  Partial<Pick<Env, "BUCKET">>;
export const emptyModerationState: ProfileModerationState = {
  displayName: "",
  handle: "",
  headline: null,
  bio: null,
  location: null,
  country: null,
  skills: [],
  githubLogin: null,
  portfolioUrl: null,
  linkedinUrl: null,
};
interface SavedIdentity {
  name: string;
  image: string | null;
}
async function identityFor(db: D1Database, userId: string) {
  const identity = await db
    .prepare("SELECT name,image FROM user WHERE id=?")
    .bind(userId)
    .first<SavedIdentity>();
  if (!identity) throw new CommunityError("Profile not found.", 404);
  return identity;
}
async function check(
  env: MemberModerationEnv,
  state: ProfileModerationState,
  identity?: SavedIdentity,
  userId?: string,
) {
  let image: string | null | undefined;
  const result = await checkProfileContent(env.AI, state, {
    gatewayName: env.AI_GATEWAY_NAME,
    loadAvatarImage:
      identity?.image && env.BUCKET
        ? async () => {
            image = await loadProfilePhotoForModeration(
              env.BUCKET!,
              identity.image!,
            );
            return image;
          }
        : undefined,
  });
  const avatar =
    env.BUCKET && identity && userId
      ? await resolveModeratedProfileAvatar({
          bucket: env.BUCKET,
          userId,
          avatarUrl: identity.image,
          avatarImage: image,
          outcome: result.outcome,
        })
      : { publicAvatarUrl: safePublicProfileAvatarUrl(identity?.image) };
  return { ...result, publicAvatarUrl: avatar.publicAvatarUrl };
}
/** A failed recheck never releases an existing hold. */
const checkedOutcome =
  "CASE WHEN ?='error' AND moderationOutcome='hold' THEN 'hold' ELSE ? END";

/** Posting creates one named profile and checks that identity, with no invented headline. */
export async function ensureMemberProfile(
  db: D1Database,
  userId: string,
  env: MemberModerationEnv,
) {
  if (
    await db
      .prepare("SELECT 1 FROM studentProfile WHERE userId=?")
      .bind(userId)
      .first()
  )
    return;
  await saveMemberText(
    db,
    userId,
    { headline: "", bio: "", skills: [], opportunityGoals: "" },
    env,
  );
}

/** Community edits save before checking; anonymous public text is screened first. */
export async function saveMemberText(
  db: D1Database,
  userId: string,
  input: CommunityProfileInput,
  env: MemberModerationEnv,
) {
  const identity = await identityFor(db, userId);
  const existing = await db
    .prepare(
      "SELECT handle,status,contentVersion,headline,bio,skills,opportunityGoals,publicName FROM studentProfile WHERE userId=?",
    )
    .bind(userId)
    .first<{
      handle: string;
      status: string;
      contentVersion: number;
      headline: string | null;
      bio: string | null;
      skills: string | null;
      opportunityGoals: string;
      publicName: string | null;
    }>();
  if (existing?.status === "SUSPENDED")
    throw new CommunityError("A paused profile cannot be edited.", 409);
  if (existing && sameMemberText(existing, input)) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const handle = await memberHandleForWrite(
        db,
        identity.name,
        existing?.handle,
        attempt,
      );
      const state = {
        ...emptyModerationState,
        displayName: existing?.publicName ?? identity.name,
        handle,
        headline: input.headline,
        bio: `${input.bio}\n${input.opportunityGoals}`,
        skills: input.skills,
      };
      const screened = await screenPublicEdit(
        existing?.status,
        env,
        state,
        identity,
        userId,
      );
      const expectedVersion = existing?.contentVersion ?? null;
      const row = await db
        .prepare(
          `INSERT INTO studentProfile(id,userId,handle,headline,bio,skills,opportunityGoals,publicName,contentVersion,moderationReviewRequired)
        VALUES (?,?,?,?,?,?,?,?,1,1) ON CONFLICT(userId) DO UPDATE SET headline=excluded.headline,bio=excluded.bio,
        skills=excluded.skills,opportunityGoals=excluded.opportunityGoals,
        contentVersion=studentProfile.contentVersion+1,moderationOutcome=CASE WHEN studentProfile.moderationOutcome='hold' THEN 'hold' ELSE NULL END,
        moderationReviewRequired=1,updatedAt=unixepoch() WHERE studentProfile.status<>'SUSPENDED' AND contentVersion=? RETURNING contentVersion`,
        )
        .bind(
          createId(),
          userId,
          handle,
          input.headline,
          input.bio,
          JSON.stringify([...new Set(input.skills)]),
          input.opportunityGoals,
          identity.name,
          expectedVersion,
        )
        .first<{ contentVersion: number }>();
      if (!row)
        throw new CommunityError("Profile changed. Reload before saving.", 409);
      const result = screened ?? (await check(env, state, identity, userId));
      await db
        .prepare(
          `UPDATE studentProfile SET moderationOutcome=${checkedOutcome},moderationFlags=?,moderationScores=?,
        moderationCheckedAt=unixepoch(),moderationReviewRequired=?,publicAvatarUrl=coalesce(publicAvatarUrl,?) WHERE userId=? AND contentVersion=?`,
        )
        .bind(
          result.outcome,
          result.outcome,
          JSON.stringify(result.flags),
          JSON.stringify(result.scores),
          Number(result.outcome !== "pass"),
          result.outcome === "hold" ? null : result.publicAvatarUrl,
          userId,
          row.contentVersion,
        )
        .run();
      return;
    } catch (error) {
      if (
        attempt === 4 ||
        !(error instanceof Error) ||
        !error.message.includes("studentProfile.handle")
      )
        throw error;
    }
  }
}
export async function checkPostedWork(
  db: D1Database,
  id: string,
  env: MemberModerationEnv,
) {
  const work = await db
    .prepare(
      "SELECT title,description,version FROM communityJourney WHERE id=? AND state='POSTED' AND moderatorHidden=0 AND moderationCheckedAt IS NULL",
    )
    .bind(id)
    .first<{ title: string; description: string; version: number }>();
  if (!work) return;
  const result = await check(env, {
    ...emptyModerationState,
    headline: work.title,
    bio: work.description,
  });
  await db
    .prepare(
      `UPDATE communityJourney SET moderationOutcome=${checkedOutcome},moderationFlags=?,moderationScores=?,moderationCheckedAt=unixepoch(),
    moderationReviewRequired=? WHERE id=? AND version=? AND state='POSTED' AND moderatorHidden=0 AND moderationReviewRequired=1`,
    )
    .bind(
      result.outcome,
      result.outcome,
      JSON.stringify(result.flags),
      JSON.stringify(result.scores),
      Number(result.outcome !== "pass"),
      id,
      work.version,
    )
    .run();
}

async function memberHandleForWrite(
  db: D1Database,
  name: string,
  current: string | undefined,
  attempt: number,
) {
  if (current) return current;
  return attempt === 4
    ? `member-${createId().slice(0, 12)}`
    : nextMemberHandle(db, name);
}

function sameMemberText(
  existing: {
    headline: string | null;
    bio: string | null;
    skills: string | null;
    opportunityGoals: string;
  },
  input: CommunityProfileInput,
) {
  return (
    (existing.headline ?? "") === input.headline &&
    (existing.bio ?? "") === input.bio &&
    (existing.skills ?? "[]") === JSON.stringify([...new Set(input.skills)]) &&
    existing.opportunityGoals === input.opportunityGoals
  );
}
async function screenPublicEdit(
  status: string | undefined,
  env: MemberModerationEnv,
  state: ProfileModerationState,
  identity: SavedIdentity,
  userId: string,
) {
  if (status !== "PUBLISHED") return null;
  const screened = await check(env, state, identity, userId);
  if (screened.outcome === "hold")
    throw new CommunityError(
      "Your changes need attention before they can go live.",
      409,
    );
  return screened;
}
