import { createId } from "@paralleldrive/cuid2";
import { checkProfileContent, type ProfileModerationState } from "@/lib/moderation/clef";
import type { CommunityProfileInput } from "@/lib/community/model";
import { CommunityError } from "@/lib/community/model";

export type MemberModerationEnv = Pick<Env, "AI" | "AI_GATEWAY_NAME">;
const emptyState: ProfileModerationState = { displayName: "", handle: "", headline: null, bio: null,
  location: null, country: null, skills: [], githubLogin: null, portfolioUrl: null, linkedinUrl: null };
async function check(env: MemberModerationEnv | undefined, state: ProfileModerationState) {
  if (!env) return { outcome: "error", flags: [], scores: {} } as const;
  return checkProfileContent(env.AI, state, { gatewayName: env.AI_GATEWAY_NAME });
}
/** Save first, then screen that exact revision. A slow check cannot overwrite a newer edit. */
export async function saveMemberText(db: D1Database, userId: string, input: CommunityProfileInput, env?: MemberModerationEnv) {
  const identity = await db.prepare("SELECT name FROM user WHERE id=?").bind(userId).first<{name:string}>();
  if (!identity) throw new CommunityError("Profile not found.",404);
  for (let attempt=0; attempt<5; attempt++) {
    try {
      const row = await db.prepare(`INSERT INTO studentProfile(id,userId,handle,headline,bio,skills,opportunityGoals,publicName,contentVersion)
        VALUES (?,?,?,?,?,?,?,?,1) ON CONFLICT(userId) DO UPDATE SET headline=excluded.headline,bio=excluded.bio,
        skills=excluded.skills,opportunityGoals=excluded.opportunityGoals,publicName=excluded.publicName,
        contentVersion=studentProfile.contentVersion+1,moderationOutcome=NULL,moderationReviewRequired=0,updatedAt=unixepoch()
        WHERE studentProfile.status<>'SUSPENDED' RETURNING contentVersion,handle`)
        .bind(createId(),userId,`member-${createId()}`,input.headline,input.bio,JSON.stringify([...new Set(input.skills)]),input.opportunityGoals,identity.name)
        .first<{contentVersion:number;handle:string}>();
      if (!row) throw new CommunityError("A paused profile cannot be edited.",409);
      const result = await check(env,{...emptyState,displayName:identity.name,handle:row.handle,headline:input.headline,
        bio: `${input.bio}\n${input.opportunityGoals}`,skills:input.skills});
      await db.prepare(`UPDATE studentProfile SET moderationOutcome=?,moderationFlags=?,moderationScores=?,
        moderationCheckedAt=unixepoch(),moderationReviewRequired=? WHERE userId=? AND contentVersion=?`)
        .bind(result.outcome,JSON.stringify(result.flags),JSON.stringify(result.scores),Number(result.outcome!=="pass"),userId,row.contentVersion).run();
      return;
    } catch(error) {
      if (attempt===4 || !(error instanceof Error) || !error.message.includes("studentProfile.handle")) throw error;
    }
  }
}
export async function checkPostedWork(db: D1Database, id: string, env?: MemberModerationEnv) {
  const work = await db.prepare("SELECT title,description,version FROM communityJourney WHERE id=? AND state='POSTED'")
    .bind(id).first<{title:string;description:string;version:number}>();
  if (!work) return;
  const result = await check(env,{...emptyState,headline:work.title,bio:work.description});
  await db.prepare(`UPDATE communityJourney SET moderationOutcome=?,moderationFlags=?,moderationScores=?,moderationCheckedAt=unixepoch(),
    moderationReviewRequired=? WHERE id=? AND version=? AND state='POSTED'`)
    .bind(result.outcome,JSON.stringify(result.flags),JSON.stringify(result.scores),Number(result.outcome!=="pass"),id,work.version).run();
}
