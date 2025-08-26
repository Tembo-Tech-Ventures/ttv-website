/**
 * delete-post.ts
 * ----------------
 * Thin wrapper around Prisma's delete call for blog posts. Keeping this logic in
 * a dedicated module lets server actions remain small and focused.
 */

import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";

/**
 * Permanently removes a blog post identified by its slug.
 */
export async function deleteBlogPost(slug: string) {
  await prisma.blogPost.delete({ where: { slug } });
}
