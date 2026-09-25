import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";

export type PostModerationAction = "suspend" | "restore";

export interface PostModerationResult {
  success: boolean;
  error?: string;
}

export function parsePostModerationAction(
  value: FormDataEntryValue | null
): PostModerationAction | null {
  return value === "suspend" || value === "restore" ? value : null;
}

export function normalizeAdminNote(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const note = value.trim();
  return note ? note.slice(0, 1_000) : null;
}

/**
 * A single atomic moderation transition. Authors cannot leave SUSPENDED on
 * their own; restore therefore returns the post directly to its former public
 * state while preserving its original publication date.
 */
export async function moderatePost(
  db: Database,
  input: {
    profileId: string;
    postId: string;
    action: PostModerationAction;
    adminNote: string | null;
  }
): Promise<PostModerationResult> {
  const from = input.action === "suspend" ? "PUBLISHED" : "SUSPENDED";
  const to = input.action === "suspend" ? "SUSPENDED" : "PUBLISHED";

  const result = await db
    .update(schema.blogPost)
    .set({ status: to, adminNote: input.adminNote })
    .where(
      and(
        eq(schema.blogPost.id, input.postId),
        eq(schema.blogPost.profileId, input.profileId),
        eq(schema.blogPost.status, from)
      )
    );

  if (!result.meta.changes) {
    return {
      success: false,
      error: `The post could not be ${input.action === "suspend" ? "suspended" : "restored"} from its current state.`,
    };
  }

  return { success: true };
}
