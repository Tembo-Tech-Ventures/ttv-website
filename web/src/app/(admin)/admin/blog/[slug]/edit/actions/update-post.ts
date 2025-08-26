"use server";

/**
 * update-post.ts
 * ----------------
 * Server action for saving edits to an existing blog post. The action checks
 * that the caller is an administrator before delegating to the update helper.
 */

import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { updateBlogPost } from "@/modules/blog/lib/update-post/update-post";
import { revalidatePath } from "next/cache";

export async function updatePost(data: {
  slug: string;
  title: string;
  content: string;
}) {
  await checkAdminPermissions();
  if (!data.slug || !data.title || !data.content) {
    throw new Error("slug, title and content are required");
  }
  await updateBlogPost(data.slug, data.title, data.content);
  revalidatePath(`/blog/${data.slug}`);
  revalidatePath("/blog");
  revalidatePath("/admin/blog");
}
