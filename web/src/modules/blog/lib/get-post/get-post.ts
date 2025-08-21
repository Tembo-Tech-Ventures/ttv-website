/**
 * get-post.ts
 * ------------
 * Fetches a single blog post by slug. This thin wrapper keeps Prisma usage in a
 * centralized location, simplifying future changes to the data layer.
 */

import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";

export async function getPost(slug: string) {
  return prisma.blogPost.findUnique({ where: { slug } });
}
