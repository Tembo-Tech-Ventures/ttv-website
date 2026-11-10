import type { Database } from "@/lib/db/schema";
import { isAgentSession } from "@/lib/agent-auth";
import { loadProfilePhotoForModeration, resolveModeratedProfileAvatar, safePublicProfileAvatarUrl } from "@/lib/avatar";
import { checkProfileContent, previewProfileModerationResult, PROFILE_MODERATION_PREVIEW_HEADER } from "@/lib/moderation/clef";
import { discardUnreferencedProfilePhoto } from "@/components/profile/profile-photo-cleanup";
import type { ProfileContentCheck } from "@/components/portfolio/portfolio-handlers";

/**
 * The automatic check a profile save runs (Clef, publish-then-check; policy b217606e rule 6), with
 * the photo snapshot it may make, for one request. `run` wraps a write so a snapshot the write did
 * not keep is removed after it, whatever happened. Previews and agent sessions can ask for a fixed
 * outcome through PROFILE_MODERATION_PREVIEW_HEADER, never production.
 */
export function profileModeration(options: {
  env: Pick<Env, "AI" | "AI_GATEWAY_NAME" | "BUCKET" | "DEPLOYMENT_ENVIRONMENT">;
  db: Database;
  userId: string;
  request: Request;
  locals: App.Locals;
}): { check: ProfileContentCheck; run: <T>(write: () => Promise<T>) => Promise<T> } {
  const { env, db, userId, request, locals } = options;
  const preview = previewProfileModerationResult(
    env.DEPLOYMENT_ENVIRONMENT,
    isAgentSession(locals.session?.userAgent),
    request.headers.get(PROFILE_MODERATION_PREVIEW_HEADER),
  );
  let snapshot: string | null = null;

  const check: ProfileContentCheck = async (state, avatarUrl) => {
    if (preview) return { ...preview, publicAvatarUrl: safePublicProfileAvatarUrl(avatarUrl) };
    let avatarImage: string | null | undefined;
    const moderation = await checkProfileContent(env.AI, state, {
      gatewayName: env.AI_GATEWAY_NAME,
      loadAvatarImage: avatarUrl
        ? async () => {
          avatarImage = await loadProfilePhotoForModeration(env.BUCKET, avatarUrl);
          return avatarImage;
        }
        : undefined,
    });
    const resolved = await resolveModeratedProfileAvatar({ bucket: env.BUCKET, userId, avatarUrl, avatarImage, outcome: moderation.outcome });
    snapshot = resolved.createdSnapshotUrl;
    return { ...moderation, publicAvatarUrl: resolved.publicAvatarUrl };
  };

  async function run<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } finally {
      await discardUnreferencedProfilePhoto({ db, bucket: env.BUCKET, userId, imageUrl: snapshot });
      snapshot = null;
    }
  }

  return { check, run };
}
