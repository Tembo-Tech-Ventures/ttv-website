import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { discardStoredProfilePhoto } from "@/lib/avatar";

interface ProfilePhotoCleanupOptions {
  db: Database;
  bucket: Pick<R2Bucket, "delete">;
  userId: string;
  imageUrl: string | null | undefined;
}

/**
 * Delete a profile-photo object only after checking every persisted identity
 * reference that can make it public. Cleanup is deliberately best-effort:
 * uncertainty keeps the object rather than risking a broken public profile.
 */
export async function discardUnreferencedProfilePhoto({
  db,
  bucket,
  userId,
  imageUrl,
}: ProfilePhotoCleanupOptions): Promise<boolean> {
  if (!imageUrl) return false;

  try {
    const [account, profile] = await Promise.all([
      db.query.user.findFirst({
        where: eq(schema.user.id, userId),
        columns: { image: true },
      }),
      db.query.studentProfile.findFirst({
        where: eq(schema.studentProfile.userId, userId),
        columns: { publicAvatarUrl: true },
      }),
    ]);

    if (account?.image === imageUrl || profile?.publicAvatarUrl === imageUrl) {
      return false;
    }

    await discardStoredProfilePhoto(bucket, userId, imageUrl);
    return true;
  } catch {
    return false;
  }
}
