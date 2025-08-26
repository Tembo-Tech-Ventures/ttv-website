"use server";

/**
 * delete-post.ts
 * ----------------
 * Server action used by the admin blog list to remove a post. The action simply
 * ensures the caller has administrative privileges before delegating deletion to
 * the database helper.
 */

import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { deleteBlogPost } from "@/modules/blog/lib/delete-post/delete-post";
import { revalidatePath } from "next/cache";

export async function deletePost(slug: string) {
  await checkAdminPermissions();
  if (!slug) {
    throw new Error("slug required");
  }
  await deleteBlogPost(slug);
  revalidatePath(`/blog/${slug}`);
  revalidatePath("/blog");
  revalidatePath("/admin/blog");
}
