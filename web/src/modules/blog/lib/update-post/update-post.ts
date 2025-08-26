/**
 * update-post.ts
 * ----------------
 * Small helper that updates an existing blog post. The slug is treated as the
 * immutable identifier for the post, so changing the title does not rewrite the
 * slug. This avoids breaking existing links.
 */

import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";

/**
 * Updates title and content of a blog post.
 */
export async function updateBlogPost(
  slug: string,
  title: string,
  content: string,
) {
  await prisma.blogPost.update({
    where: { slug },
    data: { title, content },
  });
}
