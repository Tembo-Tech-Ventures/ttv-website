/**
 * create-post.ts
 * ----------------
 * Utility responsible solely for inserting a new blog post into the database.
 * The function expects already validated input and returns the slug generated
 * from the provided title. Keeping database writes isolated here makes it easy
 * to reuse this logic from server actions or tests while keeping those callers
 * light.
 */

import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import slugify from "slugify";

/**
 * Persists a blog post and returns the computed slug.
 */
export async function createBlogPost(
  title: string,
  content: string,
  authorId: string,
) {
  const slug = slugify(title, { lower: true, strict: true });
  await prisma.blogPost.create({
    data: { title, slug, content, authorId },
  });
  return slug;
}
