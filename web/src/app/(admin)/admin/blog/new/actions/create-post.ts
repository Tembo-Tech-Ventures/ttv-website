"use server";

/**
 * create-post.ts
 * ----------------
 * Server action invoked from the admin blog editor to save a new post. The
 * action performs permission checks, resolves the author from the current
 * session and delegates persistence to the createBlogPost helper.
 */

import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { createBlogPost } from "@/modules/blog/lib/create-post/create-post";
import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { revalidatePath } from "next/cache";

export async function createPost(data: { title: string; content: string }) {
  await checkAdminPermissions();
  const session = await getServerSession();
  if (!session?.user?.id) {
    throw new Error("User not authenticated");
  }
  if (!data.title || !data.content) {
    throw new Error("Title and content are required");
  }
  const slug = await createBlogPost(data.title, data.content, session.user.id);
  revalidatePath("/blog");
  revalidatePath("/admin/blog");
  return slug;
}
